import { Client, TextChannel, Guild, User, ActionRowBuilder, ButtonBuilder, EmbedBuilder, ChannelType } from 'discord.js';
import { draftManager } from './DraftManager';
import { voteManager } from './VoteManager';
import { lobbyManager } from './LobbyManager';
import { vetoManager } from './VetoManager';
import { prisma } from '../utils/db';
import { queueManager, QueuePlayer } from './QueueManager';
import { createMatchEmbed } from '../utils/embeds';
import { spectatorManager } from './SpectatorManager';

export class Matchmaker {
    private client: Client;

    constructor(client: Client) {
        this.client = client;
        voteManager.setMatchmaker(this);
        draftManager.setMatchmaker(this);
        this.initialize();
    }

    initialize() {
        // queueFull is now handled in index.ts via ReadyCheckManager
    }

    async createMatch(game: string, players: QueuePlayer[], mode: 'Ranked' | 'Casual' | 'Captain' = 'Ranked') {
        const configGuildId = queueManager.getConfig(game)?.guildId;
        const guild = (configGuildId && this.client.guilds.cache.get(configGuildId)) || this.client.guilds.cache.first();
        if (!guild) return;

        const match = await prisma.match.create({
            data: {
                game,
                guildId: guild.id,
                isRanked: mode === 'Ranked',
                status: 'pending',
                players: {
                    create: players.map(p => ({ userId: p.user.id, team: 'pending' })),
                },
            },
        });

        for (const p of players) {
            await queueManager.removePlayerFromAllQueues(p.user.id);
            await queueManager.setPlayerState(p.user.id, 'IN_GAME');
            p.user.send(`✅ **Match Found!** You have been removed from all other queues.`).catch(() => { });
        }

        const lobby = await lobbyManager.createLobby(guild, match.id, game, players, mode);
        if (!lobby) return;

        // Persist every match channel id right away so cleanup survives a restart (P1-2)
        const allVoiceIds = [lobby.voiceChannelId1, lobby.voiceChannelId2, ...(lobby.extraVoiceChannelIds ?? [])].filter(Boolean);
        await prisma.match.update({
            where: { id: match.id },
            data: {
                textChannelId: lobby.textChannelId,
                voiceChannelIds: JSON.stringify(allVoiceIds),
            },
        });

        if (mode === 'Ranked' || mode === 'Casual') {
            await this.balanceTeams(lobby);
        } else if (mode === 'Captain') {
            await draftManager.startDraft(lobby);
        }
    }

    async balanceTeams(lobby: any) {
        // Fetch User Attributes for Role-based Balancing (LoL/Valo)
        if (lobby.game === 'lol' || lobby.game === 'valorant') {
            const userIds = lobby.players.map((p: any) => p.user.id);
            const igns = await prisma.userIgn.findMany({
                where: { userId: { in: userIds }, game: lobby.game }
            });
            // basic parsing check
            const roles = igns.map(i => {
                const prefs = i.preferences ? JSON.parse(i.preferences) : {};
                return { userId: i.userId, roles: prefs.roles || [] };
            });
            // Future: Implement role matching algorithm using these roles
        }

        const shuffled = lobby.players.sort(() => 0.5 - Math.random());

        if (lobby.game === 'arena') {
            lobby.team1 = shuffled.map((p: any) => p.user);
            lobby.team2 = [];
        } else {
            const mid = Math.floor(shuffled.length / 2);
            const team1 = shuffled.slice(0, mid).map((p: any) => p.user);
            const team2 = shuffled.slice(mid).map((p: any) => p.user);
            lobby.team1 = team1;
            lobby.team2 = team2;
        }

        await this.finalizeMatch(lobby);
    }

    async finalizeMatch(lobby: any) {
        await prisma.matchPlayer.deleteMany({
            where: { matchId: lobby.matchId }
        });

        const matchPlayersData = [];

        if (lobby.game === 'arena') {
            const allUsers = lobby.team1;
            for (let i = 0; i < allUsers.length; i++) {
                const teamNum = Math.floor(i / 2) + 1;
                matchPlayersData.push({
                    matchId: lobby.matchId,
                    userId: allUsers[i].id,
                    team: `Team ${teamNum}`
                });
            }
        } else {
            matchPlayersData.push(
                ...lobby.team1.map((u: User) => ({ matchId: lobby.matchId, userId: u.id, team: 'team1' })),
                ...lobby.team2.map((u: User) => ({ matchId: lobby.matchId, userId: u.id, team: 'team2' }))
            );
        }

        await prisma.matchPlayer.createMany({
            data: matchPlayersData
        });

        const allUserIds = [...lobby.team1, ...lobby.team2].map(u => u.id);
        await prisma.elo.updateMany({
            where: { userId: { in: allUserIds }, game: lobby.game },
            data: { lastMatchDate: new Date() }
        });

        await prisma.match.update({
            where: { id: lobby.matchId },
            data: {
                channelId1: lobby.voiceChannelId1,
                channelId2: lobby.voiceChannelId2,
                status: 'live'
            }
        });

        const guild = this.client.guilds.cache.get(lobby.guildId);
        if (guild) {
            await this.grantTeamVoiceAccess(lobby, guild);
            await lobbyManager.onMatchReady(lobby, guild);
            await this.announceMatch(lobby, guild);
        }
    }

    async grantTeamVoiceAccess(lobby: any, guild: any) {
        if (lobby.game === 'arena') return;
        const grant = async (voiceId: string, users: User[]) => {
            if (!voiceId) return;
            const channel = guild.channels.cache.get(voiceId) ?? await guild.channels.fetch(voiceId).catch(() => null);
            if (!channel) return;
            for (const u of users) {
                await channel.permissionOverwrites.edit(u.id, { ViewChannel: true, Connect: true, Speak: true })
                    .catch((err: any) => console.error(`[grantTeamVoiceAccess] ${u.id}:`, err?.message));
            }
        };
        await grant(lobby.voiceChannelId1, lobby.team1);
        await grant(lobby.voiceChannelId2, lobby.team2);
    }

    async announceMatch(lobby: any, guild: any) {
        const channel = guild.channels.cache.find((c: any) => c.name === 'matches' || c.name === 'match-logs' || c.name === 'in-progress');
        if (!channel || !channel.isTextBased()) return;

        const embed = new EmbedBuilder()
            .setTitle(`⚔️ ${lobby.game.toUpperCase()} Match Started!`)
            .setDescription(`**Match ID:** #${lobby.matchId}\n**Mode:** ${lobby.mode}`)
            .addFields(
                { name: 'Team 1', value: lobby.team1.map((u: any) => u.username).join('\n') || 'TBD', inline: true },
                { name: 'Team 2', value: lobby.team2.map((u: any) => u.username).join('\n') || 'TBD', inline: true }
            )
            .setColor('Green')
            .setTimestamp();

        const spectateBtn = spectatorManager.createSpectateButton(lobby.textChannelId);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(spectateBtn);

        await channel.send({ embeds: [embed], components: [row] });
    }
}
