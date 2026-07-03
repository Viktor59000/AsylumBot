import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../../utils/db';


export const command = {
    data: new SlashCommandBuilder()
        .setName('cancel')
        .setDescription('Cancel a match and delete voice channels')
        .addIntegerOption((option) =>
            option.setName('match_id').setDescription('The ID of the match to cancel').setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction: ChatInputCommandInteraction) {
        const matchId = interaction.options.getInteger('match_id', true);

        const match = await prisma.match.findUnique({
            where: { id: matchId },
        });

        if (!match) {
            await interaction.reply({ content: 'Match not found.', ephemeral: true });
            return;
        }

        if (match.winner) {
            await interaction.reply({ content: 'This match was already reported and cannot be cancelled.', ephemeral: true });
            return;
        }

        if (interaction.guild) {
            const { lobbyManager } = await import('../../managers/LobbyManager');
            await lobbyManager.cleanupMatch(matchId, interaction.guild);
        }

        // Keep the record (history/debug) — just mark it cancelled
        await prisma.match.update({
            where: { id: matchId },
            data: { status: 'cancelled' },
        });

        if (interaction.guild) {
            const { logAdmin } = await import('../../utils/adminLog');
            await logAdmin(interaction.guild, match.game, '🛑 Match cancelled',
                `Match **#${matchId}** (${match.game} ${match.mode}) cancelled by <@${interaction.user.id}>.`);
        }

        await interaction.reply({ content: `Match #${matchId} has been cancelled.`, ephemeral: false });
    },
};
