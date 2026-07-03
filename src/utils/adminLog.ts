import { EmbedBuilder, Guild, TextChannel } from 'discord.js';
import { prisma } from './db';
import { COLORS } from './constants';
import { logger } from './logger';

/**
 * Writes an embed to the game's admin log channel (adminLogChannelId).
 * Silent no-op if the channel is not configured — never blocks the main flow.
 */
export async function logAdmin(guild: Guild, game: string, title: string, description: string) {
    try {
        const config = await prisma.gameConfig.findFirst({
            where: { guildId: guild.id, game, adminLogChannelId: { not: null } },
        });
        if (!config?.adminLogChannelId) return;

        const channel = guild.channels.cache.get(config.adminLogChannelId) as TextChannel | undefined;
        if (!channel || !channel.isTextBased()) return;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(COLORS.ASYLUM_DARK as any)
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    } catch (err) {
        logger.error(`[adminLog] Failed for ${game}:`, err);
    }
}
