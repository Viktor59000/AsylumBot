import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { getManagers } from '../../managers/registry';

export const command = {
    data: new SlashCommandBuilder()
        .setName('suspend')
        .setDescription('Suspend a user from the queue')
        .addUserOption(option =>
            option.setName('user').setDescription('The user to suspend').setRequired(true)
        )
        .addIntegerOption(option =>
            option.setName('duration').setDescription('Duration in minutes').setRequired(true)
        )
        .addStringOption(option =>
            option.setName('reason').setDescription('Reason for suspension').setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ ephemeral: true });

        const user = interaction.options.getUser('user', true);
        const duration = interaction.options.getInteger('duration', true);
        const reason = interaction.options.getString('reason', true);

        await getManagers().penalty.suspendUser(user.id, duration, reason);

        await interaction.editReply(`✅ Suspended **${user.tag}** for **${duration} minutes**. Reason: ${reason}`);
    }
};
