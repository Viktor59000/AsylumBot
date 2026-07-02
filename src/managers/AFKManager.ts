import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, Collection } from 'discord.js';
import { queueManager, QueuePlayer } from './QueueManager';

export class AFKManager {
    private checkInterval: NodeJS.Timeout | null = null;
    private readonly WARNING_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
    private readonly REMOVAL_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes
    private warnedUsers: Set<string> = new Set();

    constructor() {
        this.startMonitoring();
    }

    startMonitoring() {
        if (this.checkInterval) return;
        this.checkInterval = setInterval(() => this.checkQueues(), 60 * 1000); // Check every minute
    }

    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    async checkQueues() {
        const queues = queueManager.getAllQueues();
        const now = Date.now();

        queues.forEach((queue, game) => {
            // iterate backwards to allow removal
            for (let i = queue.length - 1; i >= 0; i--) {
                const player = queue[i];
                const joinTime = player.joinedAt.getTime();
                const diff = now - joinTime;

                if (diff > this.REMOVAL_THRESHOLD_MS) {
                    // Remove
                    queueManager.removePlayer(game, player.user.id);
                    player.user.send('❌ **Removed from queue due to inactivity.**').catch(() => { });
                    this.warnedUsers.delete(player.user.id);
                } else if (diff > this.WARNING_THRESHOLD_MS) {
                    // Warn
                    if (!this.warnedUsers.has(player.user.id)) {
                        this.sendWarning(player, game);
                        this.warnedUsers.add(player.user.id);
                    }
                }
            }
        });
    }

    async sendWarning(player: QueuePlayer, game: string) {
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`afk_keep_${game}`)
                    .setLabel('Keep Queuing')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`afk_leave_${game}`)
                    .setLabel('Leave Queue')
                    .setStyle(ButtonStyle.Danger)
            );

        await player.user.send({
            content: `⚠️ **AFK Check:** You have been in the **${game}** queue for over 15 minutes.`,
            components: [row]
        }).catch(() => {
            // If DM fails, maybe assume AFK and remove? Or ignore.
        });
    }

    async handleInteraction(interaction: ButtonInteraction) {
        const [action, type, game] = interaction.customId.split('_');

        if (type === 'keep') {
            // Reset timer?
            // We can't easily reset joinedAt in QueueManager without modifying it.
            // But we can remove from warnedUsers so they don't get warned again immediately?
            // Actually if we don't update joinedAt, they will hit REMOVAL_THRESHOLD_MS regardless in 5 mins.
            // So we MUST update joinedAt.

            // QueueManager allows accessing queue by ref.
            const queue = queueManager.getAllQueues().get(game);
            const player = queue?.find(p => p.user.id === interaction.user.id);
            if (player) {
                player.joinedAt = new Date(); // Reset timer
                this.warnedUsers.delete(player.user.id);
                await interaction.reply({ content: '✅ Queue timer reset. Happy waiting!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'You are no longer in that queue.', ephemeral: true });
            }
        } else if (type === 'leave') {
            await queueManager.removePlayer(game, interaction.user.id);
            await interaction.reply({ content: '✅ Left the queue.', ephemeral: true });
        }
    }
}

export const afkManager = new AFKManager();
