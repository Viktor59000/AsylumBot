import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, TextChannel } from 'discord.js';
import { GameStrategy } from './GameStrategy';
import { LobbyState } from '../managers/LobbyManager';
import { COLORS } from '../utils/constants';

export class ArenaStrategy implements GameStrategy {
    async onLobbyReady(state: LobbyState, channel: TextChannel): Promise<void> {
        // Arena is specific: 8 Teams of 2.
        // We assume players have been distributed into teams by Matchmaker.
        // Wait, Matchmaker typically balances into team1 vs team2 due to binary nature of other games.
        // For Arena, we need custom logic in Matchmaker to distribute 16 players into 8 teams.
        // Or we handle it here if Matchmaker just passes 16 players in `state.players`.
        // BUT `LobbyState` currently has hardcoded `team1` and `team2`.
        // We might need to use `team1` as "All Players" or depend on `state.players` and distribute them locally?
        // Let's assume Matchmaker logic will need an update to handle `arena` balancing.
        // For now, let's look at `state.players` (QueuePlayer[]).

        // Distribution Logic (Simple Random if not pre-grouped):
        // Ideally Matchmaker should have done this.
        // Since we are in Strategy, we are "Post-Lobby Creation". 
        // We need to move players to their respective voice channels.

        // We have `state.voiceChannelId1`, `voiceChannelId2`, and `state.extraVoiceChannelIds` (6 more).
        // Total 8 channels.

        const allVoiceIds = [state.voiceChannelId1, state.voiceChannelId2, ...(state.extraVoiceChannelIds || [])];
        const players = state.players;

        // If we have 16 players, we pair them 2 by 2.
        // For V1, let's just create the Embed and Move them sequentially.

        const embed = new EmbedBuilder()
            .setTitle(`🏟️ Arena Match #${state.matchId} Ready!`)
            .setDescription('**Format:** 2v2v2v2v2v2v2v2\nTeams have been assigned and voice channels created.')
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setTimestamp();

        // Assign players to teams (Naive approach for now, just split the list)
        // Group 1 -> Team 1, Group 2 -> Team 2...
        // Assuming players are shuffled.

        for (let i = 0; i < 8; i++) {
            const p1 = players[i * 2];
            const p2 = players[i * 2 + 1];

            if (!p1) break; // Should implement better safety

            const teamVoiceId = allVoiceIds[i];
            const teamName = `Team ${i + 1}`;

            let teamValue = `<@${p1.user.id}>`;
            if (p2) teamValue += ` & <@${p2.user.id}>`;

            embed.addFields({ name: `🛡️ ${teamName}`, value: teamValue, inline: true });

            // Move Players & Update Permissions
            // This grants them access to their specific team channel
            if (teamVoiceId) {
                const voiceChannel = await channel.guild.channels.fetch(teamVoiceId);
                if (voiceChannel && voiceChannel.isVoiceBased()) {
                    const teamMembers = [p1, p2].filter(x => x);
                    for (const member of teamMembers) {
                        if (!member) continue;
                        // Permission Update
                        await voiceChannel.permissionOverwrites.edit(member.user.id, {
                            Connect: true,
                            Speak: true,
                            ViewChannel: true
                        });

                        // Move if in voice
                        const guildMember = await channel.guild.members.fetch(member.user.id).catch(() => null);
                        if (guildMember?.voice.channel) {
                            await guildMember.voice.setChannel(voiceChannel);
                        }
                    }
                }
            }
        }

        await channel.send({ content: `<@&${process.env.PLAYER_ROLE_ID || ''}> Match Ready!`, embeds: [embed] });
        await channel.send({ content: `**gl hf!**` });
    }

    async handleInteraction(interaction: any): Promise<void> {
        // Handle Arena specific buttons if any (e.g. Reporting results is complex for 8 teams)
        // For now, no interaction.
    }
}
