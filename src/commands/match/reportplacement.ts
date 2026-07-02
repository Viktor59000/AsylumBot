import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { prisma } from '../../utils/db';
import { COLORS } from '../../utils/constants';

/**
 * Report for placement matches (Arena 6×3, TFT Solo/Double Up): a ranking 1→N
 * of team numbers, e.g. `ranking:3,1,4,2` → Team 3 finished 1st, Team 1 2nd...
 * Partial rankings are accepted (unlisted teams keep their Elo) — this also
 * makes reduced-roster test matches (force_start) reportable.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('reportplacement')
        .setDescription('Report a placement match result (ranking 1→N)')
        .addIntegerOption((option) =>
            option.setName('match_id').setDescription('The ID of the match').setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('ranking')
                .setDescription('Team numbers from 1st to last, e.g. "3,1,4,2" (partial allowed)')
                .setRequired(true),
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const matchId = interaction.options.getInteger('match_id', true);
        const rankingInput = interaction.options.getString('ranking', true);

        const match = await prisma.match.findUnique({
            where: { id: matchId },
            include: { players: { include: { user: true } } },
        });

        if (!match) {
            await interaction.reply({ content: 'Match not found.', ephemeral: true });
            return;
        }

        if (match.matchType !== 'placement') {
            await interaction.reply({ content: 'This is a team-vs-team match — use `/reportwin` instead.', ephemeral: true });
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

        // Teams actually present in this match (team1..teamN)
        const teamsInMatch = new Set(match.players.map(p => p.team));

        // Parse ranking: "3,1,4,2" / "team3 team1" → ['team3', 'team1', ...]
        const tokens = rankingInput.split(/[\s,;]+/).filter(Boolean);
        const rankedTeams: string[] = [];
        for (const token of tokens) {
            const num = parseInt(token.replace(/^team/i, ''), 10);
            if (isNaN(num)) {
                await interaction.reply({ content: `❌ Invalid ranking entry: \`${token}\`. Use team numbers, e.g. \`3,1,4,2\`.`, ephemeral: true });
                return;
            }
            const teamKey = `team${num}`;
            if (!teamsInMatch.has(teamKey)) {
                await interaction.reply({ content: `❌ Team **${num}** is not part of match #${matchId}. Teams: ${Array.from(teamsInMatch).map(t => t.replace('team', '')).sort((a, b) => +a - +b).join(', ')}.`, ephemeral: true });
                return;
            }
            if (rankedTeams.includes(teamKey)) {
                await interaction.reply({ content: `❌ Team **${num}** appears twice in the ranking.`, ephemeral: true });
                return;
            }
            rankedTeams.push(teamKey);
        }

        if (rankedTeams.length < 2) {
            await interaction.reply({ content: '❌ A ranking needs at least 2 teams (e.g. `2,1`).', ephemeral: true });
            return;
        }

        await interaction.deferReply();

        const { EloManager } = await import('../../managers/EloManager');
        const { getManagers } = await import('../../managers/registry');

        // Team ratings (average of members) over the PLACED teams only —
        // a partial ranking scores the placed field against itself.
        const totalPlaced = rankedTeams.length;
        const teamMembers = new Map<string, typeof match.players>();
        const teamRatings = new Map<string, number>();
        for (const teamKey of rankedTeams) {
            const members = match.players.filter(p => p.team === teamKey);
            teamMembers.set(teamKey, members);
            let total = 0;
            for (const m of members) {
                total += await EloManager.getElo(m.userId, match.game, match.mode);
            }
            teamRatings.set(teamKey, members.length > 0 ? total / members.length : 1000);
        }
        const fieldAvg = Array.from(teamRatings.values()).reduce((a, b) => a + b, 0) / totalPlaced;

        const resultLines: string[] = [];

        for (let i = 0; i < rankedTeams.length; i++) {
            const teamKey = rankedTeams[i];
            const placement = i + 1;
            const members = teamMembers.get(teamKey)!;
            const teamRating = teamRatings.get(teamKey)!;

            // Team-based delta: the team's placement gives the same Δ to every member
            const delta = EloManager.calculatePlacementDelta(teamRating, fieldAvg, placement, totalPlaced);
            const isWin = placement <= Math.ceil(totalPlaced / 2); // top half counts as a win

            const memberTags: string[] = [];
            for (const member of members) {
                const currentElo = await EloManager.getElo(member.userId, match.game, match.mode);
                const newRating = currentElo + delta;
                await EloManager.updateElo(member.userId, match.game, match.mode, newRating, isWin);
                await getManagers().challenge.updateProgress(member.userId, placement === 1);
                memberTags.push(`<@${member.userId}>`);
            }

            // Persist the placement on every member of the team
            await prisma.matchPlayer.updateMany({
                where: { matchId, team: teamKey },
                data: { placement },
            });

            const medal = placement === 1 ? '🥇' : placement === 2 ? '🥈' : placement === 3 ? '🥉' : `#${placement}`;
            resultLines.push(`${medal} **Team ${teamKey.replace('team', '')}** — ${memberTags.join(' & ')}: ${delta > 0 ? '+' : ''}${delta}`);
        }

        const unplaced = Array.from(teamsInMatch).filter(t => !rankedTeams.includes(t));
        if (unplaced.length > 0) {
            resultLines.push(`▫️ Unranked (no Elo change): ${unplaced.map(t => `Team ${t.replace('team', '')}`).join(', ')}`);
        }

        await prisma.match.update({
            where: { id: matchId },
            data: { winner: rankedTeams[0], status: 'reported' },
        });

        const embed = new EmbedBuilder()
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setTitle('Match Reported (Placement)')
            .setDescription(`**Match ID:** ${matchId}\n**Ranking 1→${totalPlaced}**`)
            .addFields({ name: 'Results', value: resultLines.join('\n') || 'No changes' });

        await interaction.editReply({ embeds: [embed] });

        if (interaction.guild) {
            const { lobbyManager } = await import('../../managers/LobbyManager');
            await lobbyManager.cleanupMatch(matchId, interaction.guild);
        }

        await getManagers().webhook.sendMatchData(matchId);
        await getManagers().leaderboard.updateLeaderboard(match.game, match.mode);
    },
};
