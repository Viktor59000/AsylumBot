import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';

/**
 * Admin fallback: players report via the buttons in the match lobby
 * (cross-confirmed). This command settles contested/stuck matches.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('reportwin')
        .setDescription('Report a match win (admin fallback — players use the lobby buttons)')
        .addIntegerOption((option) =>
            option.setName('match_id').setDescription('The ID of the match').setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('winning_team')
                .setDescription('The winning team')
                .setRequired(true)
                .addChoices({ name: 'Team 1', value: 'team1' }, { name: 'Team 2', value: 'team2' }),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction: ChatInputCommandInteraction) {
        const matchId = interaction.options.getInteger('match_id', true);
        const winningTeam = interaction.options.getString('winning_team', true);

        if (!interaction.guild) {
            await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
            return;
        }

        await interaction.deferReply();

        const { getManagers } = await import('../../managers/registry');
        const result = await getManagers().report.finalizeTvt(matchId, winningTeam, interaction.guild, interaction.user.id);

        if (!result.success) {
            await interaction.editReply({ content: `❌ ${result.error}` });
            return;
        }

        await interaction.editReply({ embeds: result.embed ? [result.embed] : [] });
    },
};
