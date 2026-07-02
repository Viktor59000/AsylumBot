import { Collection, User } from 'discord.js';
import { EventEmitter } from 'events';
import { GAME_CONFIGS } from '../utils/constants';
import { t, Language } from '../utils/i18n';
import { UserManager } from './UserManager';

export interface QueuePlayer {
    user: User;
    joinedAt: Date;
    groupId?: string;
}

export type PlayerState = 'IDLE' | 'IN_QUEUE' | 'READY_CHECK' | 'IN_GAME';

export interface GameConfig {
    name: string;
    teamSize: number;
    channelId: string;
    guildId?: string;
}

export class QueueManager extends EventEmitter {
    private queues: Collection<string, QueuePlayer[]>;
    private configs: Collection<string, GameConfig>;

    constructor() {
        super();
        this.queues = new Collection();
        this.configs = new Collection();

        // Initialize default configs from constants
        Object.entries(GAME_CONFIGS).forEach(([key, value]) => {
            this.configs.set(key, { ...value, channelId: '' });
        });
    }

    getQueue(game: string): QueuePlayer[] {
        if (!this.queues.has(game)) {
            this.queues.set(game, []);
        }
        return this.queues.get(game)!;
    }

    setChannel(game: string, channelId: string, guildId?: string) {
        const existing = this.configs.get(game);
        if (existing) {
            existing.channelId = channelId;
            if (guildId) existing.guildId = guildId;
        } else {
            const base = GAME_CONFIGS[game as keyof typeof GAME_CONFIGS];
            this.configs.set(game, {
                name: base?.name ?? game,
                teamSize: base?.teamSize ?? 5,
                channelId,
                guildId,
            });
        }
    }

    getAllQueues(): Collection<string, QueuePlayer[]> {
        return this.queues;
    }

    async addPlayer(game: string, user: User, groupId?: string, lang: Language = 'en'): Promise<{ success: boolean; reason?: string }> {
        // Check IGN exists
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

        // Atomic Status Check & Lock
        // We attempt to update the user status to 'QUEUED' ONLY IF it is currently 'IDLE'.
        // This prevents race conditions where two requests check isIdle() == true simultaneously.
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
            // If count is 0, user was not IDLE (or doesn't exist).
            // We check if they exist first, or we assume they do because of interaction context.
            // But if they are new, they might not have a DB entry yet.
            // If they are new, their status is technically IDLE but DB row missing.

            // To be safe for new users: Upsert loosely first? 
            // Better: Check if user exists. If not, create as QUEUED.
            // If exists, use atomic lock.

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

        // If we reached here, we successfully locked the user status to QUEUED in DB.

        const queue = this.getQueue(game);
        // Secondary Safety: Check in-memory queue strictly to avoid duplicates if DB state desyncs manually
        if (queue.some((p) => p.user.id === user.id)) {
            // Inconsistency detected. Revert DB status.
            await UserManager.resetStatus(user.id);
            return { success: false, reason: t('queue_already_in', lang) };
        }

        queue.push({ user, joinedAt: new Date(), groupId });
        this.emit('queueUpdate', game, queue); // Emit event for UI updates

        if (this.isQueueFull(game)) {
            this.emit('queueFull', game, [...queue]);
        }

        return { success: true };
    }

    // Helper for legacy support or internal use, though direct UserManager usage is preferred.
    async setPlayerState(userId: string, state: any) {
        // Cast to UserStatus if needed, but 'IN_QUEUE' matches.
        // This is mostly for compatibility if other files call it.
        await UserManager.setStatus(userId, state);
    }

    async getPlayerState(userId: string): Promise<string> {
        return await UserManager.getStatus(userId);
    }

    async removePlayerFromAllQueues(userId: string) {
        let removed = false;
        this.queues.forEach((queue, game) => {
            const index = queue.findIndex(p => p.user.id === userId);
            if (index !== -1) {
                queue.splice(index, 1);
                this.emit('queueUpdate', game);
                removed = true;
            }
        });

        if (removed) {
            await UserManager.resetStatus(userId);
        }
    }

    async removePlayer(game: string, userId: string): Promise<boolean> {
        const queue = this.getQueue(game);
        const index = queue.findIndex((p) => p.user.id === userId);
        if (index !== -1) {
            queue.splice(index, 1);
            this.emit('queueUpdate', game, queue);

            // Since we enforce single queue, if they are removed, they are idle.
            // Unless they were in multiple queues which is now impossible.
            await UserManager.resetStatus(userId);
            return true;
        }
        return false;
    }

    isQueueFull(game: string): boolean {
        const queue = this.getQueue(game);
        const config = this.configs.get(game);
        if (!config) return false;
        return queue.length >= config.teamSize * 2;
    }

    getRequiredPlayers(game: string): number {
        const config = this.configs.get(game);
        return config ? config.teamSize * 2 : 0;
    }

    clearQueue(game: string) {
        this.queues.set(game, []);
        this.emit('queueUpdate', game);
    }

    getConfig(game: string): GameConfig | undefined {
        return this.configs.get(game);
    }

    forceStart(game: string): { success: boolean; reason?: string } {
        const queue = this.getQueue(game);
        if (queue.length < 2) {
            return { success: false, reason: 'Need at least 2 players to force start.' };
        }

        // Emit queueFull with current players
        this.emit('queueFull', game, [...queue]);
        return { success: true };
    }
}

export const queueManager = new QueueManager();
