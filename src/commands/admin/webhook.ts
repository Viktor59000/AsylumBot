import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../../utils/db';
import { GAME_CONFIGS } from '../../utils/constants';

export const command = {
    data: new SlashCommandBuilder()
        .setName('webhook')
        .setDescription('Configure the match data webhook')
        .addStringOption(option =>
            option.setName('game')
                .setDescription('The game to configure')
                .setRequired(true)
                .addChoices(
                    ...Object.entries(GAME_CONFIGS).map(([key, config]) => ({ name: config.name, value: key }))
                )
        )
        .addStringOption(option =>
            option.setName('url')
                .setDescription('The webhook URL (or "none" to remove)')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply({ ephemeral: true });

        const game = interaction.options.getString('game', true);
        const url = interaction.options.getString('url', true);

        if (!interaction.guildId) {
            await interaction.editReply('This command can only be used in a server.');
            return;
        }

        const configs = await prisma.gameConfig.findMany({
            where: { guildId: interaction.guildId, game }
        });

        if (configs.length === 0) {
            await interaction.editReply(`No configuration found for **${game}**. Please run \`/setup\` first.`);
            return;
        }

        const newUrl = url.toLowerCase() === 'none' ? null : url;

        // The webhook applies to the whole game (every mode row)
        await prisma.gameConfig.updateMany({
            where: { guildId: interaction.guildId, game },
            data: { webhookUrl: newUrl }
        });

        if (newUrl) {
            await interaction.editReply(`✅ Webhook for **${game}** set to: \`${newUrl}\``);
        } else {
            await interaction.editReply(`✅ Webhook for **${game}** removed.`);
        }
    }
};
