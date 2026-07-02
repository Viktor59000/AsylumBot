import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Interaction,
    TextChannel,
    User,
    Message,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ComponentType
} from 'discord.js';
import { LobbyState } from './LobbyManager';
import { COLORS, MAP_POOLS, BOT_ICON } from '../utils/constants';
import { prisma } from '../utils/db';

interface VetoState {
    lobby: LobbyState;
    remainingMaps: string[];
    bannedMaps: { map: string; bannedBy: 'Team 1' | 'Team 2' }[];
    turn: 'Team 1' | 'Team 2';
    messageId?: string;
}

export class VetoManager {
    private vetos: Map<string, VetoState> = new Map(); // Key: channelId

    constructor() { }

    async startVeto(lobby: LobbyState, channel: TextChannel) {
        const maps = MAP_POOLS[lobby.game as keyof typeof MAP_POOLS];
        if (!maps || maps.length === 0) return;

        const state: VetoState = {
            lobby,
            remainingMaps: [...maps],
            bannedMaps: [],
            turn: 'Team 1' // Team 1 starts banning
        };

        this.vetos.set(lobby.textChannelId, state);

        await this.sendVetoEmbed(state, channel);
    }

    async sendVetoEmbed(state: VetoState, channel: TextChannel) {
        const captain1 = state.lobby.team1[0]; // Assuming first player is captain/leader
        const captain2 = state.lobby.team2[0];

        const currentCaptain = state.turn === 'Team 1' ? captain1 : captain2;

        const embed = new EmbedBuilder()
            .setTitle(`🗺️ Map Veto - ${state.lobby.game.toUpperCase()}`)
            .setDescription(`**Turn:** ${state.turn} (<@${currentCaptain.id}>)\nSelect a map to **BAN** it. The last remaining map will be played.`)
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setThumbnail(BOT_ICON)
            .addFields(
                { name: '🚫 Banned Maps', value: state.bannedMaps.map(b => `~~${b.map}~~ (${b.bannedBy})`).join('\n') || 'None', inline: false },
                { name: '✅ Remaining Maps', value: state.remainingMaps.join(', '), inline: false }
            );

        // Create Select Menu for Remaining Maps
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('veto_ban')
            .setPlaceholder('Select a map to BAN')
            .addOptions(
                state.remainingMaps.map(map =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(map)
                        .setValue(map)
                        .setDescription(`Ban ${map}`)
                        .setEmoji('🚫')
                )
            );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        if (state.messageId) {
            const msg = await channel.messages.fetch(state.messageId).catch(() => null);
            if (msg) await msg.edit({ embeds: [embed], components: [row] });
        } else {
            const msg = await channel.send({ content: `🔔 **Map Veto Started!** <@${captain1.id}> vs <@${captain2.id}>`, embeds: [embed], components: [row] });
            state.messageId = msg.id;
        }
    }

    async handleInteraction(interaction: Interaction) {
        if (!interaction.isStringSelectMenu()) return;
        if (interaction.customId !== 'veto_ban') return;

        const state = this.vetos.get(interaction.channelId!);
        if (!state) {
            await interaction.reply({ content: '❌ No active veto in this channel.', ephemeral: true });
            return;
        }

        const mapName = interaction.values[0];

        // Check Turn
        const captain1 = state.lobby.team1[0];
        const captain2 = state.lobby.team2[0];
        const currentCaptain = state.turn === 'Team 1' ? captain1 : captain2;

        if (interaction.user.id !== currentCaptain.id) {
            await interaction.reply({ content: '❌ It is not your turn to ban!', ephemeral: true });
            return;
        }

        // Process Ban
        const mapIndex = state.remainingMaps.indexOf(mapName);
        if (mapIndex === -1) {
            await interaction.reply({ content: '❌ Map already banned or invalid.', ephemeral: true });
            return;
        }

        state.remainingMaps.splice(mapIndex, 1);
        state.bannedMaps.push({ map: mapName, bannedBy: state.turn });

        // Check Win Condition
        if (state.remainingMaps.length === 1) {
            // Veto Complete
            const pickedMap = state.remainingMaps[0];
            this.vetos.delete(interaction.channelId!);

            await interaction.update({ content: `✅ **Map Selected: ${pickedMap}**`, components: [] });

            const channel = interaction.channel as TextChannel;
            await channel.send({ content: `🗺️ **Map Decided:** The match will be played on **${pickedMap}**!` });

            // Update Match in DB
            await prisma.match.update({
                where: { id: state.lobby.matchId },
                data: { map: pickedMap }
            });

            return;
        }

        // Switch Turn
        state.turn = state.turn === 'Team 1' ? 'Team 2' : 'Team 1';

        await interaction.deferUpdate();
        const channel = interaction.channel as TextChannel;
        await this.sendVetoEmbed(state, channel);
    }
}

export const vetoManager = new VetoManager();
