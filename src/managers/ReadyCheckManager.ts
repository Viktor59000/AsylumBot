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
        for (const p of players) {
            playerMap.set(p.user.id, { user: p.user, status: 'waiting' });
            await queueManager.setPlayerState(p.user.id, 'READY_CHECK');
        }

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
            const mentions = Array.from(state.players.keys()).map(id => `<@${id}>`).join(' ');
            const msg = await channel.send({ content: `🔔 **Match Found!** ${mentions}`, embeds: [embed], components: [row] });
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
            await this.endReadyCheck(game, true); // End immediately if someone declines
            return;
        }

        // Check if all accepted
        const allAccepted = Array.from(state.players.values()).every(p => p.status === 'accepted');
        if (allAccepted) {
            await this.endReadyCheck(game, true);
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

        const declinedPlayers = Array.from(state.players.values()).filter(p => p.status === 'declined' || p.status === 'waiting');
        const acceptedPlayers = Array.from(state.players.values()).filter(p => p.status === 'accepted');
        const lang = await getGuildLanguage(channel.guild.id);

        if (declinedPlayers.length > 0) {
            // Match Cancelled
            await channel.send({ content: t('ready_check_cancelled', lang, { count: declinedPlayers.length }) });

            // Kick declined players (removePlayer resets their status to IDLE and refreshes the queue embed)
            for (const p of declinedPlayers) {
                await queueManager.removePlayer(game, p.user.id);
                // TODO: Add penalty (P2-4)
            }

            // Return accepted players to queue (they are already there, just update state)
            for (const p of acceptedPlayers) {
                await queueManager.setPlayerState(p.user.id, 'QUEUED');
            }
        } else {
            // Match Start
            await channel.send({ content: t('ready_check_success', lang) });

            // Players are still in the queue at this point: recover the original QueuePlayer objects
            const queue = queueManager.getQueue(game);
            const matchPlayers = queue.filter(p => state.players.has(p.user.id));

            for (const p of matchPlayers) {
                await queueManager.setPlayerState(p.user.id, 'IN_GAME');
            }

            // Trigger Vote
            await voteManager.startVote(game, matchPlayers, channel);
        }
    }
}

export const readyCheckManager = new ReadyCheckManager();
