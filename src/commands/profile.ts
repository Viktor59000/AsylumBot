import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { prisma } from '../utils/db';
import { COLORS, GAME_CONFIGS } from '../utils/constants';


export const command = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View player profile')
        .addUserOption((option) => option.setName('user').setDescription('The user to view').setRequired(false))
        .addStringOption((option) =>
            option
                .setName('game')
                .setDescription('The game to view')
                .setRequired(true)
                .addChoices(
                    ...Object.entries(GAME_CONFIGS).map(([key, config]) => ({ name: config.name, value: key }))
                ),
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const game = interaction.options.getString('game', true);
        const config = GAME_CONFIGS[game as keyof typeof GAME_CONFIGS];

        // Ensure user exists
        await prisma.user.upsert({
            where: { id: targetUser.id },
            update: { username: targetUser.username },
            create: { id: targetUser.id, username: targetUser.username },
        });

        const eloData = await prisma.elo.findFirst({
            where: {
                userId: targetUser.id,
                game,
                seasonId: null
            },
        });

        const rating = eloData ? eloData.rating : 1000;
        const wins = eloData ? eloData.wins : 0;
        const losses = eloData ? eloData.losses : 0;
        const total = wins + losses;
        const winrate = total > 0 ? Math.round((wins / total) * 100) : 0;

        const embed = new EmbedBuilder()
            .setTitle(`📊 Profile: ${targetUser.username}`)
            .setDescription(`Stats for **${config.name}**`)
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: 'Elo Rating', value: `${rating}`, inline: true },
                { name: 'Win Rate', value: `${winrate}%`, inline: true },
                { name: 'Matches', value: `${total} (${wins}W - ${losses}L)`, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: 'ASYLUM ELO HUB', iconURL: 'https://i.imgur.com/AfFp7pu.png' });

        await interaction.reply({ embeds: [embed] });
    },
};
