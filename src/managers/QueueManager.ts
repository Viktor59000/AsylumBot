import { Collection, User } from 'discord.js';
import { EventEmitter } from 'events';
import { GAME_CONFIGS, GAME_MODES, MatchType, getModeConfig, queueKey, parseQueueKey } from '../utils/constants';
import { t, Language } from '../utils/i18n';
import { UserManager } from './UserManager';

export interface QueuePlayer {
    user: User;
    joinedAt: Date;
    groupId?: string;
}

export type PlayerState = 'IDLE' | 'QUEUED' | 'READY_CHECK' | 'IN_GAME';

export interface QueueConfig {
    game: string;
    mode: string;
    name: string;      // Display name, e.g. "Rocket League 1v1"
    teamSize: number;
    teamCount: number;
    matchType: MatchType;
    channelId: string;
    guildId?: string;
    queueMessageId?: string;
}

/**
 * Queues are indexed by (game, mode) — one queue channel per mode (Lot 1).
 * Events: `queueUpdate(game, mode)` and `queueFull(game, mode, players)`.
 */
export class QueueManager extends EventEmitter {
    private queues: Collection<string, QueuePlayer[]>; // Key: queueKey(game, mode)
    private configs: Collection<string, QueueConfig>;  // Key: queueKey(game, mode)

    constructor() {
        super();
        this.queues = new Collection();
        this.configs = new Collection();

        // Initialize default configs from constants (channelId bound at ready / /setup)
        for (const [game, modes] of Object.entries(GAME_MODES)) {
            const gameName = GAME_CONFIGS[game as keyof typeof GAME_CONFIGS]?.name ?? game;
            for (const [mode, modeCfg] of Object.entries(modes)) {
                this.configs.set(queueKey(game, mode), {
                    game,
                    mode,
                    name: `${gameName} ${modeCfg.name}`,
                    teamSize: modeCfg.teamSize,
                    teamCount: modeCfg.teamCount,
                    matchType: modeCfg.matchType,
                    channelId: '',
                });
            }
        }
    }

    getQueue(game: string, mode: string): QueuePlayer[] {
        const key = queueKey(game, mode);
        if (!this.queues.has(key)) {
            this.queues.set(key, []);
        }
        return this.queues.get(key)!;
    }

    setChannel(game: string, mode: string, channelId: string, guildId?: string, queueMessageId?: string) {
        const key = queueKey(game, mode);
        const existing = this.configs.get(key);
        if (existing) {
            existing.channelId = channelId;
            if (guildId) existing.guildId = guildId;
            if (queueMessageId) existing.queueMessageId = queueMessageId;
        } else {
            const gameName = GAME_CONFIGS[game as keyof typeof GAME_CONFIGS]?.name ?? game;
            const modeCfg = getModeConfig(game, mode);
            this.configs.set(key, {
                game,
                mode,
                name: `${gameName} ${modeCfg?.name ?? mode}`,
                teamSize: modeCfg?.teamSize ?? 5,
                teamCount: modeCfg?.teamCount ?? 2,
                matchType: modeCfg?.matchType ?? 'tvt',
                channelId,
                guildId,
                queueMessageId,
            });
        }
    }

    /** All queues, keyed by queueKey(game, mode) — use parseQueueKey on the key. */
    getAllQueues(): Collection<string, QueuePlayer[]> {
        return this.queues;
    }

