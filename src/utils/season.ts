import { prisma } from './db';

// Cached active season id. `undefined` = not loaded yet, `null` = no active
// season (pre-season rows live with seasonId null — the historical behavior).
let cachedActiveSeasonId: number | null | undefined = undefined;

/** Id of the active season, used as the `seasonId` of every "current" Elo/Match row. */
export async function getActiveSeasonId(): Promise<number | null> {
    if (cachedActiveSeasonId !== undefined) return cachedActiveSeasonId;
    const season = await prisma.season.findFirst({
        where: { isActive: true },
        orderBy: { id: 'desc' },
    });
    cachedActiveSeasonId = season?.id ?? null;
    return cachedActiveSeasonId;
}

export async function getActiveSeason() {
    const id = await getActiveSeasonId();
    return id === null ? null : prisma.season.findUnique({ where: { id } });
}

/** Call after /season start | end. */
export function invalidateSeasonCache() {
    cachedActiveSeasonId = undefined;
}
