import {
    Client,
    Guild,
    TextChannel,
    CategoryChannel,
    ChannelType,
    PermissionFlagsBits,
    User,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { QueuePlayer } from './QueueManager';
import { LoLStrategy } from '../strategies/LoLStrategy';
import { CS2Strategy } from '../strategies/CS2Strategy';
import { RLStrategy } from '../strategies/RLStrategy';
import { PlacementStrategy } from '../strategies/PlacementStrategy';
import { GameStrategy } from '../strategies/GameStrategy';
import { getModeConfig } from '../utils/constants';

export interface LobbyState {
    matchId: number;
    game: string;
    queueMode: string; // queue mode: 'soloq', '1v1', '6x3', 'solo', ...
    guildId: string;
    textChannelId: string;
    voiceChannelId1: string;
    voiceChannelId2: string;
    extraVoiceChannelIds?: string[];
    players: QueuePlayer[];
    team1: User[];
    team2: User[];
    teams?: User[][]; // placement matches: index i = `team${i+1}`
    mode: 'Ranked' | 'Captain' | 'Casual'; // team formation (tvt only)
}

export class LobbyManager {
    private lobbies: Map<string, LobbyState> = new Map(); // Key: textChannelId
    private lobbiesByMatch: Map<number, LobbyState> = new Map(); // Key: matchId
    private strategies: Map<string, GameStrategy>;

    constructor() {
        this.strategies = new Map();
        this.strategies.set('lol', new LoLStrategy());
        this.strategies.set('cs2', new CS2Strategy());
        this.strategies.set('valorant', new CS2Strategy());
        this.strategies.set('r6s', new CS2Strategy());
        this.strategies.set('rl', new RLStrategy());
        this.strategies.set('arena', new PlacementStrategy());
        this.strategies.set('tft', new PlacementStrategy());
    }

    async createLobby(
        guild: Guild,
        matchId: number,
        game: string,
        queueMode: string,
        players: QueuePlayer[],
        mode: 'Ranked' | 'Captain' | 'Casual',
        teamCountOverride?: number // placement matches with reduced roster (force_start)
    ): Promise<LobbyState | null> {

        // 1. Find or Create Category
        let category = guild.channels.cache.find(c => c.name === 'ASYLUM MATCHES' && c.type === ChannelType.GuildCategory) as CategoryChannel;
        if (!category) {
            category = await guild.channels.create({
                name: 'ASYLUM MATCHES',
                type: ChannelType.GuildCategory,
            });
        }

        // 2. Create Private Text Channel
        const textChannel = await guild.channels.create({
            name: `lobby-${matchId}`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                },
                ...players.map(p => ({
                    id: p.user.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                })),
            ],
        });

        // 3. Create Voice Channels (layout driven by the mode config)
        const voiceChannels: string[] = [];
        const modeCfg = getModeConfig(game, queueMode);
        const teamSize = modeCfg?.teamSize ?? 5;
        const voiceLayout = modeCfg?.voiceLayout ?? 'perTeam';
        const teamCount = teamCountOverride ?? modeCfg?.teamCount ?? 2;

        const voiceSpecs: { name: string; limit: number }[] = [];
        if (voiceLayout === 'shared') {
            // Single shared voice channel (e.g. TFT Solo)
            voiceSpecs.push({ name: `Match #${matchId} - Lobby`, limit: Math.max(players.length, teamSize * teamCount) });
        } else if (teamCount === 2) {
            voiceSpecs.push({ name: `Match #${matchId} - Blue`, limit: teamSize });
            voiceSpecs.push({ name: `Match #${matchId} - Red`, limit: teamSize });
        } else {
            for (let i = 1; i <= teamCount; i++) {
                voiceSpecs.push({ name: `Match #${matchId} - Team ${i}`, limit: teamSize });
            }
        }

        for (const spec of voiceSpecs) {
            const channel = await guild.channels.create({
                name: spec.name,
                type: ChannelType.GuildVoice,
                parent: category.id,
                userLimit: spec.limit,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.Connect], // Locked by default
                        allow: [PermissionFlagsBits.ViewChannel] // Visible but locked
                    },
                    // Specific team overwrites are added by Matchmaker once teams are known
                ],
            });
            voiceChannels.push(channel.id);
        }

        const state: LobbyState = {
            matchId,
            game,
            queueMode,
            guildId: guild.id,
            textChannelId: textChannel.id,
            voiceChannelId1: voiceChannels[0],
            voiceChannelId2: voiceChannels[1] ?? voiceChannels[0], // shared layout has a single channel
            extraVoiceChannelIds: voiceChannels.slice(2),
            players,
            team1: [],
            team2: [],
            mode
        };

        this.lobbies.set(textChannel.id, state);
        this.lobbiesByMatch.set(matchId, state);

        // 4. Delegate to Strategy (Initial Message)
        const strategy = this.strategies.get(game);
        if (!strategy) {
            await textChannel.send('Basic lobby created. Waiting for teams...');
        }

        return state;
    }

    async onMatchReady(state: LobbyState, guild: Guild) {
        // This is called by Matchmaker once teams are finalized
        const channel = await guild.channels.fetch(state.textChannelId) as TextChannel;
        if (!channel) return;

        const strategy = this.strategies.get(state.game);
        if (strategy) {
            await strategy.onLobbyReady(state, channel);
        }

        // Standard secure report controls (buttons / position select) — zero slash-command needed
        const { getManagers } = await import('./registry');
        await getManagers().report.postReportControls(state, channel);
    }

    getLobby(channelId: string) {
        return this.lobbies.get(channelId);
    }

    getLobbyByMatchId(matchId: number) {
        return this.lobbiesByMatch.get(matchId);
    }

    deleteLobby(channelId: string) {
        const state = this.lobbies.get(channelId);
        if (state) this.lobbiesByMatch.delete(state.matchId);
        this.lobbies.delete(channelId);
    }

    async cleanupMatch(matchId: number, guild: Guild) {
        const { prisma } = await import('../utils/db');
        const { UserManager } = await import('./UserManager');
        const lobby = this.lobbiesByMatch.get(matchId);
        const channelIds = new Set<string>();
        if (lobby) {
            channelIds.add(lobby.textChannelId);
            channelIds.add(lobby.voiceChannelId1);
            channelIds.add(lobby.voiceChannelId2);
            (lobby.extraVoiceChannelIds || []).forEach(id => channelIds.add(id));
        }
        const match = await prisma.match.findUnique({ where: { id: matchId }, include: { players: true } });
        if (match?.channelId1) channelIds.add(match.channelId1);
        if (match?.channelId2) channelIds.add(match.channelId2);
        if (match?.textChannelId) channelIds.add(match.textChannelId);
        if (match?.voiceChannelIds) {
            try {
                const ids: string[] = JSON.parse(match.voiceChannelIds);
                ids.forEach(id => channelIds.add(id));
            } catch (err) {
                console.error(`[cleanupMatch] Invalid voiceChannelIds JSON for match #${matchId}`);
            }
        }
        if (!lobby) {
            const orphanText = guild.channels.cache.find(c => c.name === `lobby-${matchId}` && c.type === ChannelType.GuildText);
            if (orphanText) channelIds.add(orphanText.id);
        }
        for (const id of channelIds) {
            if (!id) continue;
            const channel = guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
            if (channel) await channel.delete().catch(err => console.error(`[cleanupMatch] delete ${id}:`, (err as any)?.message));
        }
        const playerIds = match?.players.map(p => p.userId) ?? lobby?.players.map(p => p.user.id) ?? [];
        for (const userId of playerIds) {
            await UserManager.resetStatus(userId).catch(() => { });
        }
        if (lobby) {
            this.lobbies.delete(lobby.textChannelId);
            this.lobbiesByMatch.delete(matchId);
        }
    }
}

export const lobbyManager = new LobbyManager();