    async addPlayer(game: string, mode: string, user: User, groupId?: string, lang: Language = 'en'): Promise<{ success: boolean; reason?: string }> {
        const config = this.configs.get(queueKey(game, mode));
        if (!config) {
            return { success: false, reason: `❌ Unknown queue: ${game} ${mode}.` };
        }

        // Check IGN exists (per game — shared across the game's modes)
        const { prisma } = await import('../utils/db');

        const userIgn = await prisma.userIgn.findUnique({
            where: { userId_game: { userId: user.id, game } }
        });

        if (!userIgn) {
            const { GAME_CONFIGS } = await import('../utils/constants');
            const gameName = GAME_CONFIGS[game as keyof typeof GAME_CONFIGS]?.name || game;
            return {
                success: false,
                reason: `❌ You must set your IGN first!\nUse \`/ign game:${game} pseudo:YourName\` to register for **${gameName}**.`
            };
        }

        // Check Suspension
        const activePenalty = await prisma.penalty.findFirst({
            where: {
                userId: user.id,
                expiresAt: { gt: new Date() },
                type: 'queue_ban'
            }
        });

        if (activePenalty) {
            return { success: false, reason: `Suspended until ${activePenalty.expiresAt.toLocaleTimeString()} (${activePenalty.reason})` };
        }

        // Atomic Status Check & Lock: QUEUED only if currently IDLE (prevents double-queue races)
        const updateResult = await prisma.user.updateMany({
            where: {
                id: user.id,
                status: 'IDLE'
            },
            data: {
                status: 'QUEUED'
            }
        });

        if (updateResult.count === 0) {
            // Not IDLE — or new user with no DB row yet
            const existing = await prisma.user.findUnique({ where: { id: user.id } });
            if (!existing) {
                await prisma.user.create({
                    data: { id: user.id, username: user.username, status: 'QUEUED' }
                });
                // Proceed to add to queue
            } else {
                return { success: false, reason: t('queue_already_in', lang) };
            }
        }

        // Status locked to QUEUED in DB from here on.

        const queue = this.getQueue(game, mode);
        // Secondary safety: strict in-memory duplicate check
        if (queue.some((p) => p.user.id === user.id)) {
            await UserManager.resetStatus(user.id);
            return { success: false, reason: t('queue_already_in', lang) };
        }

        queue.push({ user, joinedAt: new Date(), groupId });
        this.emit('queueUpdate', game, mode);

        if (this.isQueueFull(game, mode)) {
            this.emit('queueFull', game, mode, [...queue]);
        }

        return { success: true };
    }

    // Helper for legacy support or internal use, though direct UserManager usage is preferred.
    async setPlayerState(userId: string, state: import('./UserManager').UserStatus) {
        await UserManager.setStatus(userId, state);
    }

    async getPlayerState(userId: string): Promise<string> {
        return await UserManager.getStatus(userId);
    }

    async removePlayerFromAllQueues(userId: string) {
        let removed = false;
        this.queues.forEach((queue, key) => {
            const index = queue.findIndex(p => p.user.id === userId);
            if (index !== -1) {
                queue.splice(index, 1);
                const { game, mode } = parseQueueKey(key);
                this.emit('queueUpdate', game, mode);
                removed = true;
            }
        });

        if (removed) {
            await UserManager.resetStatus(userId);
        }
    }

    async removePlayer(game: string, mode: string, userId: string): Promise<boolean> {
        const queue = this.getQueue(game, mode);
        const index = queue.findIndex((p) => p.user.id === userId);
        if (index !== -1) {
            queue.splice(index, 1);
            this.emit('queueUpdate', game, mode);

            // Single-queue lock: removed from their only queue → back to IDLE
            await UserManager.resetStatus(userId);
            return true;
        }
        return false;
    }

    isQueueFull(game: string, mode: string): boolean {
        const queue = this.getQueue(game, mode);
        const config = this.configs.get(queueKey(game, mode));
        if (!config) return false;
        return queue.length >= config.teamSize * config.teamCount;
    }

    getRequiredPlayers(game: string, mode: string): number {
        const config = this.configs.get(queueKey(game, mode));
        return config ? config.teamSize * config.teamCount : 0;
    }

    clearQueue(game: string, mode: string) {
        this.queues.set(queueKey(game, mode), []);
        this.emit('queueUpdate', game, mode);
    }

    getConfig(game: string, mode: string): QueueConfig | undefined {
        return this.configs.get(queueKey(game, mode));
    }

    /** All configured modes of a game. */
    getGameConfigs(game: string): QueueConfig[] {
        return Array.from(this.configs.values()).filter(c => c.game === game);
    }

    forceStart(game: string, mode: string): { success: boolean; reason?: string } {
        const queue = this.getQueue(game, mode);
        if (queue.length < 2) {
            return { success: false, reason: 'Need at least 2 players to force start.' };
        }

        // Emit queueFull with current players
        this.emit('queueFull', game, mode, [...queue]);
        return { success: true };
    }
}

export const queueManager = new QueueManager();
