import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { prisma } from '../utils/db';
import { COLORS, GAME_CONFIGS } from '../utils/constants';
import { logger } from '../utils/logger';

/**
 * Rush hours (DESIGN §5.1): time windows with an Elo/coins multiplier.
 * A 1-minute ticker sends start/end announcements exactly once (flags
 * persisted in DB → idempotent across restarts).
 */
export class EventManager {
    private client: Client;
    private timer?: NodeJS.Timeout;

    constructor(client: Client) {
        this.client = client;
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => {
            this.tick().catch(err => logger.error('[events] tick failed:', err));
        }, 60 * 1000);
        void this.tick().catch(err => logger.error('[events] initial tick failed:', err));
    }

    destroy() {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
    }

    /** Highest active rush-hour multiplier for (guild, game) — 1 when none. */
    async getActiveMultiplier(guildId: string, game: string): Promise<number> {
        const now = new Date();
        const events = await prisma.event.findMany({
            where: {
                guildId,
                type: 'rush_hour',
                startAt: { lte: now },
                endAt: { gt: now },
                OR: [{ game: null }, { game }],
            },
        });
        return events.reduce((max, e) => Math.max(max, e.multiplier), 1);
    }

    private async tick() {
        const now = new Date();

        const starting = await prisma.event.findMany({
            where: { type: 'rush_hour', announced: false, startAt: { lte: now }, endAt: { gt: now } },
        });
        for (const event of starting) {
            await this.announce(event, 'start');
            await prisma.event.update({ where: { id: event.id }, data: { announced: true } });
        }

        const ending = await prisma.event.findMany({
            where: { type: 'rush_hour', endAnnounced: false, endAt: { lte: now } },
        });
        for (const event of ending) {
            // Only announce the end of events whose start was announced (skip cancelled-before-start)
            if (event.announced) await this.announce(event, 'end');
            await prisma.event.update({ where: { id: event.id }, data: { endAnnounced: true } });
        }
    }

    /** Posts in the queue channel(s) of the scoped game (all games if unscoped). */
    private async announce(event: { id: number; guildId: string; game: string | null; multiplier: number; endAt: Date }, phase: 'start' | 'end') {
        const guild = this.client.guilds.cache.get(event.guildId);
        if (!guild) return;

        const configs = await prisma.gameConfig.findMany({
            where: {
                guildId: event.guildId,
                queueChannelId: { not: null },
                ...(event.game ? { game: event.game } : {}),
            },
        });

        const scope = event.game
            ? (GAME_CONFIGS[event.game as keyof typeof GAME_CONFIGS]?.name ?? event.game)
            : 'ALL GAMES';

        const embed = phase === 'start'
            ? new EmbedBuilder()
                .setTitle('🔥 RUSH HOUR STARTED!')
                .setDescription(
                    `**×${event.multiplier}** Elo gains & coins on **${scope}**!\n` +
                    `Ends <t:${Math.floor(event.endAt.getTime() / 1000)}:R> — queue up now!`)
                .setColor(COLORS.DANGER as any)
                .setTimestamp()
            : new EmbedBuilder()
                .setTitle('🧯 Rush hour ended')
                .setDescription(`The **×${event.multiplier}** window on **${scope}** is over. GGs!`)
                .setColor(COLORS.ASYLUM_DARK as any)
                .setTimestamp();

        const seen = new Set<string>();
        for (const config of configs) {
            if (!config.queueChannelId || seen.has(config.queueChannelId)) continue;
            seen.add(config.queueChannelId);
            const channel = guild.channels.cache.get(config.queueChannelId) as TextChannel | undefined;
            if (channel?.isTextBased()) {
                await channel.send({ embeds: [embed] }).catch(() => { });
            }
        }
    }
}
