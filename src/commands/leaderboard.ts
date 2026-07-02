import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { createLeaderboardEmbed } from '../utils/embeds';

const prisma = new PrismaClient();

export const command = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the leaderboard')
        .addStringOption((option) =>
            option
                .setName('game')
                .setDescription('The game to view')
                .setRequired(true)
                .addChoices(
                    { name: 'Rocket League', value: 'rl' },
                    { name: 'Counter-Strike 2', value: 'cs2' },
                    { name: 'Rainbow Six Siege', value: 'r6s' },
                    { name: 'League of Legends', value: 'lol' },
                    { name: 'Valorant', value: 'valorant' },
                ),
        )
        .addStringOption((option) =>
            option
                .setName('sort')
                .setDescription('Sort by')
                .addChoices(
                    { name: 'Elo', value: 'rating' },
                    { name: 'Wins', value: 'wins' },
                ),
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const game = interaction.options.getString('game', true);
        const sort = interaction.options.getString('sort') || 'rating';

        const ITEMS_PER_PAGE = 10;
        let currentPage = 1;

        const fetchPlayers = async (page: number) => {
            return await prisma.elo.findMany({
                where: { game },
                orderBy: { [sort]: 'desc' },
                skip: (page - 1) * ITEMS_PER_PAGE,
                take: ITEMS_PER_PAGE,
                include: { user: true },
            });
        };

        const totalPlayers = await prisma.elo.count({ where: { game } });
        const totalPages = Math.ceil(totalPlayers / ITEMS_PER_PAGE) || 1;

        let players = await fetchPlayers(currentPage);
        let { embed, files } = createLeaderboardEmbed(game, players, currentPage, totalPages);

        const getRow = (page: number) => {
            return new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('prev')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === 1),
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(page === totalPages),
            );
        };

        const response = await interaction.reply({
            embeds: [embed],
            components: [getRow(currentPage)],
            files
        });

        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000,
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                await i.reply({ content: 'This is not your interaction.', ephemeral: true });
                return;
            }

            if (i.customId === 'prev') {
                currentPage--;
            } else if (i.customId === 'next') {
                currentPage++;
            }

            players = await fetchPlayers(currentPage);
            const result = createLeaderboardEmbed(game, players, currentPage, totalPages);
            embed = result.embed;
            files = result.files;

            await i.update({
                embeds: [embed],
                components: [getRow(currentPage)],
                files
            });
        });

        collector.on('end', () => {
            // Disable buttons after timeout
        });
    },
};
