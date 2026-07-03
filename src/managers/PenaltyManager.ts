import { Client, EmbedBuilder, User } from 'discord.js';
import { prisma } from '../utils/db';
import { COLORS, EMOJIS } from '../utils/constants';

export class PenaltyManager {
    private client: Client;

    constructor(client: Client) {
        this.client = client;
    }

    async suspendUser(userId: string, durationMinutes: number, reason: string, type: 'queue_ban' = 'queue_ban') {
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + durationMinutes);

        await prisma.penalty.create({
            data: {
                userId,
                type,
                reason,
                duration: durationMinutes,
                expiresAt
            }
        });

        // Notify User
        const user = await this.client.users.fetch(userId).catch(() => null);
        if (user) {
            const embed = new EmbedBuilder()
                .setTitle(`${EMOJIS.ERROR} Account Suspended`)
                .setDescription(`You have been suspended from the queue.`)
                .addFields(
                    { name: 'Reason', value: reason },
                    { name: 'Duration', value: `${durationMinutes} minutes` },
                    { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>` }
                )
                .setColor(COLORS.DANGER as any);

            await user.send({ embeds: [embed] }).catch(() => { });
        }
    }

    /**
     * No-show/dodge penalty (ready-check declined or expired): escalating
     * queue-ban 5 → 15 → 30 min based on offences in the last 24h.
     * Returns the applied duration in minutes.
     */
    async applyNoShowPenalty(userId: string, context: string): Promise<number> {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentOffences = await prisma.penalty.count({
            where: { userId, type: 'queue_ban', createdAt: { gt: since } }
        });

        const durations = [5, 15, 30];
        const duration = durations[Math.min(recentOffences, durations.length - 1)];

        await this.suspendUser(userId, duration, `No-show: ${context}`);
        return duration;
    }

    async isSuspended(userId: string): Promise<{ suspended: boolean; reason?: string; expiresAt?: Date }> {
        const activePenalty = await prisma.penalty.findFirst({
            where: {
                userId,
                expiresAt: {
                    gt: new Date()
                }
            },
            orderBy: {
                expiresAt: 'desc'
            }
        });

        if (activePenalty) {
            return {
                suspended: true,
                reason: activePenalty.reason || 'No reason provided',
                expiresAt: activePenalty.expiresAt
            };
        }

        return { suspended: false };
    }
}
