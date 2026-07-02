import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Interaction,
    TextChannel,
    User,
    ComponentType
} from 'discord.js';
import { QueuePlayer } from './QueueManager';
import { COLORS, BOT_ICON } from '../utils/constants';
import { voteManager } from './VoteManager';
import { queueManager } from './QueueManager';
import { getGuildLanguage, t } from '../utils/i18n';

interface ReadyCheckState {
    game: string;
    players: Map<string, { user: User; status: 'waiting' | 'accepted' | 'declined' }>;
    channelId: string;
    messageId?: string;
    endTime: number;
    timer?: NodeJS.Timeout;
}

export class ReadyCheckManager {
    private checks: Map<string, ReadyCheckState> = new Map(); // Key: game

    async startReadyCheck(game: string, players: QueuePlayer[], channel: TextChannel) {
        // Clear any existing check for this game
        if (this.checks.has(game)) {
            clearTimeout(this.checks.get(game)!.timer);
            this.checks.delete(game);
        }

        const endTime = Date.now() + 60000; // 60 seconds
        const playerMap = new Map();
        players.forEach(p => {
            playerMap.set(p.user.id, { user: p.user, status: 'waiting' });
            // Mark player as BUSY in QueueManager (TODO: Implement in QueueManager)
            queueManager.setPlayerState(p.user.id, 'READY_CHECK');
        });

        const state: ReadyCheckState = {
            game,
            players: playerMap,
            channelId: channel.id,
            endTime
        };

        this.checks.set(game, state);
        await this.sendReadyEmbed(state, channel);

        // Start Timer
        state.timer = setTimeout(() => this.endReadyCheck(game, false), 60000);
    }

    async sendReadyEmbed(state: ReadyCheckState, channel: TextChannel) {
        const lang = await getGuildLanguage(channel.guild.id);
        const accepted = Array.from(state.players.values()).filter(p => p.status === 'accepted').length;
        const total = state.players.size;

        const playerList = Array.from(state.players.values()).map(p => {
            const icon = p.status === 'accepted' ? '✅' : p.status === 'declined' ? '❌' : '⬜';
            return `${icon} <@${p.user.id}>`;
        }).join('\n');

        const embed = new EmbedBuilder()
            .setTitle(t('ready_check_title', lang))
            .setDescription(`${t('ready_check_desc', lang)}\n\n**${t('ready_check_time', lang)}** <t:${Math.round(state.endTime / 1000)}:R>\n\n${playerList}`)
            .setColor(COLORS.WARNING as any)
            .setThumbnail(BOT_ICON)
            .setFooter({ text: `${accepted}/${total} ${t('ready_check_accepted', lang)}` });

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder().setCustomId(`ready_accept_${state.game}`).setLabel(t('ready_check_accept_btn', lang)).setStyle(ButtonStyle.Success).setEmoji('✅'),
                new ButtonBuilder().setCustomId(`ready_decline_${state.game}`).setLabel(t('ready_check_decline_btn', lang)).setStyle(ButtonStyle.Danger).setEmoji('❌')
            );

        if (state.messageId) {
            const msg = await channel.messages.fetch(state.messageId).catch(() => null);
            if (msg) await msg.edit({ embeds: [embed], components: [row] });
        } else {
            const msg = await channel.send({ content: `<@&${queueManager.getConfig(state.game)?.channelId}> Match Found!`, embeds: [embed], components: [row] });
            state.messageId = msg.id;
        }
    }

    async handleInteraction(interaction: Interaction) {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('ready_')) return;

        const parts = interaction.customId.split('_');
        const action = parts[1]; // accept or decline
        const game = parts[2];

        const state = this.checks.get(game);
        if (!state) {
            await interaction.reply({ content: '❌ No active ready check for this game.', ephemeral: true });
            return;
        }

        const playerState = state.players.get(interaction.user.id);
        if (!playerState) {
            await interaction.reply({ content: '❌ You are not in this match.', ephemeral: true });
            return;
        }

        if (action === 'accept') {
            playerState.status = 'accepted';
            await interaction.deferUpdate();
        } else {
            playerState.status = 'declined';
            await interaction.update({ content: '❌ You declined the match.', components: [] });
            this.endReadyCheck(game, true); // End immediately if someone declines
            return;
        }

        // Check if all accepted
        const allAccepted = Array.from(state.players.values()).every(p => p.status === 'accepted');
        if (allAccepted) {
            this.endReadyCheck(game, true);
        } else {
            const channel = interaction.channel as TextChannel;
            await this.sendReadyEmbed(state, channel);
        }
    }

    async endReadyCheck(game: string, success: boolean) {
        const state = this.checks.get(game);
        if (!state) return;

        clearTimeout(state.timer);
        this.checks.delete(game);

        const channel = queueManager.getConfig(game) ? (await (await import('../index')).client.channels.fetch(state.channelId)) as TextChannel : null;
        if (!channel) return;

        if (success) {
            // All accepted
            const allAccepted = Array.from(state.players.values()).every(p => p.status === 'accepted');
            // Double check logic: if called with success=true from decline, it means we are ending it but NOT starting match
            // Wait, my logic above call endReadyCheck(game, true) on decline. That's confusing.
            // Let's rely on checking the statuses.
        }

        const declinedPlayers = Array.from(state.players.values()).filter(p => p.status === 'declined' || p.status === 'waiting');
        const acceptedPlayers = Array.from(state.players.values()).filter(p => p.status === 'accepted');
        const lang = await getGuildLanguage(channel.guild.id);

        if (declinedPlayers.length > 0) {
            // Match Cancelled
            await channel.send({ content: t('ready_check_cancelled', lang, { count: declinedPlayers.length }) });

            // Kick declined players
            declinedPlayers.forEach(p => {
                queueManager.removePlayer(game, p.user.id);
                queueManager.setPlayerState(p.user.id, 'IDLE');
                // TODO: Add penalty
            });

            // Return accepted players to queue (they are already there, just update state)
            acceptedPlayers.forEach(p => {
                queueManager.setPlayerState(p.user.id, 'IN_QUEUE');
            });

            // Update Queue Embed
            // We need to trigger a queue update
            // queueManager.emit('queueUpdate', game); // This might be needed if we want to refresh the embed
        } else {
            // Match Start
            await channel.send({ content: t('ready_check_success', lang) });

            // Convert to QueuePlayer[]
            const players: QueuePlayer[] = [];
            // We need to get the original QueuePlayer objects or reconstruct them.
            // Ideally we kept them. But we only have User objects here.
            // We can fetch them from QueueManager since they are still in queue?
            // Yes, they are still in queue until we remove them or match starts.
            const queue = queueManager.getQueue(game);
            const matchPlayers = queue.filter(p => state.players.has(p.user.id));

            // Mark as IN_GAME (or VOTING)
            matchPlayers.forEach(p => queueManager.setPlayerState(p.user.id, 'IN_GAME')); // Or 'VOTING'

            // Trigger Vote
            await voteManager.startVote(game, matchPlayers, channel);
        }
    }
}

export const readyCheckManager = new ReadyCheckManager();
