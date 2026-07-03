import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    Client,
    EmbedBuilder,
    Guild,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextChannel
} from 'discord.js';
import { prisma } from '../utils/db';
import { COLORS } from '../utils/constants';
import { EloManager } from './EloManager';
import { LobbyState } from './LobbyManager';
import { logAdmin } from '../utils/adminLog';
import { logger } from '../utils/logger';

interface TvtClaim {
    winningTeam: 'team1' | 'team2';
    claimedBy: string;      // userId
    claimerTeam: string;    // the claimer's own team
}

/**
 * Secure button-based match reporting (DESIGN §6 / P2-1):
 * - participants only (admins bypass),
 * - tvt: claim by one team + cross-confirmation by the OTHER team,
 * - contest → frozen for admins + admin log,
 * - placement: each team picks its own position, auto-finalizes when complete,
 * - result written to #match-history + admin logs, then cleanup.
 * Slash commands (/reportwin, /reportplacement) share the same finalizers.
 */
export class ReportManager {
    private client: Client;
    private tvtClaims: Map<number, TvtClaim> = new Map();               // matchId → claim
    private placementClaims: Map<number, Map<string, number>> = new Map(); // matchId → teamKey → position

    constructor(client: Client) {
        this.client = client;
    }

    // ---------- Lobby controls ----------

