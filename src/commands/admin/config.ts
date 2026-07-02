import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { queueManager } from '../../managers/QueueManager';

export const command = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure game settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option
                .setName('game')
                .setDescription('The game to configure')
                .setRequired(true)
                .addChoices(
                    { name: 'Rocket League', value: 'rl' },
                    { name: 'Counter-Strike 2', value: 'cs2' },
                    { name: 'Rainbow Six Siege', value: 'r6s' },
                ),
        )
        .addIntegerOption((option) =>
            option.setName('teamsize').setDescription('Players per team').setRequired(false),
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const game = interaction.options.getString('game', true);
        const teamSize = interaction.options.getInteger('teamsize');

        const config = queueManager.getConfig(game);
        if (!config) {
            await interaction.reply({ content: 'Invalid game.', ephemeral: true });
            return;
        }

        let updates = [];

        if (teamSize) {
            config.teamSize = teamSize;
            updates.push(`Team Size: **${teamSize}**`);
        }

        if (updates.length > 0) {
            await interaction.reply({ content: `✅ Updated **${config.name}** configuration:\n${updates.join('\n')}` });
        } else {
            await interaction.reply({
                content: `ℹ️ **${config.name}** configuration:\nTeam Size: ${config.teamSize}\nTotal Players: ${config.teamSize * 2}`
            });
        }
    },
};
