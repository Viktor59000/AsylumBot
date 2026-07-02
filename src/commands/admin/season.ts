import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const command = {
    data: new SlashCommandBuilder()
        .setName('season')
        .setDescription('Manage seasons')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('end')
                .setDescription('End the current season and archive stats')
                .addStringOption((option) =>
                    option.setName('name').setDescription('Name of the season to archive (e.g., "Season 1")').setRequired(true),
                ),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction: ChatInputCommandInteraction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'end') {
            const name = interaction.options.getString('name', true);

            await interaction.deferReply();

            try {
                // 1. Create the Season record
                const season = await prisma.season.create({
                    data: {
                        name,
                        startDate: new Date(), // Ideally this should be when it started, but for now...
                        endDate: new Date(),
                        isActive: false,
                    },
                });

                // 2. Archive Elo records
                // Update all Elo records where seasonId is null to have the new seasonId
                const updateResult = await prisma.elo.updateMany({
                    where: { seasonId: null },
                    data: { seasonId: season.id },
                });

                // 3. Archive Match records (Optional, but good for history)
                await prisma.match.updateMany({
                    where: { seasonId: null },
                    data: { seasonId: season.id },
                });

                await interaction.editReply({
                    content: `✅ **${name}** has ended!\nStats have been archived.\n- **${updateResult.count}** player Elo records moved to history.\n- All players have been reset to default Elo (will be created on next match).`,
                });

            } catch (error) {
                console.error(error);
                await interaction.editReply({ content: '❌ An error occurred while ending the season.' });
            }
        }
    },
};
