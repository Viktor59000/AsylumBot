import { Client, TextChannel } from 'discord.js';
import { queueManager } from './QueueManager';
import { createQueueEmbed } from '../utils/embeds';
import { queueKey, parseQueueKey } from '../utils/constants';
import { logger } from '../utils/logger';

const THROTTLE_MS = 2000;

/**
 * Keeps the permanent queue message (GameConfig.queueMessageId) in sync with
 * the in-memory queue. Listens to `queueUpdate` and edits the message with a
 * trailing throttle so bursts of joins/leaves don't hit the rate limit.
 */
export class QueueMessageUpdater {
    private client: Client;
    private pending: Map<string, NodeJS.Timeout> = new Map(); // Key: queueKey(game, mode)
    private listener = (game: string, mode: string) => this.scheduleUpdate(game, mode);

    constructor(client: Client) {
        this.client = client;
        queueManager.on('queueUpdate', this.listener);
    }

    private scheduleUpdate(game: string, mode: string) {
        const key = queueKey(game, mode);
        if (this.pending.has(key)) return; // An update is already scheduled; it will render the latest state
        this.pending.set(key, setTimeout(() => {
            this.pending.delete(key);
            this.updateMessage(game, mode).catch(err => logger.error(`[QueueMessageUpdater] Failed to update "${key}":`, err));
        }, THROTTLE_MS));
    }

    private async updateMessage(game: string, mode: string) {
        const config = queueManager.getConfig(game, mode);
        if (!config?.channelId || !config.queueMessageId) return;

        const channel = await this.client.channels.fetch(config.channelId).catch(() => null) as TextChannel | null;
        if (!channel) return;

        const message = await channel.messages.fetch(config.queueMessageId).catch(() => null);
        if (!message) return;

        const queue = queueManager.getQueue(game, mode);
        const required = queueManager.getRequiredPlayers(game, mode);
        const { embed, files } = createQueueEmbed(game, mode, queue, required);
        await message.edit({ embeds: [embed], files });
    }

    destroy() {
        queueManager.off('queueUpdate', this.listener);
        for (const timer of this.pending.values()) clearTimeout(timer);
        this.pending.clear();
    }
}