    /** Posts the standard report controls in the lobby channel (called once the match is live). */
    async postReportControls(lobby: LobbyState, channel: TextChannel) {
        if (lobby.teams && lobby.teams.length > 0) {
            const options = lobby.teams.map((_, i) => ({
                label: `${i + 1}${i === 0 ? 'st' : i === 1 ? 'nd' : i === 2 ? 'rd' : 'th'} place`,
                value: String(i + 1),
            }));
            const select = new StringSelectMenuBuilder()
                .setCustomId(`report_place_${lobby.matchId}`)
                .setPlaceholder('Report YOUR team\'s final position...')
                .addOptions(options);
            const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
            const adminRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`report_placeforce_${lobby.matchId}`)
                    .setLabel('Finalize now (admin)')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('🛡️')
            );
            const msg = await channel.send({
                content: '🏁 **Result report** — each team selects its final position. The result validates automatically once every team has picked.',
                components: [row, adminRow],
            });
            await msg.pin().catch(() => { });
        } else {
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`report_win_${lobby.matchId}_team1`).setLabel('Team 1 won').setStyle(ButtonStyle.Primary).setEmoji('🔵'),
                new ButtonBuilder().setCustomId(`report_win_${lobby.matchId}_team2`).setLabel('Team 2 won').setStyle(ButtonStyle.Danger).setEmoji('🔴'),
            );
            const msg = await channel.send({
                content: '🏁 **Result report** — a player of the winning team clicks, a player of the **other** team confirms.',
                components: [row],
            });
            await msg.pin().catch(() => { });
        }
    }

    // ---------- Interaction handlers ----------

    async handleButton(interaction: ButtonInteraction) {
        const parts = interaction.customId.split('_'); // report_win_<id>_<team> | report_confirm_<id> | report_contest_<id> | report_placeforce_<id>
        const action = parts[1];
        const matchId = parseInt(parts[2], 10);
        if (isNaN(matchId)) return;

        const match = await prisma.match.findUnique({ where: { id: matchId }, include: { players: true } });
        if (!match || match.winner || ['reported', 'cancelled', 'abandoned'].includes(match.status)) {
            await interaction.reply({ content: '❌ This match can no longer be reported.', ephemeral: true });
            return;
        }

        const isAdmin = interaction.memberPermissions?.has('Administrator') ?? false;
        const participant = match.players.find(p => p.userId === interaction.user.id);
        if (!participant && !isAdmin) {
            await interaction.reply({ content: '❌ Only match participants can report the result.', ephemeral: true });
            return;
        }

        if (action === 'win') {
            const winningTeam = parts[3] as 'team1' | 'team2';

            if (isAdmin && !participant) {
                // Admin shortcut: no cross-confirmation needed
                await this.finalizeAndReply(interaction, matchId, winningTeam);
                return;
            }

            this.tvtClaims.set(matchId, {
                winningTeam,
                claimedBy: interaction.user.id,
                claimerTeam: participant!.team,
            });

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`report_confirm_${matchId}`).setLabel('Confirm').setStyle(ButtonStyle.Success).setEmoji('✅'),
                new ButtonBuilder().setCustomId(`report_contest_${matchId}`).setLabel('Contest').setStyle(ButtonStyle.Danger).setEmoji('🚨'),
            );
            await interaction.update({
                content: `⏳ <@${interaction.user.id}> reports **${winningTeam === 'team1' ? 'Team 1 🔵' : 'Team 2 🔴'}** as winner.\nA player of the **opposing team** (or an admin) must **confirm** — or anyone in the match can **contest**.`,
                components: [row],
            });
            return;
        }

        if (action === 'confirm') {
            const claim = this.tvtClaims.get(matchId);
            if (!claim) {
                await interaction.reply({ content: '❌ No pending result to confirm (re-click a "Team won" button).', ephemeral: true });
                return;
            }
            const sameTeam = participant && participant.team === claim.claimerTeam;
            if (!isAdmin && (!participant || sameTeam)) {
                await interaction.reply({ content: '❌ The confirmation must come from the **opposing team** (or an admin).', ephemeral: true });
                return;
            }
            this.tvtClaims.delete(matchId);
            await this.finalizeAndReply(interaction, matchId, claim.winningTeam);
            return;
        }

        if (action === 'contest') {
            const claim = this.tvtClaims.get(matchId);
            this.tvtClaims.delete(matchId);
            if (interaction.guild) {
                await logAdmin(interaction.guild, match.game, '🚨 Result contested',
                    `Match **#${matchId}** (${match.game} ${match.mode}) — <@${interaction.user.id}> contests` +
                    (claim ? ` the report of <@${claim.claimedBy}> (${claim.winningTeam}).` : ' the result.') +
                    `\nAn admin can settle with the report buttons or \`/reportwin\`.`);
            }
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`report_win_${matchId}_team1`).setLabel('Team 1 won').setStyle(ButtonStyle.Primary).setEmoji('🔵'),
                new ButtonBuilder().setCustomId(`report_win_${matchId}_team2`).setLabel('Team 2 won').setStyle(ButtonStyle.Danger).setEmoji('🔴'),
            );
            await interaction.update({
                content: `🚨 **Result contested** by <@${interaction.user.id}> — admins have been notified.\nPlayers can re-report below, or an admin settles it.`,
                components: [row],
            });
            return;
        }

        if (action === 'placeforce') {
            if (!isAdmin) {
                await interaction.reply({ content: '❌ Admin only — players report by selecting their position.', ephemeral: true });
                return;
            }
            const claims = this.placementClaims.get(matchId);
            if (!claims || claims.size < 2) {
                await interaction.reply({ content: '❌ At least 2 teams must have picked a position before forcing.', ephemeral: true });
                return;
            }
            const ranked = Array.from(claims.entries()).sort((a, b) => a[1] - b[1]).map(([team]) => team);
            this.placementClaims.delete(matchId);
            await this.finalizePlacementAndReply(interaction, matchId, ranked);
            return;
        }
    }

    async handleSelect(interaction: StringSelectMenuInteraction) {
        // report_place_<matchId>
        const matchId = parseInt(interaction.customId.split('_')[2], 10);
        if (isNaN(matchId)) return;

        const match = await prisma.match.findUnique({ where: { id: matchId }, include: { players: true } });
        if (!match || match.winner || ['reported', 'cancelled', 'abandoned'].includes(match.status)) {
            await interaction.reply({ content: '❌ This match can no longer be reported.', ephemeral: true });
            return;
        }

        const participant = match.players.find(p => p.userId === interaction.user.id);
        if (!participant) {
            await interaction.reply({ content: '❌ Only match participants can report their position.', ephemeral: true });
            return;
        }

        const position = parseInt(interaction.values[0], 10);
        const teamCount = new Set(match.players.map(p => p.team)).size;

        let claims = this.placementClaims.get(matchId);
        if (!claims) {
            claims = new Map();
            this.placementClaims.set(matchId, claims);
        }

        // A position can only be held by one team (re-selecting your own is allowed)
        const holder = Array.from(claims.entries()).find(([, pos]) => pos === position)?.[0];
        if (holder && holder !== participant.team) {
            await interaction.reply({ content: `❌ Position **${position}** is already claimed by Team ${holder.replace('team', '')}.`, ephemeral: true });
            return;
        }

        claims.set(participant.team, position);

        if (claims.size >= teamCount) {
            // Every team has picked → finalize
            const ranked = Array.from(claims.entries()).sort((a, b) => a[1] - b[1]).map(([team]) => team);
            this.placementClaims.delete(matchId);
            await this.finalizePlacementAndReply(interaction, matchId, ranked);
            return;
        }

        const statusLines = Array.from(claims.entries())
            .sort((a, b) => a[1] - b[1])
            .map(([team, pos]) => `**#${pos}** — Team ${team.replace('team', '')}`);
        await interaction.reply({
            content: `✅ Team ${participant.team.replace('team', '')} → position **${position}** (${claims.size}/${teamCount} teams reported).\n${statusLines.join('\n')}`,
            ephemeral: false,
        });
    }

    private async finalizeAndReply(interaction: ButtonInteraction, matchId: number, winningTeam: 'team1' | 'team2') {
        await interaction.deferUpdate().catch(() => { });
        const result = await this.finalizeTvt(matchId, winningTeam, interaction.guild!, interaction.user.id);
        if (!result.success) {
            await interaction.followUp({ content: `❌ ${result.error}`, ephemeral: true }).catch(() => { });
            return;
        }
        await interaction.editReply({ content: `✅ Result validated by <@${interaction.user.id}>.`, components: [] }).catch(() => { });
        if (result.embed && interaction.channel && 'send' in interaction.channel) {
            await (interaction.channel as TextChannel).send({ embeds: [result.embed] }).catch(() => { });
        }
    }

    private async finalizePlacementAndReply(interaction: ButtonInteraction | StringSelectMenuInteraction, matchId: number, rankedTeams: string[]) {
        await interaction.deferUpdate().catch(() => { });
        const result = await this.finalizePlacement(matchId, rankedTeams, interaction.guild!, interaction.user.id);
        if (!result.success) {
            await interaction.followUp({ content: `❌ ${result.error}`, ephemeral: true }).catch(() => { });
            return;
        }
        if (result.embed && interaction.channel && 'send' in interaction.channel) {
            await (interaction.channel as TextChannel).send({ embeds: [result.embed] }).catch(() => { });
        }
    }

    // ---------- Finalizers (shared with /reportwin and /reportplacement) ----------

    async finalizeTvt(matchId: number, winningTeam: string, guild: Guild, reporterId?: string): Promise<{ success: boolean; error?: string; embed?: EmbedBuilder }> {
        const match = await prisma.match.findUnique({
            where: { id: matchId },
            include: { players: { include: { user: true } } },
        });

        if (!match) return { success: false, error: 'Match not found.' };
        if (match.matchType === 'placement') return { success: false, error: 'This is a placement match — use the position report.' };
        if (match.winner) return { success: false, error: 'Match already reported.' };
        if (match.status === 'cancelled' || match.status === 'abandoned') {
            return { success: false, error: `This match was ${match.status} and can no longer be reported.` };
        }

        await prisma.match.update({
            where: { id: matchId },
            data: { winner: winningTeam, status: 'reported' },
        });

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

        const { getManagers } = await import('./registry');
        const eloChanges: string[] = [];

        // Rush hour: Elo GAINS and challenge coins are multiplied (losses untouched)
        const multiplier = await getManagers().event.getActiveMultiplier(guild.id, match.game);

        for (const player of match.players) {
            const isWinner = player.team === winningTeam;
            const currentElo = await EloManager.getElo(player.userId, match.game, match.mode);
            const opponentAvg = player.team === 'team1' ? avgElo2 : avgElo1;

            let newRating = EloManager.calculateNewRating(currentElo, opponentAvg, isWinner ? 1 : 0);
            let change = newRating - currentElo;
            if (multiplier > 1 && change > 0) {
                change = Math.round(change * multiplier);
                newRating = currentElo + change;
            }

            await EloManager.updateElo(player.userId, match.game, match.mode, newRating, isWinner);
            await getManagers().challenge.updateProgress(player.userId, isWinner, { game: match.game, coinMultiplier: multiplier });

            eloChanges.push(`${isWinner ? '✅' : '❌'} <@${player.userId}>: ${change > 0 ? '+' : ''}${change} (${newRating})${multiplier > 1 && change > 0 ? ' 🔥' : ''}`);
        }

        const embed = new EmbedBuilder()
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setTitle('Match Reported')
            .setDescription(
                `**Winner:** ${winningTeam === 'team1' ? 'Team 1 🔵' : 'Team 2 🔴'}\n**Match ID:** ${matchId}${match.map ? `\n**Map:** ${match.map}` : ''}` +
                (multiplier > 1 ? `\n🔥 **RUSH HOUR ×${multiplier}** (gains boosted)` : ''))
            .addFields({ name: 'Elo Changes', value: eloChanges.join('\n') || 'No changes' })
            .setTimestamp();

        await this.publishResult(guild, match.game, match.mode, embed);
        await logAdmin(guild, match.game, '📝 Match reported',
            `Match **#${matchId}** (${match.game} ${match.mode}) — winner **${winningTeam}**${reporterId ? `, validated by <@${reporterId}>` : ''}.`);

        const { lobbyManager } = await import('./LobbyManager');
        await lobbyManager.cleanupMatch(matchId, guild).catch(err => logger.error(`[report] cleanup #${matchId}:`, err));

        await getManagers().webhook.sendMatchData(matchId);
        await getManagers().leaderboard.updateLeaderboard(match.game, match.mode);

        return { success: true, embed };
    }

    async finalizePlacement(matchId: number, rankedTeams: string[], guild: Guild, reporterId?: string): Promise<{ success: boolean; error?: string; embed?: EmbedBuilder }> {
        const match = await prisma.match.findUnique({
            where: { id: matchId },
            include: { players: { include: { user: true } } },
        });

        if (!match) return { success: false, error: 'Match not found.' };
        if (match.matchType !== 'placement') return { success: false, error: 'This is a team-vs-team match — use the win report.' };
        if (match.winner) return { success: false, error: 'Match already reported.' };
        if (match.status === 'cancelled' || match.status === 'abandoned') {
            return { success: false, error: `This match was ${match.status} and can no longer be reported.` };
        }
        if (rankedTeams.length < 2) return { success: false, error: 'A ranking needs at least 2 teams.' };

        const teamsInMatch = new Set(match.players.map(p => p.team));
        for (const teamKey of rankedTeams) {
            if (!teamsInMatch.has(teamKey)) return { success: false, error: `Team ${teamKey.replace('team', '')} is not part of this match.` };
        }
        if (new Set(rankedTeams).size !== rankedTeams.length) return { success: false, error: 'A team appears twice in the ranking.' };

        const { getManagers } = await import('./registry');

        // Field = placed teams only (partial rankings score the placed field against itself)
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

        // Rush hour: positive placement deltas and challenge coins are multiplied
        const multiplier = await getManagers().event.getActiveMultiplier(guild.id, match.game);

        const resultLines: string[] = [];

        for (let i = 0; i < rankedTeams.length; i++) {
            const teamKey = rankedTeams[i];
            const placement = i + 1;
            const members = teamMembers.get(teamKey)!;
            const teamRating = teamRatings.get(teamKey)!;

            let delta = EloManager.calculatePlacementDelta(teamRating, fieldAvg, placement, totalPlaced);
            if (multiplier > 1 && delta > 0) {
                delta = Math.round(delta * multiplier);
            }
            const isWin = placement <= Math.ceil(totalPlaced / 2);

            const memberTags: string[] = [];
            for (const member of members) {
                const currentElo = await EloManager.getElo(member.userId, match.game, match.mode);
                await EloManager.updateElo(member.userId, match.game, match.mode, currentElo + delta, isWin);
                await getManagers().challenge.updateProgress(member.userId, placement === 1, { game: match.game, coinMultiplier: multiplier });
                memberTags.push(`<@${member.userId}>`);
            }

            await prisma.matchPlayer.updateMany({
                where: { matchId, team: teamKey },
                data: { placement },
            });

            const medal = placement === 1 ? '🥇' : placement === 2 ? '🥈' : placement === 3 ? '🥉' : `#${placement}`;
            resultLines.push(`${medal} **Team ${teamKey.replace('team', '')}** — ${memberTags.join(' & ')}: ${delta > 0 ? '+' : ''}${delta}${multiplier > 1 && delta > 0 ? ' 🔥' : ''}`);
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
            .setDescription(`**Match ID:** ${matchId}\n**Ranking 1→${totalPlaced}**` +
                (multiplier > 1 ? `\n🔥 **RUSH HOUR ×${multiplier}** (gains boosted)` : ''))
            .addFields({ name: 'Results', value: resultLines.join('\n') || 'No changes' })
            .setTimestamp();

        await this.publishResult(guild, match.game, match.mode, embed);
        await logAdmin(guild, match.game, '📝 Match reported (placement)',
            `Match **#${matchId}** (${match.game} ${match.mode}) — ranking: ${rankedTeams.map(t => t.replace('team', 'T')).join(' > ')}${reporterId ? `, validated by <@${reporterId}>` : ''}.`);

        const { lobbyManager } = await import('./LobbyManager');
        await lobbyManager.cleanupMatch(matchId, guild).catch(err => logger.error(`[report] cleanup #${matchId}:`, err));

        await getManagers().webhook.sendMatchData(matchId);
        await getManagers().leaderboard.updateLeaderboard(match.game, match.mode);

        return { success: true, embed };
    }

    /** Posts the result embed to the game's #match-history channel. */
    private async publishResult(guild: Guild, game: string, mode: string, embed: EmbedBuilder) {
        try {
            const config = await prisma.gameConfig.findFirst({
                where: { guildId: guild.id, game, mode, historyChannelId: { not: null } },
            }) ?? await prisma.gameConfig.findFirst({
                where: { guildId: guild.id, game, historyChannelId: { not: null } },
            });
            if (!config?.historyChannelId) return;
            const channel = guild.channels.cache.get(config.historyChannelId) as TextChannel | undefined;
            if (channel?.isTextBased()) {
                await channel.send({ embeds: [embed] });
            }
        } catch (err) {
            logger.error('[report] Failed to publish to match-history:', err);
        }
    }
}
