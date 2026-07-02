import { prisma } from '../utils/db';


export class EloManager {

    static async getElo(userId: string, game: string): Promise<number> {
        const userElo = await prisma.elo.findFirst({
            where: {
                userId,
                game,
                seasonId: null // Assuming current season is null (active) or handled elsewhere
            },
        });

        return userElo ? userElo.rating : 1000; // Default Elo 1000
    }

    static async updateElo(userId: string, game: string, newRating: number, win: boolean) {
        // Ensure user exists
        await prisma.user.upsert({
            where: { id: userId },
            update: {},
            create: { id: userId, username: 'Unknown' }, // Username will be updated elsewhere or ignored
        });

        const existingElo = await prisma.elo.findFirst({
            where: { userId, game, seasonId: null }
        });

        if (existingElo) {
            await prisma.elo.update({
                where: { id: existingElo.id },
                data: {
                    rating: newRating,
                    wins: { increment: win ? 1 : 0 },
                    losses: { increment: win ? 0 : 1 },
                }
            });
        } else {
            await prisma.elo.create({
                data: {
                    userId,
                    game,
                    rating: newRating,
                    wins: win ? 1 : 0,
                    losses: win ? 0 : 1,
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
}
