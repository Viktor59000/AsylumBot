import { EmbedBuilder, User, ColorResolvable, AttachmentBuilder, Guild } from 'discord.js';
import { COLORS, GAME_CONFIGS, BOT_ICON } from './constants';
import { QueuePlayer } from '../managers/QueueManager';
import { AssetManager } from './AssetManager';

const getAttachment = (game: string, assetName: string) => {
    const path = AssetManager.getAssetPath(game, assetName);
    if (path) {
        const name = path.split(/[\\/]/).pop()!;
        return { attachment: new AttachmentBuilder(path, { name }), name };
    }
    return null;
};

const getBannerAttachment = (game: string, mode: string, kind: string) => {
    const path = AssetManager.getBanner(game, mode, kind);
    if (path) {
        const name = path.split(/[\\/]/).pop()!;
        return { attachment: new AttachmentBuilder(path, { name }), name };
    }
    return null;
};

const getRankLabel = (rating: number) => {
    if (rating < 1200) return 'Bronze';
    if (rating < 1400) return 'Silver';
    if (rating < 1600) return 'Gold';
    if (rating < 1800) return 'Platinum';
    return 'Diamond';
};

const progressBar = (count: number, total: number) => {
    const filled = total > 0 ? Math.round((Math.min(count, total) / total) * 10) : 0;
    return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
};

/**
 * Rich live queue embed (DESIGN §6.2): each player with declared role,
 * Elo/rank, duo marker and voice presence 🔊, plus an X/N progress bar.
 * Async: reads Elo + role preferences from DB; `guild` enables the 🔊 flag.
 */
export const createQueueEmbed = async (game: string, mode: string, queue: QueuePlayer[], required: number, guild?: Guild | null) => {
    const { queueManager } = require('../managers/QueueManager');
    const { prisma } = require('./db');
    const config = queueManager.getConfig(game, mode);
    const gameConfig = GAME_CONFIGS[game as keyof typeof GAME_CONFIGS];
    const isFull = queue.length >= required;

    // Batch data: Elo (this ladder) + declared roles
    const userIds = queue.map(p => p.user.id);
    const [eloRows, ignRows] = userIds.length > 0 ? await Promise.all([
        prisma.elo.findMany({ where: { userId: { in: userIds }, game, mode, seasonId: null }, select: { userId: true, rating: true } }),
        prisma.userIgn.findMany({ where: { userId: { in: userIds }, game }, select: { userId: true, preferences: true } }),
    ]) : [[], []];

    const ratingMap = new Map<string, number>(eloRows.map((r: any) => [r.userId, r.rating]));
    const roleMap = new Map<string, string>();
    for (const row of ignRows) {
        try {
            const prefs = row.preferences ? JSON.parse(row.preferences) : {};
            const roles: string[] = prefs.roles ?? [];
            if (roles.length > 0) roleMap.set(row.userId, roles[0]);
        } catch { /* invalid prefs JSON — ignore */ }
    }

    const embed = new EmbedBuilder()
        .setTitle(`${config?.name ?? game}`)
        .setColor(isFull ? COLORS.SUCCESS as ColorResolvable : COLORS.ASYLUM_GOLD as ColorResolvable)
        .setThumbnail(gameConfig?.thumbnail ?? BOT_ICON)
        .setAuthor({ name: 'ASYLUM ELO HUB', iconURL: BOT_ICON })
        .setDescription(`${progressBar(queue.length, required)} **${queue.length}/${required}**${isFull ? ' — 🔔 Queue full!' : ''}`)
        .addFields(
            { name: 'MMR', value: '**ON** 🟢', inline: true },
            { name: 'Mode', value: `🎮 **${mode}**`, inline: true },
        )
        .setFooter({ text: 'ID: Global • 🌍 Global Leaderboard' });

    const files: AttachmentBuilder[] = [];
    const banner = getBannerAttachment(game, mode, 'queue_banner');
    if (banner) {
        embed.setImage(`attachment://${banner.name}`);
        files.push(banner.attachment);
    } else {
        embed.setImage('https://i.imgur.com/AfFp7pu.png'); // Placeholder until assets are added
    }

    // Player list with role • Elo (rank) • duo marker • voice presence
    const groupMap = new Map<string, number>();
    let groupCounter = 1;

    const formatPlayer = (p: QueuePlayer, i: number) => {
        let duoMark = '';
        if (p.groupId) {
            if (!groupMap.has(p.groupId)) {
                groupMap.set(p.groupId, groupCounter++);
            }
            const num = groupMap.get(p.groupId)!;
            duoMark = ` 👥${num === 1 ? '¹' : num === 2 ? '²' : num === 3 ? '³' : `⁽${num}⁾`}`;
        }
        const rating = ratingMap.get(p.user.id) ?? 1000;
        const role = roleMap.get(p.user.id);
        const inVoice = guild?.voiceStates.cache.get(p.user.id)?.channelId ? ' 🔊' : '';
        return `\`${i + 1}.\` <@${p.user.id}>${duoMark} — ${role ? `${role} • ` : ''}⭐${rating} (${getRankLabel(rating)})${inVoice}`;
    };

    const lines = queue.map((p, i) => formatPlayer(p, i));
    if (lines.length === 0) {
        embed.addFields({ name: 'Players', value: '*No members yet*', inline: false });
    } else {
        // Split into ≤10-line fields to stay under Discord's 1024-char field limit
        for (let i = 0; i < lines.length; i += 10) {
            embed.addFields({
                name: i === 0 ? 'Players' : '​',
                value: lines.slice(i, i + 10).join('\n'),
                inline: false,
            });
        }
    }

    return { embed, files };
};

