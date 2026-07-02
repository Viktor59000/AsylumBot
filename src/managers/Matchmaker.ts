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

    async createMatch(game: string, mode: string, players: QueuePlayer[], formation: 'Ranked' | 'Casual' | 'Captain' = 'Ranked') {
        const configGuildId = queueManager.getConfig(game, mode)?.guildId;
        const guild = (configGuildId && this.client.guilds.cache.get(configGuildId)) || this.client.guilds.cache.first();
        if (!guild) return;

        const match = await prisma.match.create({
            data: {
                game,
                mode,
                guildId: guild.id,
                isRanked: formation === 'Ranked',
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

        const lobby = await lobbyManager.createLobby(guild, match.id, game, mode, players, formation);
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

        if (formation === 'Ranked' || formation === 'Casual') {
            await this.balanceTeams(lobby);
        } else if (formation === 'Captain') {
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

        if (lobby.game === 'arena') {
            const shuffled = [...lobby.players].sort(() => 0.5 - Math.random());
            lobby.team1 = shuffled.map((p: any) => p.user);
            lobby.team2 = [];
        } else {
            const [team1, team2] = this.splitIntoTeams(lobby.players);
            lobby.team1 = team1.map(p => p.user);
            lobby.team2 = team2.map(p => p.user);
        }

        await this.finalizeMatch(lobby);
    }

    /**
     * Random team split that keeps duo/trio groups (groupId) in the same team.
     * Elo-based balancing replaces the random unit order in Lot 3.
     */
    private splitIntoTeams(players: QueuePlayer[]): [QueuePlayer[], QueuePlayer[]] {
        const team1Size = Math.floor(players.length / 2);
        const team2Size = players.length - team1Size;

        // Build indivisible units: one per group, one per solo
        const byGroup = new Map<string, QueuePlayer[]>();
        const units: QueuePlayer[][] = [];
        for (const p of players) {
            if (p.groupId) {
                let group = byGroup.get(p.groupId);
                if (!group) {
                    group = [];
                    byGroup.set(p.groupId, group);
                    units.push(group);
                }
                group.push(p);
            } else {
                units.push([p]);
            }
        }

        // Unbiased shuffle (Fisher-Yates), then biggest units first for packing
        for (let i = units.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [units[i], units[j]] = [units[j], units[i]];
        }
        units.sort((a, b) => b.length - a.length);

        const team1: QueuePlayer[] = [];
        const team2: QueuePlayer[] = [];
        for (const unit of units) {
            const space1 = team1Size - team1.length;
            const space2 = team2Size - team2.length;

            let target: QueuePlayer[] | null = null;
            if (unit.length <= space1 && unit.length <= space2) {
                target = space1 === space2 ? (Math.random() < 0.5 ? team1 : team2) : (space1 > space2 ? team1 : team2);
            } else if (unit.length <= space1) {
                target = team1;
            } else if (unit.length <= space2) {
                target = team2;
            }

            if (target) {
                target.push(...unit);
            } else {
                // Infeasible packing (e.g. three duos in a 3v3): split this group as last resort
                for (const p of unit) {
                    (team1.length < team1Size ? team1 : team2).push(p);
                }
            }
        }

        return [team1, team2];
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
            where: { userId: { in: allUserIds }, game: lobby.game, mode: lobby.queueMode },
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

        const queueName = queueManager.getConfig(lobby.game, lobby.queueMode)?.name ?? lobby.game.toUpperCase();
        const embed = new EmbedBuilder()
            .setTitle(`⚔️ ${queueName} Match Started!`)
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
