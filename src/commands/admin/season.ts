import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { prisma } from '../../utils/db';
import { COLORS } from '../../utils/constants';
import { getActiveSeason, invalidateSeasonCache } from '../../utils/season';
import { ensureBadges, awardBadge } from '../../utils/badges';

// Season-end rewards for each (game, mode) ladder (min. 3 games played)
const PODIUM_COINS = [200, 100, 50];
const PODIUM_BADGES = ['season_champion', 'season_runnerup', 'season_top3'] as const;
const MIN_GAMES_FOR_REWARD = 3;

export const command = {
    data: new SlashCommandBuilder()
        .setName('season')
        .setDescription('Manage seasons')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((subcommand) =>
            subcommand
                .setName('start')
                .setDescription('Start a new active season')
                .addStringOption((option) =>
                    option.setName('name').setDescription('Season name (e.g. "Season 2")').setRequired(true),
                )
                .addBooleanOption((option) =>
                    option.setName('soft_reset').setDescription('Seed ratings from the previous season, pulled toward 1000 (default: fresh 1000)'),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('end')
                .setDescription('End the active season: archive + distribute rewards (badges/coins)'),
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply();

        if (subcommand === 'start') {
            const name = interaction.options.getString('name', true);
            const softReset = interaction.options.getBoolean('soft_reset') ?? false;

            const existing = await getActiveSeason();
            if (existing) {
                await interaction.editReply({ content: `❌ Season **${existing.name}** is still active — end it first with \`/season end\`.` });
                return;
            }

            const season = await prisma.season.create({
                data: { name, startDate: new Date(), isActive: true },
            });
            invalidateSeasonCache();

            let seeded = 0;
            if (softReset) {
                // Seed from the most recently ended season (or the legacy no-season rows)
                const previous = await prisma.season.findFirst({
                    where: { isActive: false, id: { not: season.id } },
                    orderBy: { id: 'desc' },
                });
                const sourceRows = await prisma.elo.findMany({
                    where: { seasonId: previous?.id ?? null },
                });

                if (sourceRows.length > 0) {
                    // Soft reset: halfway back to 1000 (DESIGN §5.2)
                    await prisma.elo.createMany({
                        data: sourceRows.map(row => {
                            const seededRating = Math.round(1000 + (row.rating - 1000) / 2);
                            return {
                                userId: row.userId,
                                game: row.game,
                                mode: row.mode,
                                rating: seededRating,
                                highestRating: seededRating,
                                wins: 0,
                                losses: 0,
                                winStreak: 0,
                                seasonId: season.id,
                            };
                        }),
                        skipDuplicates: true,
                    });
                    seeded = sourceRows.length;
                }
            }

            await interaction.editReply({
                content: `✅ **${name}** started! All new matches and Elo are now linked to this season.` +
                    (softReset
                        ? `\n♻️ Soft reset: **${seeded}** rating(s) seeded halfway back to 1000.`
                        : `\n🆕 Fresh start: everyone begins at 1000 on first match.`),
            });
        } else if (subcommand === 'end') {
            const season = await getActiveSeason();
            if (!season) {
                await interaction.editReply({ content: '❌ No active season. Start one with `/season start`.' });
                return;
            }

            await ensureBadges();

            // Rewards: podium per (game, mode) ladder among players with enough games
            const rows = await prisma.elo.findMany({
                where: { seasonId: season.id },
                include: { user: true },
                orderBy: { rating: 'desc' },
            });

            const ladders = new Map<string, typeof rows>();
            for (const row of rows) {
                if (row.wins + row.losses < MIN_GAMES_FOR_REWARD) continue;
                const key = `${row.game}:${row.mode}`;
                if (!ladders.has(key)) ladders.set(key, []);
                ladders.get(key)!.push(row);
            }

            const rewardLines: string[] = [];
            for (const [key, ladder] of ladders) {
                const [game, mode] = key.split(':');
                const podium = ladder.slice(0, 3);
                const medals = ['🥇', '🥈', '🥉'];
                const parts: string[] = [];
                for (let i = 0; i < podium.length; i++) {
                    const row = podium[i];
                    await awardBadge(row.userId, PODIUM_BADGES[i], { seasonId: season.id, game, mode });
                    await prisma.user.update({
                        where: { id: row.userId },
                        data: { coins: { increment: PODIUM_COINS[i] } },
                    });
                    parts.push(`${medals[i]} <@${row.userId}> (${row.rating}, +${PODIUM_COINS[i]} 🪙)`);
                }
                if (parts.length > 0) {
                    rewardLines.push(`**${game} ${mode}** — ${parts.join(' • ')}`);
                }
            }

            await prisma.season.update({
                where: { id: season.id },
                data: { isActive: false, endDate: new Date() },
            });
            invalidateSeasonCache();

            const embed = new EmbedBuilder()
                .setTitle(`🏁 ${season.name} has ended!`)
                .setColor(COLORS.ASYLUM_GOLD as any)
                .setDescription(
                    (rewardLines.length > 0
                        ? `**Podium rewards** (min. ${MIN_GAMES_FOR_REWARD} games):\n${rewardLines.join('\n')}`
                        : '*No ladder had enough active players for rewards.*') +
                    `\n\nStats are archived — visible in \`/stats\` season history.` +
                    `\nStart the next one with \`/season start\` (option \`soft_reset\`).`)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },
};
