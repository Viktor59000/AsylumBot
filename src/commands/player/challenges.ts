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
            include: { daily: true, weekly: true }
        });

        if (!user) {
            await interaction.editReply('Profile not found. Play a match first!');
            return;
        }

        const daily = user.daily || { matchesPlayed: 0, matchesWon: 0 };
        const weekly = user.weekly || { matchesPlayed: 0, matchesWon: 0 };

        // Goals (must match ChallengeManager)
        const DAILY_PLAYED = 3, DAILY_WON = 1;
        const WEEKLY_PLAYED = 10, WEEKLY_WON = 5;

        // First-win-of-the-day bonuses claimed today
        const today = new Date().toISOString().slice(0, 10);
        const firstWins = await prisma.dailyGameWin.findMany({
            where: { userId: interaction.user.id, date: today }
        });
        const firstWinLine = firstWins.length > 0
            ? firstWins.map(w => `🌟 ${w.game}`).join(' • ')
            : '*None yet — win your first match of the day per game (+25 🪙)*';

        const field = (label: string, current: number, goal: number, reward: string) => ({
            name: `${current >= goal ? '✅' : '⏳'} ${label} (${reward})`,
            value: `${getProgressBar(Math.min(current, goal), goal)} **${Math.min(current, goal)}/${goal}**`,
            inline: false
        });

        const embed = new EmbedBuilder()
            .setTitle(`🎯 Challenges`)
            .setThumbnail(interaction.user.displayAvatarURL())
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setDescription(`**Balance:** ${user.coins} 🪙`)
            .addFields(
                field(`Daily — Play ${DAILY_PLAYED} Matches`, daily.matchesPlayed, DAILY_PLAYED, '+50 🪙'),
                field(`Daily — Win ${DAILY_WON} Match`, daily.matchesWon, DAILY_WON, '+50 🪙'),
                field(`Weekly — Play ${WEEKLY_PLAYED} Matches`, weekly.matchesPlayed, WEEKLY_PLAYED, '+150 🪙'),
                field(`Weekly — Win ${WEEKLY_WON} Matches`, weekly.matchesWon, WEEKLY_WON, '+100 🪙'),
                { name: '🌟 First win of the day (per game, +25 🪙)', value: firstWinLine, inline: false }
            )
            .setFooter({ text: 'Daily reset 00:00 UTC • Weekly reset Monday • Rush hours multiply rewards 🔥', iconURL: BOT_ICON });

        await interaction.editReply({ embeds: [embed] });
    }
};

function getProgressBar(current: number, max: number, length = 10): string {
    const filled = Math.round((current / max) * length);
    const empty = length - filled;
    return '🟩'.repeat(filled) + '⬛'.repeat(empty);
}
