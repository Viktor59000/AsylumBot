import { Client, EmbedBuilder, User } from 'discord.js';
import { prisma } from '../utils/db';
import { COLORS, EMOJIS } from '../utils/constants';

export class ChallengeManager {
    private client: Client;
    private readonly REWARD_COINS = 50;
    private readonly GOAL_PLAYED = 3;
    private readonly GOAL_WON = 1;

    constructor(client: Client) {
        this.client = client;
        this.startDailyReset();
    }

    startDailyReset() {
        // Reset at midnight (simplified check every hour)
        setInterval(async () => {
            const now = new Date();
            if (now.getHours() === 0 && now.getMinutes() < 5) {
                await this.resetDailyProgress();
            }
        }, 5 * 60 * 1000); // Check every 5 mins
    }

    async resetDailyProgress() {
        console.log('Resetting Daily Challenges...');
        await prisma.dailyProgress.updateMany({
            data: {
                matchesPlayed: 0,
                matchesWon: 0,
                lastUpdate: new Date()
            }
        });
    }

    async updateProgress(userId: string, won: boolean) {
        // Get or Create Daily Progress
        let daily = await prisma.dailyProgress.findUnique({
            where: { userId }
        });

        if (!daily) {
            daily = await prisma.dailyProgress.create({
                data: { userId }
            });
        }

        // Check if already completed (to avoid double rewards if we want strictly daily caps)
        // For now, let's just cap rewards or allow infinite? Plan said "Daily Goals".
        // Let's assume rewards are once per day per goal.
        const playedCompletedBefore = daily.matchesPlayed >= this.GOAL_PLAYED;
        const wonCompletedBefore = daily.matchesWon >= this.GOAL_WON;

        // Update Stats
        const updatedDaily = await prisma.dailyProgress.update({
            where: { id: daily.id },
            data: {
                matchesPlayed: { increment: 1 },
                matchesWon: { increment: won ? 1 : 0 },
                lastUpdate: new Date()
            }
        });

        // Check Completion & Reward
        let coinsEarned = 0;
        const messages: string[] = [];

        if (!playedCompletedBefore && updatedDaily.matchesPlayed >= this.GOAL_PLAYED) {
            coinsEarned += this.REWARD_COINS;
            messages.push(`✅ **Goal Reached:** Play ${this.GOAL_PLAYED} Matches (+${this.REWARD_COINS} 🪙)`);
        }

        if (!wonCompletedBefore && updatedDaily.matchesWon >= this.GOAL_WON) {
            coinsEarned += this.REWARD_COINS;
            messages.push(`✅ **Goal Reached:** Win ${this.GOAL_WON} Match (+${this.REWARD_COINS} 🪙)`);
        }

        if (coinsEarned > 0) {
            await prisma.user.update({
                where: { id: userId },
                data: { coins: { increment: coinsEarned } }
            });

            // Notify User
            const user = await this.client.users.fetch(userId).catch(() => null);
            if (user) {
                const embed = new EmbedBuilder()
                    .setTitle(`${EMOJIS.SUCCESS} Daily Challenge Completed!`)
                    .setDescription(messages.join('\n'))
                    .setColor(COLORS.ASYLUM_GOLD as any);
                await user.send({ embeds: [embed] }).catch(() => { });
            }
        }
    }
}
