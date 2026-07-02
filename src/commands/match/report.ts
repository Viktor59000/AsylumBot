import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { prisma } from '../../utils/db';
import { COLORS } from '../../utils/constants';


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

        if (match.status === 'cancelled' || match.status === 'abandoned') {
            await interaction.reply({ content: `This match was ${match.status} and can no longer be reported.`, ephemeral: true });
            return;
        }

        // Update Match
        await prisma.match.update({
            where: { id: matchId },
            data: { winner: winningTeam, status: 'reported' },
        });

        // Calculate Team Averages
        const { EloManager } = await import('../../managers/EloManager');

        const team1Players = match.players.filter(p => p.team === 'team1');
        const team2Players = match.players.filter(p => p.team === 'team2');

        const getTeamAvg = async (players: typeof team1Players) => {
            let total = 0;
            for (const p of players) {
                total += await EloManager.getElo(p.userId, match.game, match.mode);
            }
            return players.length > 0 ? total / players.length : 1000;
        };

        const avgElo1 = await getTeamAvg(team1Players);
        const avgElo2 = await getTeamAvg(team2Players);

        // Update Elo
        const eloChanges: string[] = [];

        for (const player of match.players) {
            const isWinner = player.team === winningTeam;
            const currentElo = await EloManager.getElo(player.userId, match.game, match.mode);
            const opponentAvg = player.team === 'team1' ? avgElo2 : avgElo1;

            const newRating = EloManager.calculateNewRating(currentElo, opponentAvg, isWinner ? 1 : 0);
            const change = newRating - currentElo;

            await EloManager.updateElo(player.userId, match.game, match.mode, newRating, isWinner);

            eloChanges.push(`${isWinner ? '✅' : '❌'} <@${player.userId}>: ${change > 0 ? '+' : ''}${change} (${newRating})`);

            // Update Challenge Progress (singleton — never instantiate here, it owns timers)
            const { getManagers } = await import('../../managers/registry');
            await getManagers().challenge.updateProgress(player.userId, isWinner);
        }

        const embed = new EmbedBuilder()
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setTitle('Match Reported')
            .setDescription(`**Winner:** ${winningTeam === 'team1' ? 'Team 1' : 'Team 2'}\n**Match ID:** ${matchId}`)
            .addFields({ name: 'Elo Changes', value: eloChanges.join('\n') || 'No changes' });

        await interaction.reply({ embeds: [embed] });

        if (interaction.guild) {
            const { lobbyManager } = await import('../../managers/LobbyManager');
            await lobbyManager.cleanupMatch(matchId, interaction.guild);
        }

        // Send Webhook Data + Update Leaderboard (singletons)
        const { getManagers } = await import('../../managers/registry');
        await getManagers().webhook.sendMatchData(matchId);
        await getManagers().leaderboard.updateLeaderboard(match.game, match.mode);
    },
};
