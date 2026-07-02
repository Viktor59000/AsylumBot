import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import { prisma } from '../../utils/db';
import { COLORS, EMOJIS, BOT_ICON } from '../../utils/constants';

export const command = {
    data: new SlashCommandBuilder()
        .setName('challenges')
        .setDescription('View your daily challenges and coin balance.'),

    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const user = await prisma.user.findUnique({
            where: { id: interaction.user.id },
            include: { daily: true }
        });

        if (!user) {
            await interaction.editReply('Profile not found. Play a match first!');
            return;
        }

        const daily = user.daily || { matchesPlayed: 0, matchesWon: 0 };

        // Goals (Hardcoded for now, should match Manager)
        const GOAL_PLAYED = 3;
        const GOAL_WON = 1;

        const playedProgress = Math.min(daily.matchesPlayed, GOAL_PLAYED);
        const wonProgress = Math.min(daily.matchesWon, GOAL_WON);

        const playedBar = getProgressBar(playedProgress, GOAL_PLAYED);
        const wonBar = getProgressBar(wonProgress, GOAL_WON);

        const embed = new EmbedBuilder()
            .setTitle(`🎯 Daily Challenges`)
            .setThumbnail(interaction.user.displayAvatarURL())
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setDescription(`**Balance:** ${user.coins} 🪙`)
            .addFields(
                {
                    name: `${playedProgress >= GOAL_PLAYED ? '✅' : '⏳'} Play ${GOAL_PLAYED} Matches`,
                    value: `${playedBar} **${playedProgress}/${GOAL_PLAYED}**`,
                    inline: false
                },
                {
                    name: `${wonProgress >= GOAL_WON ? '✅' : '⏳'} Win ${GOAL_WON} Match`,
                    value: `${wonBar} **${wonProgress}/${GOAL_WON}**`,
                    inline: false
                }
            )
            .setFooter({ text: 'Resets daily at midnight', iconURL: BOT_ICON });

        await interaction.editReply({ embeds: [embed] });
    }
};

function getProgressBar(current: number, max: number, length = 10): string {
    const filled = Math.round((current / max) * length);
    const empty = length - filled;
    return '🟩'.repeat(filled) + '⬛'.repeat(empty);
}