export const createMatchEmbed = (matchId: number, game: string, team1: User[], team2: User[]) => {
    const config = GAME_CONFIGS[game as keyof typeof GAME_CONFIGS];
    const embed = new EmbedBuilder()
        .setTitle(`MATCH IN PROGRESS #${matchId}`)
        .setColor(COLORS.ASYLUM_DARK as ColorResolvable)
        .setDescription(`**Game:** ${config.name}\n**Match ID:** ${matchId}`)
        .addFields(
            { name: 'Team 1', value: team1.map(u => `<@${u.id}>`).join('\n'), inline: true },
            { name: 'Team 2', value: team2.map(u => `<@${u.id}>`).join('\n'), inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'ASYLUM-BOT', iconURL: BOT_ICON });

    const files: AttachmentBuilder[] = [];
    const banner = getAttachment(game, 'live_banner');
    if (banner) {
        embed.setImage(`attachment://${banner.name}`);
        files.push(banner.attachment);
    }

    return { embed, files };
};

export const createLeaderboardEmbed = (
    game: string,
    mode: string,
    players: { user: { username: string }; rating: number; wins: number; losses: number; winStreak?: number }[],
    page: number,
    totalPages: number
) => {
    const config = GAME_CONFIGS[game as keyof typeof GAME_CONFIGS];
    const embed = new EmbedBuilder()
        .setTitle(`🏆 Leaderboard: ${config.name} — ${mode}`)
        .setColor(COLORS.ASYLUM_GOLD as ColorResolvable)
        .setThumbnail(config.thumbnail)
        .setFooter({ text: `Page ${page}/${totalPages} • ASYLUM-BOT`, iconURL: BOT_ICON })
        .setTimestamp();

    const files: AttachmentBuilder[] = [];
    const banner = getBannerAttachment(game, mode, 'rank_banner');
    if (banner) {
        embed.setImage(`attachment://${banner.name}`);
        files.push(banner.attachment);
    }

    if (players.length > 0) {
        const description = players
            .map((p, i) => {
                const rank = (page - 1) * 10 + i + 1;
                const winRate = p.wins + p.losses > 0 ? Math.round((p.wins / (p.wins + p.losses)) * 100) : 0;
                const streak = p.winStreak ? `🔥 ${p.winStreak}` : '';
                return `\`#${rank}\` **${p.user.username}** • ⭐ **${p.rating}** • ${winRate}% WR ${streak}`;
            })
            .join('\n');
        embed.setDescription(description);
    } else {
        embed.setDescription('*No ranked players yet.*');
    }

    return { embed, files };
};
