import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../../utils/db';
import { setGuildLanguageCache, Language } from '../../utils/i18n';

export const command = {
    data: new SlashCommandBuilder()
        .setName('language')
        .setDescription('Set the bot language for this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('lang')
                .setDescription('The language to set')
                .setRequired(true)
                .addChoices(
                    { name: 'English', value: 'en' },
                    { name: 'Français', value: 'fr' }
                )
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const lang = interaction.options.getString('lang', true) as Language;
        const guildId = interaction.guildId;

        if (!guildId) {
            await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
            return;
        }

        try {
            await prisma.guildConfig.upsert({
                where: { id: guildId },
                update: { language: lang },
                create: { id: guildId, language: lang }
            });

            setGuildLanguageCache(guildId, lang);

            const confirmation = lang === 'fr' ? '✅ Langue définie sur **Français**.' : '✅ Language set to **English**.';
            await interaction.reply({ content: confirmation, ephemeral: true });

        } catch (error) {
            console.error(error);
            await interaction.reply({ content: '❌ An error occurred while saving the language.', ephemeral: true });
        }
    },
};
