import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { prisma } from '../utils/db';
import { COLORS, EMOJIS } from '../utils/constants';

export class DecayManager {
    private client: Client;
    private interval: NodeJS.Timeout | null = null;
    private readonly DECAY_AMOUNT = 10;
    private readonly INACTIVITY_DAYS = 7;

    constructor(client: Client) {
        this.client = client;
        this.startDecayCheck();
    }

    startDecayCheck() {
        // Run check every 24 hours
        this.interval = setInterval(() => {
            this.processDecay();
        }, 24 * 60 * 60 * 1000);

        // Run immediately on startup (optional, or wait for first interval)
        // this.processDecay();
    }

    async processDecay() {
        console.log('Running Decay Check...');
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

                console.log(`Decayed ${elo.user.username} (${elo.game}) by ${lost} points.`);

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
