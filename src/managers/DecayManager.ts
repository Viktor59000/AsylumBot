import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { prisma } from '../utils/db';
import { COLORS, EMOJIS } from '../utils/constants';
import { scheduleDailyUtc } from '../utils/dailyTask';
import { logger } from '../utils/logger';

export class DecayManager {
    private client: Client;
    private cancelDailyDecay?: () => void;
    private readonly DECAY_AMOUNT = 10;
    private readonly INACTIVITY_DAYS = 7;

    constructor(client: Client) {
        this.client = client;
    }

    /** Idempotent daily decay at 05:00 UTC (persisted in BotState, so frequent redeploys neither skip nor double it). */
    start() {
        if (this.cancelDailyDecay) return;
        this.cancelDailyDecay = scheduleDailyUtc('elo_decay', 5, () => this.processDecay());
    }

    destroy() {
        this.cancelDailyDecay?.();
        this.cancelDailyDecay = undefined;
    }

    async processDecay() {
        logger.info('Running Decay Check...');
        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() - this.INACTIVITY_DAYS);

        // Find inactive players with rating > 1000
        const inactiveElos = await prisma.elo.findMany({
            where: {
                lastMatchDate: {
                    lt: thresholdDate
                },
                rating: {
                    gt: 1000
                }
            },
            include: {
                user: true
            }
        });

        for (const elo of inactiveElos) {
            const newRating = Math.max(1000, elo.rating - this.DECAY_AMOUNT);
            const lost = elo.rating - newRating;

            if (lost > 0) {
                await prisma.elo.update({
                    where: { id: elo.id },
                    data: { rating: newRating }
                });

                logger.info(`Decayed ${elo.user.username} (${elo.game}) by ${lost} points.`);

                // Notify User (Try DM)
                try {
                    const user = await this.client.users.fetch(elo.userId);
                    if (user) {
                        const embed = new EmbedBuilder()
                            .setTitle(`${EMOJIS.WARNING} MMR Decay Alert`)
                            .setDescription(`You have lost **${lost} MMR** in **${elo.game.toUpperCase()}** due to inactivity (> ${this.INACTIVITY_DAYS} days).`)
                            .addFields(
                                { name: 'Old Rating', value: elo.rating.toString(), inline: true },
                                { name: 'New Rating', value: newRating.toString(), inline: true }
                            )
                            .setColor(COLORS.WARNING as any);

                        await user.send({ embeds: [embed] }).catch(() => { });
                    }
                } catch (err) {
                    // Ignore DM errors
                }
            }
        }
    }
}
