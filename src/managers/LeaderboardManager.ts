import { Client, TextChannel } from 'discord.js';
import { prisma } from '../utils/db';
import { createLeaderboardEmbed } from '../utils/embeds';

export class LeaderboardManager {
    private client: Client;

    constructor(client: Client) {
        this.client = client;
    }

    async updateLeaderboard(game: string) {
        // 1. Get Config to find channel
        // We need the guildId. Usually we might have multiple guilds, but here we assume one or iterate.
        // For now, let's iterate over all configs for this game (likely just one).
        const configs = await prisma.gameConfig.findMany({
            where: { game }
        });

        for (const config of configs) {
            if (!config.leaderboardChannelId) continue;

            const guild = this.client.guilds.cache.get(config.guildId);
            if (!guild) continue;

            const channel = guild.channels.cache.get(config.leaderboardChannelId) as TextChannel;
            if (!channel) continue;

            // 2. Fetch Top Players
            const players = await prisma.elo.findMany({
                where: { game },
                orderBy: { rating: 'desc' },
                take: 20,
                include: { user: true }
            });

            // 3. Create Embed
            const { embed, files } = createLeaderboardEmbed(game, players, 1, 1);

            // 4. Update or Send Message
            const messages = await channel.messages.fetch({ limit: 5 });
            const lastBotMsg = messages.find(m => m.author.id === this.client.user?.id);

            if (lastBotMsg) {
                await lastBotMsg.edit({ embeds: [embed], files, components: [] });
            } else {
                await channel.send({ embeds: [embed], files });
            }
        }
    }
}
