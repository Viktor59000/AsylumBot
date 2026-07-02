import { prisma } from '../utils/db';
import axios from 'axios';

export class WebhookManager {
    async sendMatchData(matchId: number) {
        // Fetch Match Data
        const match = await prisma.match.findUnique({
            where: { id: matchId },
            include: {
                players: {
                    include: {
                        user: true
                    }
                },
                season: true
            }
        });

        if (!match) return;

        // Fetch Config for Game
        const config = await prisma.gameConfig.findFirst({
            where: { game: match.game }
        });

        if (!config || !config.webhookUrl) return;

        // Construct Payload
        const payload = {
            matchId: match.id,
            game: match.game,
            winner: match.winner,
            map: match.map,
            isRanked: match.isRanked,
            season: match.season?.name || 'None',
            createdAt: match.createdAt,
            players: match.players.map(p => ({
                userId: p.userId,
                username: p.user.username,
                team: p.team,
                role: p.role,
                kda: p.kda
            }))
        };

        // Send Payload
        try {
            await axios.post(config.webhookUrl, payload);
            console.log(`[Webhook] Sent match data for Match #${matchId} to ${config.webhookUrl}`);
        } catch (error) {
            console.error(`[Webhook] Failed to send match data for Match #${matchId}:`, error);
        }
    }
}
