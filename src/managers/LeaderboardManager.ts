import { Client, TextChannel } from 'discord.js';
import { prisma } from '../utils/db';
import { createLeaderboardEmbed } from '../utils/embeds';
import { logger } from '../utils/logger';

export class LeaderboardManager {
    private client: Client;

    constructor(client: Client) {
        this.client = client;
    }

    /** Updates the permanent leaderboard message for one (game, mode) ladder. */
    async updateLeaderboard(game: string, mode: string) {
        const configs = await prisma.gameConfig.findMany({
            where: { game, mode }
        });

        for (const config of configs) {
            if (!config.leaderboardChannelId) continue;

            const guild = this.client.guilds.cache.get(config.guildId);
            if (!guild) continue;

            const channel = guild.channels.cache.get(config.leaderboardChannelId) as TextChannel;
            if (!channel) continue;

            // Fetch Top Players of this ladder (active season only)
            const { getActiveSeasonId } = await import('../utils/season');
            const players = await prisma.elo.findMany({
                where: { game, mode, seasonId: await getActiveSeasonId() },
                orderBy: { rating: 'desc' },
                take: 20,
                include: { user: true }
            });

            const { embed, files } = createLeaderboardEmbed(game, mode, players, 1, 1);

            // Edit the stored permanent message; (re)create it if missing
            let message = config.leaderboardMessageId
                ? await channel.messages.fetch(config.leaderboardMessageId).catch(() => null)
                : null;

            if (message) {
                await message.edit({ embeds: [embed], files });
            } else {
                message = await channel.send({ embeds: [embed], files });
                await prisma.gameConfig.update({
                    where: { id: config.id },
                    data: { leaderboardMessageId: message.id }
                }).catch(err => logger.error(`[leaderboard] Failed to persist message id for ${game} ${mode}:`, err));
            }
        }
    }

    /** Updates every configured mode ladder of a game. */
    async updateGameLeaderboards(game: string) {
        const configs = await prisma.gameConfig.findMany({ where: { game } });
        const modes = Array.from(new Set(configs.map(c => c.mode)));
        for (const mode of modes) {
            await this.updateLeaderboard(game, mode);
        }
    }
}
