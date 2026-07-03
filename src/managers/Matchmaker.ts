import { Client, TextChannel, Guild, User, ActionRowBuilder, ButtonBuilder, EmbedBuilder, ChannelType } from 'discord.js';
import { getModeConfig } from '../utils/constants';
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

        const modeCfg = getModeConfig(game, mode);
        const isPlacement = modeCfg?.matchType === 'placement';

        const match = await prisma.match.create({
            data: {
                game,
                mode,
                matchType: isPlacement ? 'placement' : 'tvt',
                guildId: guild.id,
                isRanked: isPlacement ? true : formation === 'Ranked',
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

        if (isPlacement) {
            // Placement match: N teams ranked 1→N. Supports reduced rosters
            // (force_start): the effective team count adapts to the headcount.
            const ratings = await this.getRatings(players.map(p => p.user.id), game, mode);
            const teams = this.packIntoTeams(players, modeCfg!.teamSize, ratings);
            const lobby = await lobbyManager.createLobby(guild, match.id, game, mode, players, 'Ranked', teams.length);
            if (!lobby) return;
            lobby.teams = teams.map(t => t.map(p => p.user));

            await this.persistMatchChannels(match.id, lobby);
            await this.finalizePlacementMatch(lobby);
            return;
        }

        const lobby = await lobbyManager.createLobby(guild, match.id, game, mode, players, formation);
        if (!lobby) return;

        await this.persistMatchChannels(match.id, lobby);

        if (formation === 'Ranked' || formation === 'Casual') {
            await this.balanceTeams(lobby);
        } else if (formation === 'Captain') {
            await draftManager.startDraft(lobby);
        }
    }

    /** Persist every match channel id right away so cleanup survives a restart (P1-2). */
    private async persistMatchChannels(matchId: number, lobby: any) {
        const allVoiceIds = Array.from(new Set(
            [lobby.voiceChannelId1, lobby.voiceChannelId2, ...(lobby.extraVoiceChannelIds ?? [])].filter(Boolean)
        ));
        await prisma.match.update({
            where: { id: matchId },
            data: {
                textChannelId: lobby.textChannelId,
                voiceChannelIds: JSON.stringify(allVoiceIds),
            },
        });
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

        const ratings = await this.getRatings(lobby.players.map((p: any) => p.user.id), lobby.game, lobby.queueMode);
        const [team1, team2] = this.splitIntoTeams(lobby.players, ratings);
        lobby.team1 = team1.map(p => p.user);
        lobby.team2 = team2.map(p => p.user);

        await this.finalizeMatch(lobby);
    }

    /** Active-season ratings for a set of players on one (game, mode) ladder (default 1000). */
    async getRatings(userIds: string[], game: string, mode: string): Promise<Map<string, number>> {
        const rows = await prisma.elo.findMany({
            where: { userId: { in: userIds }, game, mode, seasonId: null },
            select: { userId: true, rating: true },
        });
        const ratings = new Map<string, number>();
        for (const id of userIds) ratings.set(id, 1000);
        for (const row of rows) ratings.set(row.userId, row.rating);
        return ratings;
    }

    /** Indivisible units (one per duo/trio group, one per solo), shuffled then biggest-first. */
    private buildShuffledUnits(players: QueuePlayer[]): QueuePlayer[][] {
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
        return units;
    }

    /**
     * Placement matches: packs players into teams of `teamSize`, keeping groups
     * together, then balances by Elo (each unit joins the weakest team with
     * room). Adapts to reduced rosters (force_start): at least 2 teams.
     */
    packIntoTeams(players: QueuePlayer[], teamSize: number, ratings: Map<string, number>): QueuePlayer[][] {
        const teamCount = Math.max(2, Math.ceil(players.length / teamSize));
        const teams: QueuePlayer[][] = Array.from({ length: teamCount }, () => []);
        const unitRating = (unit: QueuePlayer[]) => unit.reduce((s, p) => s + (ratings.get(p.user.id) ?? 1000), 0);
        const teamRating = (team: QueuePlayer[]) => team.reduce((s, p) => s + (ratings.get(p.user.id) ?? 1000), 0);

        // Strongest units first, each into the weakest team that still fits it
        const units = this.buildShuffledUnits(players)
            .sort((a, b) => unitRating(b) / b.length - unitRating(a) / a.length);

        for (const unit of units) {
            const target = teams
                .filter(t => teamSize - t.length >= unit.length)
                .sort((a, b) => teamRating(a) - teamRating(b))[0];
            if (target) {
                target.push(...unit);
            } else {
                // Infeasible packing: split the group over the emptiest teams
                for (const p of unit) {
                    teams.sort((a, b) => a.length - b.length)[0].push(p);
                }
            }
        }

        return teams.filter(t => t.length > 0);
    }

    /**
     * Elo-balanced 2-team split (Lot 3): exhaustive search over group-aware
     * units for the partition minimizing the average-Elo gap between teams.
     * Groups (duos/trios) are indivisible. Falls back to space-based packing
     * when group sizes make an exact split impossible.
     */
    splitIntoTeams(players: QueuePlayer[], ratings: Map<string, number>): [QueuePlayer[], QueuePlayer[]] {
        const team1Size = Math.floor(players.length / 2);
        const team2Size = players.length - team1Size;

        // Shuffled units → equal-gap optima are picked at random (variety between matches)
        const units = this.buildShuffledUnits(players);
        const unitSizes = units.map(u => u.length);
        const unitSums = units.map(u => u.reduce((s, p) => s + (ratings.get(p.user.id) ?? 1000), 0));
        const totalSum = unitSums.reduce((a, b) => a + b, 0);

        if (units.length <= 16) {
            let bestMask = -1;
            let bestGap = Infinity;
            const maskCount = 1 << units.length;
            for (let mask = 0; mask < maskCount; mask++) {
                let size = 0, sum = 0;
                for (let i = 0; i < units.length; i++) {
                    if (mask & (1 << i)) {
                        size += unitSizes[i];
                        sum += unitSums[i];
                    }
                }
                if (size !== team1Size) continue;
                const gap = Math.abs(sum / team1Size - (totalSum - sum) / team2Size);
                if (gap < bestGap) {
                    bestGap = gap;
                    bestMask = mask;
                }
            }

            if (bestMask >= 0) {
                const team1: QueuePlayer[] = [];
                const team2: QueuePlayer[] = [];
                units.forEach((unit, i) => {
                    (bestMask & (1 << i) ? team1 : team2).push(...unit);
                });
                return [team1, team2];
            }
        }

        // Fallback (no exact-size partition exists, e.g. three duos in a 3v3):
        // pack by remaining space, splitting a group only as a last resort
        return this.splitBySpace(units, team1Size, team2Size);
    }

    private splitBySpace(units: QueuePlayer[][], team1Size: number, team2Size: number): [QueuePlayer[], QueuePlayer[]] {
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

        const matchPlayersData = [
            ...lobby.team1.map((u: User) => ({ matchId: lobby.matchId, userId: u.id, team: 'team1' })),
            ...lobby.team2.map((u: User) => ({ matchId: lobby.matchId, userId: u.id, team: 'team2' }))
        ];

        await prisma.matchPlayer.createMany({
            data: matchPlayersData
        });

        const allUserIds = [...lobby.team1, ...lobby.team2].map(u => u.id);
        await this.markMatchLive(lobby, allUserIds);

        const guild = this.client.guilds.cache.get(lobby.guildId);
        if (guild) {
            await this.grantTeamVoiceAccess(lobby, guild);
            await lobbyManager.onMatchReady(lobby, guild);
            await this.announceMatch(lobby, guild);
        }
    }

    /** Placement counterpart of finalizeMatch: N teams (`lobby.teams`) → team1..teamN. */
    async finalizePlacementMatch(lobby: any) {
        const teams: User[][] = lobby.teams ?? [];

        await prisma.matchPlayer.deleteMany({
            where: { matchId: lobby.matchId }
        });

        const matchPlayersData = teams.flatMap((team, i) =>
            team.map(u => ({ matchId: lobby.matchId, userId: u.id, team: `team${i + 1}` }))
        );

        await prisma.matchPlayer.createMany({
            data: matchPlayersData
        });

        const allUserIds = teams.flat().map(u => u.id);
        await this.markMatchLive(lobby, allUserIds);

        const guild = this.client.guilds.cache.get(lobby.guildId);
        if (guild) {
            await this.grantPlacementVoiceAccess(lobby, guild);
            await lobbyManager.onMatchReady(lobby, guild);
            await this.announceMatch(lobby, guild);
        }
    }

    private async markMatchLive(lobby: any, allUserIds: string[]) {
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
    }

    /**
     * Grants voice access to a team channel and auto-moves members who are
     * already connected to any voice channel (DESIGN §6.5 — a player not in
     * voice simply isn't moved).
     */
    private async grantAndMove(guild: any, voiceId: string, users: User[]) {
        if (!voiceId) return;
        const channel = guild.channels.cache.get(voiceId) ?? await guild.channels.fetch(voiceId).catch(() => null);
        if (!channel) return;
        for (const u of users) {
            await channel.permissionOverwrites.edit(u.id, { ViewChannel: true, Connect: true, Speak: true })
                .catch((err: any) => console.error(`[grantVoice] ${u.id}:`, err?.message));
            const member = guild.members.cache.get(u.id) ?? await guild.members.fetch(u.id).catch(() => null);
            if (member?.voice?.channelId && member.voice.channelId !== channel.id) {
                await member.voice.setChannel(channel).catch(() => { /* not connected anymore */ });
            }
        }
    }

    async grantTeamVoiceAccess(lobby: any, guild: any) {
        await this.grantAndMove(guild, lobby.voiceChannelId1, lobby.team1);
        await this.grantAndMove(guild, lobby.voiceChannelId2, lobby.team2);
    }

    /** Placement matches: shared layout → everyone in one channel; perTeam → team i → channel i. */
    async grantPlacementVoiceAccess(lobby: any, guild: any) {
        const teams: User[][] = lobby.teams ?? [];

        const layout = getModeConfig(lobby.game, lobby.queueMode)?.voiceLayout ?? 'perTeam';
        if (layout === 'shared') {
            await this.grantAndMove(guild, lobby.voiceChannelId1, teams.flat());
            return;
        }

        const allVoiceIds: string[] = Array.from(new Set(
            [lobby.voiceChannelId1, lobby.voiceChannelId2, ...(lobby.extraVoiceChannelIds ?? [])].filter(Boolean)
        ));
        for (let i = 0; i < teams.length; i++) {
            await this.grantAndMove(guild, allVoiceIds[i], teams[i]);
        }
    }

    async announceMatch(lobby: any, guild: any) {
        const channel = guild.channels.cache.find((c: any) => c.name === 'matches' || c.name === 'match-logs' || c.name === 'in-progress');
        if (!channel || !channel.isTextBased()) return;

        const queueName = queueManager.getConfig(lobby.game, lobby.queueMode)?.name ?? lobby.game.toUpperCase();
        const embed = new EmbedBuilder()
            .setTitle(`⚔️ ${queueName} Match Started!`)
            .setColor('Green')
            .setTimestamp();

        const allUsers: User[] = lobby.teams?.length ? lobby.teams.flat() : [...lobby.team1, ...lobby.team2];
        const ratings = await this.getRatings(allUsers.map(u => u.id), lobby.game, lobby.queueMode);
        const avgOf = (users: User[]) => users.length > 0
            ? Math.round(users.reduce((s, u) => s + (ratings.get(u.id) ?? 1000), 0) / users.length)
            : 1000;

        if (lobby.teams && lobby.teams.length > 0) {
            embed.setDescription(`**Match ID:** #${lobby.matchId}\n**Format:** ranking 1→${lobby.teams.length}`);
            lobby.teams.forEach((team: User[], i: number) => {
                embed.addFields({ name: `Team ${i + 1} — ⭐${avgOf(team)}`, value: team.map(u => u.username).join('\n') || 'TBD', inline: true });
            });
        } else {
            const avg1 = avgOf(lobby.team1);
            const avg2 = avgOf(lobby.team2);
            embed.setDescription(
                `**Match ID:** #${lobby.matchId}\n**Mode:** ${lobby.mode}\n` +
                `⚖️ **Avg Elo:** Team 1 ⭐${avg1} vs Team 2 ⭐${avg2} — **gap ${Math.abs(avg1 - avg2)}**`
            );
            embed.addFields(
                { name: `Team 1 — ⭐${avg1}`, value: lobby.team1.map((u: any) => u.username).join('\n') || 'TBD', inline: true },
                { name: `Team 2 — ⭐${avg2}`, value: lobby.team2.map((u: any) => u.username).join('\n') || 'TBD', inline: true }
            );
        }

        const spectateBtn = spectatorManager.createSpectateButton(lobby.textChannelId);
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(spectateBtn);

        await channel.send({ embeds: [embed], components: [row] });
    }
}
