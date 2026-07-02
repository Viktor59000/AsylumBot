import { EmbedBuilder, Message, TextChannel, User, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, Interaction } from 'discord.js';
import { QueuePlayer } from './QueueManager';
import { COLORS, BOT_ICON } from '../utils/constants';
import { LobbyState } from './LobbyManager';
import { Matchmaker } from './Matchmaker';

interface DraftSession {
    lobby: LobbyState;
    captain1: User;
    captain2: User;
    availablePlayers: QueuePlayer[];
    turn: 1 | 2;
    pickOrder: number[];
    currentPickIndex: number;
    messageId?: string;
}

export class DraftManager {
    private sessions: Map<string, DraftSession> = new Map(); // Key: channelId
    private matchmaker?: Matchmaker;

    constructor() { }

    setMatchmaker(matchmaker: Matchmaker) {
        this.matchmaker = matchmaker;
    }

    async startDraft(lobby: LobbyState) {
        // 1. Select Captains (First 2 players for now)
        const captain1 = lobby.players[0];
        const captain2 = lobby.players[1];
        const pool = lobby.players.slice(2);

        const pickOrder: number[] = [];
        let current = 1;
        for (let i = 0; i < pool.length; i++) {
            pickOrder.push(current);
            if (i % 2 === 0) current = current === 1 ? 2 : 1;
        }

        const session: DraftSession = {
            lobby,
            captain1: captain1.user,
            captain2: captain2.user,
            availablePlayers: pool,
            turn: 1,
            pickOrder,
            currentPickIndex: 0
        };

        // Initialize Teams in Lobby
        lobby.team1 = [captain1.user];
        lobby.team2 = [captain2.user];

        this.sessions.set(lobby.textChannelId, session);

        const channel = await this.getChannel(lobby.textChannelId);

        // Nothing to draft (e.g. 1v1: both players are captains) → finalize immediately
        if (pool.length === 0) {
            this.sessions.delete(lobby.textChannelId);
            if (channel) {
                await this.updateDraftEmbed(session, channel, true);
                await channel.send({ content: '✅ **Teams are set!** (no players to draft)' });
            }
            if (this.matchmaker) {
                await this.matchmaker.finalizeMatch(lobby);
            }
            return;
        }

        if (channel) {
            await this.updateDraftEmbed(session, channel);
            await channel.send({ content: `👑 **Draft Started!**\n🔵 Captain 1: <@${captain1.user.id}>\n🔴 Captain 2: <@${captain2.user.id}>\n\nSelect a player from the menu below.` });
        }
    }

    async handleInteraction(interaction: Interaction) {
        if (!interaction.isStringSelectMenu()) return;
        if (interaction.customId !== 'draft_pick') return;

        const session = this.sessions.get(interaction.channelId!);
        if (!session) {
            await interaction.reply({ content: '❌ No active draft in this channel.', ephemeral: true });
            return;
        }

        // Check Turn
        const currentCaptain = session.turn === 1 ? session.captain1 : session.captain2;
        if (interaction.user.id !== currentCaptain.id) {
            await interaction.reply({ content: `❌ It is <@${currentCaptain.id}>'s turn.`, ephemeral: true });
            return;
        }

        const pickedUserId = interaction.values[0];
        const pickedIndex = session.availablePlayers.findIndex(p => p.user.id === pickedUserId);

        if (pickedIndex === -1) {
            await interaction.reply({ content: '❌ Player not available.', ephemeral: true });
            return;
        }

        const pickedPlayer = session.availablePlayers[pickedIndex];

        // Move Player
        if (session.turn === 1) {
            session.lobby.team1.push(pickedPlayer.user);
        } else {
            session.lobby.team2.push(pickedPlayer.user);
        }

        // Remove from Pool
        session.availablePlayers.splice(pickedIndex, 1);

        // Advance Turn
        session.currentPickIndex++;

        await interaction.deferUpdate(); // Acknowledge

        if (session.currentPickIndex < session.pickOrder.length) {
            session.turn = session.pickOrder[session.currentPickIndex] as 1 | 2;
            const nextCaptain = session.turn === 1 ? session.captain1 : session.captain2;

            const channel = interaction.channel as TextChannel;
            await this.updateDraftEmbed(session, channel);
            await channel.send({ content: `✅ **${pickedPlayer.user.username}** picked!\n👉 <@${nextCaptain.id}>'s turn.` });
        } else {
            // Draft Complete
            this.sessions.delete(interaction.channelId!);
            const channel = interaction.channel as TextChannel;

            // Update embed one last time to show final teams and remove components
            await this.updateDraftEmbed(session, channel, true);

            await channel.send({ content: '✅ **Draft Complete!** Teams are set.' });

            // Finalize Match via Matchmaker
            if (this.matchmaker) {
                await this.matchmaker.finalizeMatch(session.lobby);
            }
        }
    }

    async updateDraftEmbed(session: DraftSession, channel: TextChannel, finished: boolean = false) {
        const embed = new EmbedBuilder()
            .setTitle(`👑 Captains Draft - ${session.lobby.game.toUpperCase()}`)
            .setDescription(`**Captain 1:** <@${session.captain1.id}>\n**Captain 2:** <@${session.captain2.id}>`)
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setThumbnail(BOT_ICON)
            .addFields(
                { name: '🔵 Team Blue', value: session.lobby.team1.map(u => u.username).join('\n') || 'Empty', inline: true },
                { name: '🔴 Team Red', value: session.lobby.team2.map(u => u.username).join('\n') || 'Empty', inline: true },
                { name: '📋 Available Pool', value: session.availablePlayers.map(p => `<@${p.user.id}>`).join(', ') || 'None', inline: false }
            )
            .setFooter({ text: finished ? 'Draft Complete' : `Turn: Captain ${session.turn}` });

        const components: any[] = [];

        if (!finished && session.availablePlayers.length > 0) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('draft_pick')
                .setPlaceholder('Select a player to pick')
                .addOptions(
                    session.availablePlayers.map(p =>
                        new StringSelectMenuOptionBuilder()
                            .setLabel(p.user.username)
                            .setValue(p.user.id)
                            .setDescription(`Pick ${p.user.username}`)
                    )
                );

            const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
            components.push(row);
        }

        if (session.messageId) {
            const msg = await channel.messages.fetch(session.messageId).catch(() => null);
            if (msg) await msg.edit({ embeds: [embed], components });
        } else {
            const msg = await channel.send({ embeds: [embed], components });
            session.messageId = msg.id;
        }
    }

    private async getChannel(channelId: string) {
        if (this.matchmaker) {
            return (this.matchmaker as any).client.channels.cache.get(channelId) as TextChannel;
        }
        return null;
    }
}

export const draftManager = new DraftManager();
