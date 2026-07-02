import { Client, ChannelType, Guild } from 'discord.js';
import { prisma } from '../utils/db';
import { lobbyManager } from './LobbyManager';
import { logger } from '../utils/logger';

/**
 * Startup crash-safety (P1-2). Live state (queues, ready-checks, votes,
 * drafts, lobbies) is in-memory only, so after a restart every unreported
 * match is unrecoverable by design (v1 decision: clean up, don't resume).
 *
 * At boot: abandon stale matches + delete their channels, reset stuck user
 * statuses, and sweep any leftover ephemeral channels in "ASYLUM MATCHES".
 */
export async function runStartupRecovery(client: Client) {
    // 1. Abandon every unreported match and clean up its channels
    const staleMatches = await prisma.match.findMany({
        where: { winner: null, status: { in: ['pending', 'live'] } },
    });

    for (const match of staleMatches) {
        const guild = (match.guildId && client.guilds.cache.get(match.guildId)) || client.guilds.cache.first();
        if (guild) {
            await lobbyManager.cleanupMatch(match.id, guild)
                .catch(err => logger.error(`[recovery] cleanupMatch #${match.id} failed:`, err));
        }
        await prisma.match.update({ where: { id: match.id }, data: { status: 'abandoned' } })
            .catch(err => logger.error(`[recovery] Failed to mark match #${match.id} abandoned:`, err));
    }
    if (staleMatches.length > 0) {
        logger.info(`[recovery] Abandoned ${staleMatches.length} stale match(es).`);
    }

    // 2. Reset stuck user statuses (in-memory queues are empty after a restart)
    const reset = await prisma.user.updateMany({
        where: { status: { not: 'IDLE' } },
        data: { status: 'IDLE' },
    });
    if (reset.count > 0) {
        logger.info(`[recovery] Reset ${reset.count} user(s) to IDLE.`);
    }

    // 3. Sweep leftover ephemeral match channels (the category only ever holds them)
    for (const guild of client.guilds.cache.values()) {
        await sweepOrphanMatchChannels(guild);
    }
}

async function sweepOrphanMatchChannels(guild: Guild) {
    const category = guild.channels.cache.find(
        c => c.name === 'ASYLUM MATCHES' && c.type === ChannelType.GuildCategory
    );
    if (!category) return;

    const orphans = guild.channels.cache.filter(c => c.parentId === category.id);
    for (const channel of orphans.values()) {
        await channel.delete('AsylumBot startup recovery: orphan match channel')
            .catch(err => logger.error(`[recovery] Failed to delete orphan channel ${channel.id}:`, (err as Error)?.message));
    }
    if (orphans.size > 0) {
        logger.info(`[recovery] Deleted ${orphans.size} orphan match channel(s) in guild ${guild.id}.`);
    }
}
