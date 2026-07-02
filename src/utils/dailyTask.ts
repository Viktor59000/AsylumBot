import { prisma } from './db';
import { logger } from './logger';

export async function getBotState(key: string): Promise<string | null> {
    const row = await prisma.botState.findUnique({ where: { key } });
    return row?.value ?? null;
}

export async function setBotState(key: string, value: string): Promise<void> {
    await prisma.botState.upsert({
        where: { key },
        update: { value },
        create: { key, value },
    });
}

const todayUtc = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

/**
 * Runs `task` once per UTC day at `hourUtc`. Idempotent across restarts:
 * the last run date is persisted in BotState, and a run missed while the
 * bot was down is caught up at startup. Returns a cancel function.
 */
export function scheduleDailyUtc(key: string, hourUtc: number, task: () => Promise<void>): () => void {
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;

    const runIfDue = async () => {
        const now = new Date();
        if (now.getUTCHours() < hourUtc) return; // Not yet due today
        const lastRun = await getBotState(key);
        if (lastRun === todayUtc()) return; // Already ran today
        // Mark as run BEFORE executing: a failed run skips a day instead of
        // risking a double execution (decay/reset must never apply twice).
        await setBotState(key, todayUtc());
        logger.info(`[dailyTask] Running "${key}"...`);
        await task();
    };

    const scheduleNext = () => {
        if (stopped) return;
        const now = new Date();
        let next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 30));
        if (next.getTime() <= now.getTime()) {
            next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
        }
        timer = setTimeout(async () => {
            await runIfDue().catch(err => logger.error(`[dailyTask] "${key}" failed:`, err));
            scheduleNext();
        }, next.getTime() - now.getTime());
    };

    // Catch up a missed run at startup, then schedule the recurring one.
    runIfDue().catch(err => logger.error(`[dailyTask] "${key}" startup run failed:`, err));
    scheduleNext();

    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}
