import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../../utils/db';

/**
 * Admin fallback for placement matches: players report via the position
 * select in the match lobby. Ranking e.g. `3,1,4,2` (partial allowed —
 * unlisted teams keep their Elo), which also makes reduced-roster test
 * matches reportable.
 */
export const command = {
    data: new SlashCommandBuilder()
        .setName('reportplacement')
        .setDescription('Report a placement match (admin fallback — players use the lobby select)')
        .addIntegerOption((option) =>
            option.setName('match_id').setDescription('The ID of the match').setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('ranking')
                .setDescription('Team numbers from 1st to last, e.g. "3,1,4,2" (partial allowed)')
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction: ChatInputCommandInteraction) {
        const matchId = interaction.options.getInteger('match_id', true);
        const rankingInput = interaction.options.getString('ranking', true);

        if (!interaction.guild) {
            await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
            return;
        }

        const match = await prisma.match.findUnique({
            where: { id: matchId },
            include: { players: { select: { team: true } } },
        });
        if (!match) {
            await interaction.reply({ content: 'Match not found.', ephemeral: true });
            return;
        }

        // Parse ranking: "3,1,4,2" / "team3 team1" → ['team3', 'team1', ...]
        const teamsInMatch = new Set(match.players.map(p => p.team));
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

        const { getManagers } = await import('../../managers/registry');
        const result = await getManagers().report.finalizePlacement(matchId, rankedTeams, interaction.guild, interaction.user.id);

        if (!result.success) {
            await interaction.editReply({ content: `❌ ${result.error}` });
            return;
        }

        await interaction.editReply({ embeds: result.embed ? [result.embed] : [] });
    },
};
