import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, User, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction } from 'discord.js';
import { prisma } from '../../utils/db';
import { COLORS, GAME_CONFIGS } from '../../utils/constants';

// Helper to calculate rank
function getRank(rating: number) {
    if (rating < 1200) return 'Bronze';
    if (rating < 1400) return 'Silver';
    if (rating < 1600) return 'Gold';
    if (rating < 1800) return 'Platinum';
    return 'Diamond';
}

async function generateGeneralStats(targetUser: User) {
    const { getActiveSeasonId } = await import('../../utils/season');
    const { getUserBadges } = await import('../../utils/badges');
    const seasonId = await getActiveSeasonId();
    const userWithClan = await prisma.user.findUnique({
        where: { id: targetUser.id },
        include: { clan: true, elo: { where: { seasonId } } }
    });

    const totalElo = userWithClan?.elo.reduce((sum, e) => sum + e.rating, 0) || 0;
    const totalGames = userWithClan?.elo.reduce((sum, e) => sum + (e.wins + e.losses), 0) || 0;

    const embed = new EmbedBuilder()
        .setTitle('📊 Player Statistics')
        .setAuthor({ name: targetUser.username, iconURL: targetUser.displayAvatarURL() })
        .setColor(COLORS.ASYLUM_GOLD as any)
        .setThumbnail(targetUser.displayAvatarURL())
        .setDescription(`**Clan:** 🛡️ ${userWithClan?.clan?.name || 'No Clan'}`)
        .addFields(
            { name: 'Total Elo', value: `⭐ ${totalElo}`, inline: true },
            { name: 'Total Games Played', value: `🎮 ${totalGames}`, inline: true }
        )
        .setFooter({
            text: userWithClan?.clan ? `Member of ${userWithClan.clan.name}` : 'ASYLUM ELO HUB',
            iconURL: userWithClan?.clan?.imageUrl || 'https://i.imgur.com/AfFp7pu.png'
        });

    // Add summary for each game (one line per mode ladder)
    const gameFields = Object.entries(GAME_CONFIGS).map(([key, config]) => {
        const elos = userWithClan?.elo.filter(e => e.game === key) ?? [];
        if (elos.length === 0) {
            return { name: config.name, value: `${config.emoji} 1000 Elo (${getRank(1000)})`, inline: false };
        }
        const value = elos
            .map(e => `${config.emoji} **${e.mode}** — ${e.rating} Elo (${getRank(e.rating)})`)
            .join('\n');
        return { name: config.name, value, inline: false };
    });

    embed.addFields(gameFields);

    // Badges (season rewards, streaks, ...)
    const badges = await getUserBadges(targetUser.id);
    if (badges.length > 0) {
        const counts = new Map<string, { emoji: string; name: string; count: number }>();
        for (const ub of badges) {
            const entry = counts.get(ub.badge.key) ?? { emoji: ub.badge.emoji, name: ub.badge.name, count: 0 };
            entry.count++;
            counts.set(ub.badge.key, entry);
        }
        const line = Array.from(counts.values())
            .map(b => `${b.emoji} ${b.name}${b.count > 1 ? ` ×${b.count}` : ''}`)
            .join(' • ');
        embed.addFields({ name: '🎖️ Badges', value: line, inline: false });
    }

    return embed;
}

