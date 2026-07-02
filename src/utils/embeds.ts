import { EmbedBuilder, User, ColorResolvable, AttachmentBuilder } from 'discord.js';
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

export const createQueueEmbed = (game: string, mode: string, queue: QueuePlayer[], required: number) => {
    const { queueManager } = require('../managers/QueueManager');
    const config = queueManager.getConfig(game, mode);
    const gameConfig = GAME_CONFIGS[game as keyof typeof GAME_CONFIGS];
    const isFull = queue.length >= required;

    const embed = new EmbedBuilder()
        .setTitle(`${config?.name ?? game}`)
        .setColor(isFull ? COLORS.SUCCESS as ColorResolvable : COLORS.ASYLUM_GOLD as ColorResolvable)
        .setThumbnail(gameConfig?.thumbnail ?? BOT_ICON)
        .setAuthor({ name: 'ASYLUM ELO HUB', iconURL: BOT_ICON })
        .addFields(
            { name: 'MMR', value: '**ON** 🟢', inline: true },
            { name: 'Mode', value: `🎮 **${mode}**`, inline: true },
        )
        .setFooter({ text: 'ID: Global • 🌍 Global Leaderboard' });

    const files: AttachmentBuilder[] = [];
    const banner = getAttachment(game, 'queue_banner');
    if (banner) {
        embed.setImage(`attachment://${banner.name}`);
        files.push(banner.attachment);
    } else {
        embed.setImage('https://i.imgur.com/AfFp7pu.png');
    }

    // Two columns layout simulation
    const groupMap = new Map<string, number>();
    let groupCounter = 1;

    const formatPlayer = (p: QueuePlayer, i: number) => {
        let superscript = '';
        if (p.groupId) {
            if (!groupMap.has(p.groupId)) {
                groupMap.set(p.groupId, groupCounter++);
            }
            const num = groupMap.get(p.groupId);
            superscript = num === 1 ? '¹' : num === 2 ? '²' : num === 3 ? '³' : '⁰';
        }
        return `\`${i + 1}.\` <@${p.user.id}>${superscript}`;
    };

    const mid = Math.ceil(required / 2);
    const col1 = queue.slice(0, mid).map((p, i) => formatPlayer(p, i)).join('\n') || '*No members yet*';
    const col2 = queue.slice(mid, required).map((p, i) => formatPlayer(p, mid + i)).join('\n') || '*No members yet*';

    embed.addFields(
        { name: 'Slot 1', value: col1, inline: true },
        { name: 'Slot 2', value: col2, inline: true },
    );

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
    const banner = getAttachment(game, 'rank_banner');
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
