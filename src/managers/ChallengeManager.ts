import { Client, EmbedBuilder } from 'discord.js';
import { prisma } from '../utils/db';
import { COLORS, EMOJIS, GAME_CONFIGS } from '../utils/constants';
import { scheduleDailyUtc, getBotState, setBotState } from '../utils/dailyTask';
import { logger } from '../utils/logger';

/** ISO week key "YYYY-Www" (UTC) used for the idempotent weekly reset. */
const isoWeekKey = (d: Date = new Date()): string => {
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day); // nearest Thursday
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

export interface ChallengeContext {
    game?: string;
    coinMultiplier?: number; // rush hour multiplier (default 1)
}

export class ChallengeManager {
    private client: Client;
    private cancelDailyReset?: () => void;

    // Daily
    private readonly DAILY_REWARD = 50;
    private readonly DAILY_GOAL_PLAYED = 3;
    private readonly DAILY_GOAL_WON = 1;
    // Weekly
    private readonly WEEKLY_GOAL_PLAYED = 10;
    private readonly WEEKLY_REWARD_PLAYED = 150;
    private readonly WEEKLY_GOAL_WON = 5;
    private readonly WEEKLY_REWARD_WON = 100;
    // Per-game: first win of the day
    private readonly FIRST_WIN_REWARD = 25;

    constructor(client: Client) {
        this.client = client;
    }

    /** Idempotent resets at 00:00 UTC: daily always, weekly when the ISO week changes. */
    start() {
        if (this.cancelDailyReset) return;
        this.cancelDailyReset = scheduleDailyUtc('challenges_daily_reset', 0, async () => {
            await this.resetDailyProgress();
            await this.resetWeeklyIfNewWeek();
        });
        // Weekly catch-up also runs at boot (scheduleDailyUtc catches up daily; the
        // week check below is its own guard so a Monday spent offline isn't lost).
        void this.resetWeeklyIfNewWeek().catch(err => logger.error('[challenges] weekly check failed:', err));
    }

    destroy() {
        this.cancelDailyReset?.();
        this.cancelDailyReset = undefined;
    }

    async resetDailyProgress() {
        logger.info('Resetting Daily Challenges...');
        await prisma.dailyProgress.updateMany({
            data: {
                matchesPlayed: 0,
                matchesWon: 0,
                lastUpdate: new Date()
            }
        });
    }

    async resetWeeklyIfNewWeek() {
        const currentWeek = isoWeekKey();
        const lastWeek = await getBotState('challenges_weekly_last');
        if (lastWeek === currentWeek) return;
        await setBotState('challenges_weekly_last', currentWeek);
        logger.info(`Resetting Weekly Challenges (${currentWeek})...`);
        await prisma.weeklyProgress.updateMany({
            data: { matchesPlayed: 0, matchesWon: 0, lastUpdate: new Date() }
        });
    }

    async updateProgress(userId: string, won: boolean, context: ChallengeContext = {}) {
        const mult = Math.max(1, context.coinMultiplier ?? 1);
        const boosted = mult > 1 ? ` 🔥×${mult}` : '';
        let coinsEarned = 0;
        const messages: string[] = [];

        // ---- Daily ----
        let daily = await prisma.dailyProgress.findUnique({ where: { userId } });
        if (!daily) {
            daily = await prisma.dailyProgress.create({ data: { userId } });
        }

        const dailyPlayedBefore = daily.matchesPlayed >= this.DAILY_GOAL_PLAYED;
        const dailyWonBefore = daily.matchesWon >= this.DAILY_GOAL_WON;

        const updatedDaily = await prisma.dailyProgress.update({
            where: { id: daily.id },
            data: {
                matchesPlayed: { increment: 1 },
                matchesWon: { increment: won ? 1 : 0 },
                lastUpdate: new Date()
            }
        });

        if (!dailyPlayedBefore && updatedDaily.matchesPlayed >= this.DAILY_GOAL_PLAYED) {
            const reward = Math.round(this.DAILY_REWARD * mult);
            coinsEarned += reward;
            messages.push(`✅ **Daily:** Play ${this.DAILY_GOAL_PLAYED} Matches (+${reward} 🪙${boosted})`);
        }
        if (!dailyWonBefore && updatedDaily.matchesWon >= this.DAILY_GOAL_WON) {
            const reward = Math.round(this.DAILY_REWARD * mult);
            coinsEarned += reward;
            messages.push(`✅ **Daily:** Win ${this.DAILY_GOAL_WON} Match (+${reward} 🪙${boosted})`);
        }

        // ---- Weekly ----
        let weekly = await prisma.weeklyProgress.findUnique({ where: { userId } });
        if (!weekly) {
            weekly = await prisma.weeklyProgress.create({ data: { userId } });
        }

        const weeklyPlayedBefore = weekly.matchesPlayed >= this.WEEKLY_GOAL_PLAYED;
        const weeklyWonBefore = weekly.matchesWon >= this.WEEKLY_GOAL_WON;

        const updatedWeekly = await prisma.weeklyProgress.update({
            where: { id: weekly.id },
            data: {
                matchesPlayed: { increment: 1 },
                matchesWon: { increment: won ? 1 : 0 },
                lastUpdate: new Date()
            }
        });

        if (!weeklyPlayedBefore && updatedWeekly.matchesPlayed >= this.WEEKLY_GOAL_PLAYED) {
            const reward = Math.round(this.WEEKLY_REWARD_PLAYED * mult);
            coinsEarned += reward;
            messages.push(`🏅 **Weekly:** Play ${this.WEEKLY_GOAL_PLAYED} Matches (+${reward} 🪙${boosted})`);
        }
        if (!weeklyWonBefore && updatedWeekly.matchesWon >= this.WEEKLY_GOAL_WON) {
            const reward = Math.round(this.WEEKLY_REWARD_WON * mult);
            coinsEarned += reward;
            messages.push(`🏅 **Weekly:** Win ${this.WEEKLY_GOAL_WON} Matches (+${reward} 🪙${boosted})`);
        }

        // ---- Per-game: first win of the day ----
        if (won && context.game) {
            const today = new Date().toISOString().slice(0, 10);
            const created = await prisma.dailyGameWin.create({
                data: { userId, game: context.game, date: today }
            }).catch(() => null); // unique violation → already claimed today
            if (created) {
                const reward = Math.round(this.FIRST_WIN_REWARD * mult);
                coinsEarned += reward;
                const gameName = GAME_CONFIGS[context.game as keyof typeof GAME_CONFIGS]?.name ?? context.game;
                messages.push(`🌟 **First win of the day** — ${gameName} (+${reward} 🪙${boosted})`);
            }
        }

        // ---- Payout + DM ----
        if (coinsEarned > 0) {
            await prisma.user.update({
                where: { id: userId },
                data: { coins: { increment: coinsEarned } }
            });

            const user = await this.client.users.fetch(userId).catch(() => null);
            if (user) {
                const embed = new EmbedBuilder()
                    .setTitle(`${EMOJIS.SUCCESS} Challenge Completed!`)
                    .setDescription(messages.join('\n'))
                    .setColor(COLORS.ASYLUM_GOLD as any);
                await user.send({ embeds: [embed] }).catch(() => { });
            }
        }
    }
}
