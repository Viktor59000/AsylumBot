import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { COLORS } from '../../utils/constants';

const prisma = new PrismaClient();

export const command = {
    data: new SlashCommandBuilder()
        .setName('reportwin')
        .setDescription('Report a match win')
        .addIntegerOption((option) =>
            option.setName('match_id').setDescription('The ID of the match').setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('winning_team')
                .setDescription('The winning team')
                .setRequired(true)
                .addChoices({ name: 'Team 1', value: 'team1' }, { name: 'Team 2', value: 'team2' }),
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const matchId = interaction.options.getInteger('match_id', true);
        const winningTeam = interaction.options.getString('winning_team', true);

        const match = await prisma.match.findUnique({
            where: { id: matchId },
            include: { players: { include: { user: true } } },
        });

        if (!match) {
            await interaction.reply({ content: 'Match not found.', ephemeral: true });
            return;
        }

        if (match.winner) {
            await interaction.reply({ content: 'Match already reported.', ephemeral: true });
            return;
        }

        // Update Match
        await prisma.match.update({
            where: { id: matchId },
            data: { winner: winningTeam },
        });

        // Calculate Team Averages
        const { EloManager } = await import('../../managers/EloManager');

        const team1Players = match.players.filter(p => p.team === 'team1');
        const team2Players = match.players.filter(p => p.team === 'team2');

        const getTeamAvg = async (players: typeof team1Players) => {
            let total = 0;
            for (const p of players) {
                total += await EloManager.getElo(p.userId, match.game);
            }
            return players.length > 0 ? total / players.length : 1000;
        };

        const avgElo1 = await getTeamAvg(team1Players);
        const avgElo2 = await getTeamAvg(team2Players);

        // Update Elo
        const eloChanges: string[] = [];

        for (const player of match.players) {
            const isWinner = player.team === winningTeam;
            const currentElo = await EloManager.getElo(player.userId, match.game);
            const opponentAvg = player.team === 'team1' ? avgElo2 : avgElo1;

            const newRating = EloManager.calculateNewRating(currentElo, opponentAvg, isWinner ? 1 : 0);
            const change = newRating - currentElo;

            await EloManager.updateElo(player.userId, match.game, newRating, isWinner);

            eloChanges.push(`${isWinner ? '✅' : '❌'} <@${player.userId}>: ${change > 0 ? '+' : ''}${change} (${newRating})`);

            // Update Challenge Progress
            const { ChallengeManager } = await import('../../managers/ChallengeManager');
            const challengeManager = new ChallengeManager(interaction.client);
            await challengeManager.updateProgress(player.userId, isWinner);
        }

        const embed = new EmbedBuilder()
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setTitle('Match Reported')
            .setDescription(`**Winner:** ${winningTeam === 'team1' ? 'Team 1' : 'Team 2'}\n**Match ID:** ${matchId}`)
            .addFields({ name: 'Elo Changes', value: eloChanges.join('\n') || 'No changes' });

        // Cleanup Voice Channels
        if (interaction.guild) {
            if (match.channelId1) {
                const channel1 = interaction.guild.channels.cache.get(match.channelId1);
                if (channel1) await channel1.delete().catch(console.error);
            }
            if (match.channelId2) {
                const channel2 = interaction.guild.channels.cache.get(match.channelId2);
                if (channel2) await channel2.delete().catch(console.error);
            }
        }

        await interaction.reply({ embeds: [embed] });

        // Send Webhook Data
        const { WebhookManager } = await import('../../managers/WebhookManager');
        const webhookManager = new WebhookManager();
        await webhookManager.sendMatchData(matchId);

        // Update Leaderboard
        const { LeaderboardManager } = await import('../../managers/LeaderboardManager');
        const leaderboardManager = new LeaderboardManager(interaction.client);
        await leaderboardManager.updateLeaderboard(match.game);
    },
};
