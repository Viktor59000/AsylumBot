import { prisma } from './db';
import { logger } from './logger';

export const BADGE_DEFS = [
    { key: 'season_champion', name: 'Season Champion', emoji: '🏆', description: '1st of a season ladder' },
    { key: 'season_runnerup', name: 'Season Runner-up', emoji: '🥈', description: '2nd of a season ladder' },
    { key: 'season_top3', name: 'Season Top 3', emoji: '🥉', description: '3rd of a season ladder' },
    { key: 'streak_5', name: 'On Fire', emoji: '🔥', description: '5 wins in a row on one ladder' },
] as const;

export type BadgeKey = typeof BADGE_DEFS[number]['key'];

/** Seeds the badge catalog (idempotent) — called once at startup. */
export async function ensureBadges() {
    for (const def of BADGE_DEFS) {
        await prisma.badge.upsert({
            where: { key: def.key },
            update: { name: def.name, emoji: def.emoji, description: def.description },
            create: def,
        });
    }
}

/**
 * Awards a badge with an optional (season, game, mode) scope.
 * Returns true if newly awarded, false if the user already had it.
 */
export async function awardBadge(
    userId: string,
    key: BadgeKey,
    scope: { seasonId?: number | null; game?: string; mode?: string } = {}
): Promise<boolean> {
    try {
        const badge = await prisma.badge.findUnique({ where: { key } });
        if (!badge) return false;

        const existing = await prisma.userBadge.findFirst({
            where: {
                userId,
                badgeId: badge.id,
                seasonId: scope.seasonId ?? null,
                game: scope.game ?? null,
                mode: scope.mode ?? null,
            },
        });
        if (existing) return false;

        await prisma.userBadge.create({
            data: {
                userId,
                badgeId: badge.id,
                seasonId: scope.seasonId ?? null,
                game: scope.game ?? null,
                mode: scope.mode ?? null,
            },
        });
        return true;
    } catch (err) {
        logger.error(`[badges] Failed to award "${key}" to ${userId}:`, err);
        return false;
    }
}

export async function getUserBadges(userId: string) {
    return prisma.userBadge.findMany({
        where: { userId },
        include: { badge: true },
        orderBy: { awardedAt: 'desc' },
    });
}

/** Rank tier emoji for visual ladders. */
export const RANK_EMOJI: Record<string, string> = {
    Bronze: '🟫',
    Silver: '⬜',
    Gold: '🟨',
    Platinum: '🟦',
    Diamond: '💎',
};
