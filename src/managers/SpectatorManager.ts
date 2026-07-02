import {
    ButtonInteraction,
    StringSelectMenuInteraction,
    GuildMember,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    VoiceChannel,
    ComponentType,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { lobbyManager } from './LobbyManager';

export class SpectatorManager {

    async handleSpectateButton(interaction: ButtonInteraction) {
        // 1. Identify Match
        // The button is in the match channel. The channel topic or name might indicate match ID?
        // Or we can assume the button customId contains matchId? 
        // Better: customId = `spectate_${matchId}` or just `spectate` and we use channel.

        // Actually, the button is in the match LOBBY channel (text).
        // The user is likely NOT in the game (or is eliminated?).
        // If it's for external spectators, the button should be in a PUBLIC channel?
        // "Dans le salon #in-progress". User mentioned a public channel.
        // But our current flow creates private text channels. 
        // If the button is in the private channel, only players see it.
        // Logic suggests there SHOULD be a status embed in a public channel.

        // Let's assume for now the Matchmaker or Strategy posts a public embed in `#matches` or `#in-progress`.
        // I will implement the handler assuming interaction comes from there.
        // We need to fetch the lobby state using matchId from customId? `spectate_<textChannelId>`?

        const [_, channelId] = interaction.customId.split('_');
        const lobby = lobbyManager.getLobby(channelId);

        if (!lobby) {
            return interaction.reply({ content: 'Match not found or ended.', ephemeral: true });
        }

        // 2. Show Team Selection
        const options: StringSelectMenuOptionBuilder[] = [];
        // Helper to get team name
        const getTeamName = (index: number) => {
            if (lobby.game === 'arena') return `Team ${index + 1}`;
            return index === 0 ? 'Team Blue' : 'Team Red';
        };

        const voiceIds = [lobby.voiceChannelId1, lobby.voiceChannelId2, ...(lobby.extraVoiceChannelIds || [])];

        voiceIds.forEach((vid, index) => {
            options.push(
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Spectate ${getTeamName(index)}`)
                    .setValue(`spec_join_${channelId}_${vid}`)
                    .setDescription('Click to join this voice channel')
                    .setEmoji('👁️')
            );
        });

        const row = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('spectate_select')
                    .setPlaceholder('Select a team to spectate')
                    .addOptions(options)
            );

        await interaction.reply({
            content: 'Select a team to spectate. You will be granted temporary access.',
            components: [row],
            ephemeral: true
        });
    }

    async handleSpectateSelect(interaction: StringSelectMenuInteraction) {
        const [_, __, channelId, targetVoiceId] = interaction.values[0].split('_');
        const lobby = lobbyManager.getLobby(channelId);

        if (!lobby) {
            return interaction.reply({ content: 'Match ended.', ephemeral: true });
        }

        const member = interaction.member as GuildMember;
        const guild = interaction.guild;
        if (!guild || !member) return;

        // 3. Grant Permissions
        // We need to remove permissions from OTHER voice channels of this lobby first (cleanup)
        const allVoiceIds = [lobby.voiceChannelId1, lobby.voiceChannelId2, ...(lobby.extraVoiceChannelIds || [])];

        for (const vid of allVoiceIds) {
            const channel = guild.channels.cache.get(vid) as VoiceChannel;
            if (channel) {
                if (vid === targetVoiceId) {
                    await channel.permissionOverwrites.edit(member.id, {
                        ViewChannel: true,
                        Connect: true,
                        Speak: false // Spectators usually silent? 
                        // User requirement: "Grant temporary, restricted voice permissions."
                        // Implies Connect is OK. Speak depends on policy. Let's Deny Speak to prevent trolling?
                        // "Prevent Ghosting and Trolling" -> Definitely Deny Speak.
                    });
                } else {
                    // Remove overwrite if exists
                    // await channel.permissionOverwrites.delete(member.id); 
                    // Better: explicit Deny Connect? Or just delete allowing defaults to take over (which is Deny Connect for everyone)
                    if (channel.permissionOverwrites.cache.has(member.id)) {
                        await channel.permissionOverwrites.delete(member.id);
                    }
                }
            }
        }

        await interaction.reply({
            content: `✅ Access granted to <#${targetVoiceId}> (Muted). Move yourself to the channel.`,
            ephemeral: true
        });
    }

    createSpectateButton(lobbyChannelId: string) {
        return new ButtonBuilder()
            .setCustomId(`spectate_${lobbyChannelId}`)
            .setLabel('Spectate')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('👁️');
    }
}

export const spectatorManager = new SpectatorManager();
