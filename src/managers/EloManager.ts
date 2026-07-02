import { prisma } from '../utils/db';


export class EloManager {

    // Elo is keyed by (userId, game, mode, season): each queue mode has its own ladder.

    static async getElo(userId: string, game: string, mode: string): Promise<number> {
        const userElo = await prisma.elo.findFirst({
            where: {
                userId,
                game,
                mode,
                seasonId: null // Assuming current season is null (active) or handled elsewhere
            },
        });

        return userElo ? userElo.rating : 1000; // Default Elo 1000
    }

    static async updateElo(userId: string, game: string, mode: string, newRating: number, win: boolean) {
        // Ensure user exists
        await prisma.user.upsert({
            where: { id: userId },
            update: {},
            create: { id: userId, username: 'Unknown' }, // Username will be updated elsewhere or ignored
        });

        const existingElo = await prisma.elo.findFirst({
            where: { userId, game, mode, seasonId: null }
        });

        if (existingElo) {
            await prisma.elo.update({
                where: { id: existingElo.id },
                data: {
                    rating: newRating,
                    wins: { increment: win ? 1 : 0 },
                    losses: { increment: win ? 0 : 1 },
                    winStreak: win ? { increment: 1 } : 0,
                    highestRating: Math.max(existingElo.highestRating, newRating),
                }
            });
        } else {
            await prisma.elo.create({
                data: {
                    userId,
                    game,
                    mode,
                    rating: newRating,
                    wins: win ? 1 : 0,
                    losses: win ? 0 : 1,
                    winStreak: win ? 1 : 0,
                    highestRating: Math.max(1000, newRating),
                    seasonId: null
                }
            });
        }
    }

    static calculateNewRating(currentRating: number, opponentRating: number, result: number): number {
        const K = 32; // K-factor
        const expectedScore = 1 / (1 + Math.pow(10, (opponentRating - currentRating) / 400));
        return Math.round(currentRating + K * (result - expectedScore));
    }

    /**
     * Placement Elo (DESIGN §1bis) for matches ranked 1→N.
     * score = (N − placement)/(N − 1) ∈ [0,1] (1st → 1, last → 0),
     * expected = logistic vs the field's average rating, Δ = K × (score − expected).
     * Works for any N ≥ 2 (partial rankings use N = number of placed teams).
     */
    static calculatePlacementDelta(rating: number, fieldAvgRating: number, placement: number, totalTeams: number): number {
        if (totalTeams < 2) return 0;
        const K = 32;
        const score = (totalTeams - placement) / (totalTeams - 1);
        const expected = 1 / (1 + Math.pow(10, (fieldAvgRating - rating) / 400));
        return Math.round(K * (score - expected));
    }
}
