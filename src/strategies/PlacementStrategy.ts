import { EmbedBuilder, Interaction, TextChannel } from 'discord.js';
import { GameStrategy } from './GameStrategy';
import { LobbyState } from '../managers/LobbyManager';
import { COLORS, BOT_ICON, getModeConfig } from '../utils/constants';

/**
 * Generic lobby presenter for placement matches (Arena 6×3, TFT Solo/Double Up).
 * Teams are assigned by the Matchmaker before onLobbyReady; the result is
 * reported as a ranking 1→N via /reportplacement.
 */
export class PlacementStrategy implements GameStrategy {
    async onLobbyReady(state: LobbyState, channel: TextChannel): Promise<void> {
        const modeCfg = getModeConfig(state.game, state.queueMode);
        const teams = state.teams ?? [];
        const isFfa = (modeCfg?.teamSize ?? 1) === 1;

        const embed = new EmbedBuilder()
            .setTitle(`🏟️ ${modeCfg?.name ?? state.game} — Match #${state.matchId}`)
            .setDescription(
                `**Format:** ${teams.length} ${isFfa ? 'players (FFA)' : `teams of ${modeCfg?.teamSize}`}\n` +
                `**Result:** ranking 1→${teams.length}\n\n` +
                `Report with \`/reportplacement match_id:${state.matchId} ranking:<order>\`\n` +
                `Example: \`ranking:3,1,4,2\` → Team 3 finished 1st, Team 1 2nd, ...\n` +
                `A partial ranking (top teams only) is accepted.`
            )
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setThumbnail(BOT_ICON)
            .setTimestamp();

        teams.forEach((team, i) => {
            embed.addFields({
                name: isFfa ? `♟️ Team ${i + 1}` : `🛡️ Team ${i + 1}`,
                value: team.map(u => `<@${u.id}>`).join(' & ') || '—',
                inline: true,
            });
        });

        await channel.send({ embeds: [embed] });
        await channel.send({ content: '**gl hf!**' });
    }

    async handleInteraction(interaction: Interaction, lobby: LobbyState): Promise<void> {
        // No strategy-specific interactions yet (button report arrives in Lot 4).
    }
}
