import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../../utils/db';
import { GAME_CONFIGS } from '../../utils/constants';


export const command = {
    data: new SlashCommandBuilder()
        .setName('ign')
        .setDescription('Set your In-Game Name')
        .addStringOption((option) =>
            option
                .setName('game')
                .setDescription('The game to set IGN for')
                .setRequired(true)
                .addChoices(
                    ...Object.entries(GAME_CONFIGS).map(([key, config]) => ({ name: config.name, value: key }))
                ),
        )
        .addStringOption((option) =>
            option.setName('pseudo').setDescription('Your In-Game Name').setRequired(true),
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const game = interaction.options.getString('game', true);
        const pseudo = interaction.options.getString('pseudo', true);
        const userId = interaction.user.id;

        // Validation for Riot Games (LoL, Valorant, Arena, TFT)
        if (game === 'lol' || game === 'valorant' || game === 'arena' || game === 'tft') {
            if (!pseudo.includes('#')) {
                await interaction.reply({
                    content: `❌ Invalid format for **${GAME_CONFIGS[game as keyof typeof GAME_CONFIGS].name}**.\nPlease use the Riot ID format: \`Name#Tag\` (e.g., \`Faker#KR1\`).`,
                    ephemeral: true
                });
                return;
            }
        }

        // Ensure user exists
        await prisma.user.upsert({
            where: { id: userId },
            update: { username: interaction.user.username },
            create: { id: userId, username: interaction.user.username },
        });

        // Upsert IGN
        await prisma.userIgn.upsert({
            where: { userId_game: { userId, game } },
            update: { ign: pseudo },
            create: { userId, game, ign: pseudo },
        });

        // Tracker deep-links built from the IGN (no API required — DESIGN §3bis)
        const { formatTrackerLinks } = await import('../../utils/trackers');
        const regionConfig = interaction.guildId
            ? await prisma.gameConfig.findFirst({ where: { guildId: interaction.guildId, game }, select: { region: true } })
            : null;
        const links = formatTrackerLinks(game, pseudo, regionConfig?.region ?? 'EUW');

        await interaction.reply({
            content: `✅ Your IGN for **${GAME_CONFIGS[game as keyof typeof GAME_CONFIGS].name}** has been set to **${pseudo}**.`
                + (links ? `\n🔗 **Trackers:** ${links}` : ''),
            ephemeral: true,
        });
    },
};