async function generateGameStats(targetUser: User, game: string) {
    const config = GAME_CONFIGS[game as keyof typeof GAME_CONFIGS];

    const userWithClan = await prisma.user.findUnique({
        where: { id: targetUser.id },
        include: { clan: true }
    });

    const eloRecords = await prisma.elo.findMany({
        where: { userId: targetUser.id, game },
        include: { season: true },
        orderBy: { seasonId: 'desc' },
    });

    const { getActiveSeasonId } = await import('../../utils/season');
    const activeSeasonId = await getActiveSeasonId();
    const activeElos = eloRecords.filter(e => e.seasonId === activeSeasonId);
    const historyElos = eloRecords.filter(e => e.seasonId !== activeSeasonId && e.seasonId !== null);

    const ignRecord = await prisma.userIgn.findUnique({
        where: { userId_game: { userId: targetUser.id, game } },
    });

    const ign = ignRecord?.ign || 'Not set';

    const embed = new EmbedBuilder()
        .setTitle(`${config.name} Stats`)
        .setAuthor({ name: targetUser.username, iconURL: targetUser.displayAvatarURL() })
        .setColor(COLORS.ASYLUM_GOLD as any)
        .setThumbnail(targetUser.displayAvatarURL())
        .setDescription(`**IGN:** \`${ign}\`\n**Clan:** 🛡️ ${userWithClan?.clan?.name || 'No Clan'}`)
        .setFooter({
            text: userWithClan?.clan ? `Member of ${userWithClan.clan.name}` : 'ASYLUM ELO HUB',
            iconURL: userWithClan?.clan?.imageUrl || 'https://i.imgur.com/AfFp7pu.png'
        });

    // One block per mode ladder (each mode has its own Elo)
    if (activeElos.length === 0) {
        embed.addFields({ name: 'Unranked', value: `🏆 ${getRank(1000)} • ⭐ 1000 Elo • no matches yet`, inline: false });
    } else {
        for (const elo of activeElos) {
            const winRate = elo.wins + elo.losses > 0 ? Math.round((elo.wins / (elo.wins + elo.losses)) * 100) : 0;
            embed.addFields({
                name: `Mode: ${elo.mode}`,
                value: `🏆 ${getRank(elo.rating)} • ⭐ ${elo.rating} Elo\n📊 ${winRate}% (${elo.wins}W - ${elo.losses}L) • 🔥 Streak: ${elo.winStreak}`,
                inline: false
            });
        }
    }

    if (historyElos.length > 0) {
        const historyString = historyElos.map(e => {
            const seasonName = e.season?.name || 'Unknown Season';
            return `**${seasonName}** (${e.mode}): ${e.rating} Elo (${e.wins}W-${e.losses}L)`;
        }).join('\n');
        embed.addFields({ name: '📜 Season History', value: historyString });
    }

    return embed;
}

function getGameButtons(userId: string) {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let row = new ActionRowBuilder<ButtonBuilder>();

    // Add "General" button
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`stats_view_general_${userId}`)
            .setLabel('General')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📊')
    );

    Object.entries(GAME_CONFIGS).forEach(([key, config], index) => {
        if ((index + 1) % 5 === 0) { // +1 because of General button
            rows.push(row);
            row = new ActionRowBuilder<ButtonBuilder>();
        }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`stats_view_${key}_${userId}`)
                .setLabel(config.name)
                .setStyle(ButtonStyle.Primary)
                .setEmoji(config.emoji)
        );
    });
    rows.push(row);
    return rows;
}

export const command = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View player statistics')
        .addUserOption((option) =>
            option.setName('member').setDescription('The member to view (default: you)'),
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const targetUser = interaction.options.getUser('member') || interaction.user;
        const embed = await generateGeneralStats(targetUser);
        const components = getGameButtons(targetUser.id);

        await interaction.reply({ embeds: [embed], components });
    },
};

export async function handleStatsInteraction(interaction: ButtonInteraction) {
    const parts = interaction.customId.split('_');
    // Format: stats_view_<game|general>_<userId>
    const game = parts[2];
    const userId = parts[3];

    // Fetch user object (might need to fetch from guild if not in cache, or just use ID for DB)
    // We need the User object for the embed author/avatar.
    // Try fetching from client
    let targetUser = interaction.client.users.cache.get(userId);
    if (!targetUser) {
        try {
            targetUser = await interaction.client.users.fetch(userId);
        } catch {
            return await interaction.reply({ content: '❌ User not found.', ephemeral: true });
        }
    }

    let embed;
    if (game === 'general') {
        embed = await generateGeneralStats(targetUser);
    } else {
        if (!GAME_CONFIGS[game as keyof typeof GAME_CONFIGS]) {
            return await interaction.reply({ content: '❌ Invalid game.', ephemeral: true });
        }
        embed = await generateGameStats(targetUser, game);
    }

    await interaction.update({ embeds: [embed] });
}
