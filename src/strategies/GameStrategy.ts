import { ActionRowBuilder, AttachmentBuilder, EmbedBuilder, Interaction, TextChannel } from 'discord.js';
import { LobbyState } from '../managers/LobbyManager';

export interface GameStrategy {
    /**
     * Called when the lobby channels are fully created.
     * Use this to send the welcome message, pin it, or start specific flows (Draft, Veto).
     */
    onLobbyReady(lobby: LobbyState, channel: TextChannel): Promise<void>;

    /**
     * Handles interactions specific to this game strategy (buttons, selects).
     */
    handleInteraction(interaction: Interaction, lobby: LobbyState): Promise<void>;
}
