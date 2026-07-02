import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { queueManager } from '../../managers/QueueManager';

export const command = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a player from the queue')
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .addUserOption((option) => option.setName('user').setDescription('The user to kick').setRequired(true))
        .addStringOption((option) =>
            option
                .setName('game')
                .setDescription('The game queue')
                .setRequired(true)
                .addChoices(
                    { name: 'Rocket League', value: 'rl' },
                    { name: 'Counter-Strike 2', value: 'cs2' },
                    { name: 'Rainbow Six Siege', value: 'r6s' },
                ),
        )
        .addStringOption((option) => option.setName('reason').setDescription('Reason for kick').setRequired(false)),
    async execute(interaction: ChatInputCommandInteraction) {
        const targetUser = interaction.options.getUser('user', true);
        const game = interaction.options.getString('game', true);
        const reason = interaction.options.getString('reason') || 'No reason provided';

        // Kick from every mode queue of this game
        let success = false;
        for (const config of queueManager.getGameConfigs(game)) {
            if (await queueManager.removePlayer(game, config.mode, targetUser.id)) {
                success = true;
            }
        }

        if (success) {
            await interaction.reply({ content: `👢 **${targetUser.username}** was kicked from the **${game.toUpperCase()}** queue.\nReason: ${reason}` });
        } else {
            await interaction.reply({ content: '⚠️ User is not in that queue.', ephemeral: true });
        }
    },
};
