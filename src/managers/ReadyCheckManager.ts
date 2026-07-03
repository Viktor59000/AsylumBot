import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Interaction,
    TextChannel,
    User
} from 'discord.js';
import { QueuePlayer } from './QueueManager';
import { COLORS, BOT_ICON } from '../utils/constants';
import { voteManager } from './VoteManager';
import { queueManager } from './QueueManager';
import { getGuildLanguage, t } from '../utils/i18n';

interface ReadyCheckState {
    sessionId: string;
    game: string;
    mode: string;
    players: Map<string, { user: User; status: 'waiting' | 'accepted' | 'declined' }>;
    channelId: string;
    messageId?: string;
    endTime: number;
    timer?: NodeJS.Timeout;
}

// Monotonic in-process counter: sessions are memory-only, stale buttons after a
// restart simply resolve to "no active ready check".
let sessionSeq = 1;

/**
 * Ready checks are indexed by SESSION id (not by game): with multi-mode,
 * several pops of the same game can run concurrently without collision.
 */
export class ReadyCheckManager {
    private checks: Map<string, ReadyCheckState> = new Map(); // Key: sessionId

    async startReadyCheck(game: string, mode: string, players: QueuePlayer[], channel: TextChannel) {
        const sessionId = `s${sessionSeq++}`;

        const endTime = Date.now() + 60000; // 60 seconds
        const playerMap = new Map();
        for (const p of players) {
            playerMap.set(p.user.id, { user: p.user, status: 'waiting' });
            await queueManager.setPlayerState(p.user.id, 'READY_CHECK');
        }

        const state: ReadyCheckState = {
            sessionId,
            game,
            mode,
            players: playerMap,
            channelId: channel.id,
            endTime
        };

        this.checks.set(sessionId, state);
        await this.sendReadyEmbed(state, channel);

        // Start Timer
        state.timer = setTimeout(() => this.endReadyCheck(sessionId, false), 60000);
    }

    async sendReadyEmbed(state: ReadyCheckState, channel: TextChannel) {
        const lang = await getGuildLanguage(channel.guild.id);
        const accepted = Array.from(state.players.values()).filter(p => p.status === 'accepted').length;
        const total = state.players.size;

        const playerList = Array.from(state.players.values()).map(p => {
            const icon = p.status === 'accepted' ? '✅' : p.status === 'declined' ? '❌' : '⬜';
            return `${icon} <@${p.user.id}>`;
        }).join('\n');

        const queueName = queueManager.getConfig(state.game, state.mode)?.name ?? state.game;

        const embed = new EmbedBuilder()
            .setTitle(t('ready_check_title', lang))
            .setDescription(`**${queueName}**\n${t('ready_check_desc', lang)}\n\n**${t('ready_check_time', lang)}** <t:${Math.round(state.endTime / 1000)}:R>\n\n${playerList}`)
            .setColor(COLORS.WARNING as any)
            .setThumbnail(BOT_ICON)
            .setFooter({ text: `${accepted}/${total} ${t('ready_check_accepted', lang)}` });

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder().setCustomId(`ready_accept_${state.sessionId}`).setLabel(t('ready_check_accept_btn', lang)).setStyle(ButtonStyle.Success).setEmoji('✅'),
                new ButtonBuilder().setCustomId(`ready_decline_${state.sessionId}`).setLabel(t('ready_check_decline_btn', lang)).setStyle(ButtonStyle.Danger).setEmoji('❌')
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
        const sessionId = parts[2];

        const state = this.checks.get(sessionId);
        if (!state) {
            await interaction.reply({ content: '❌ This ready check is no longer active.', ephemeral: true });
            return;
        }

        const playerState = state.players.get(interaction.user.id);
        if (!playerState) {
            await interaction.reply({ content: '❌ You are not in this match.', ephemeral: true });
            return;
        }

        if (action === 'accept') {
            // Voice gate (DESIGN §6.5, opt-in per game/mode): you must be in a
            // voice channel of the server to accept — kills click-and-vanish AFKs.
            if (queueManager.getConfig(state.game, state.mode)?.voiceGate) {
                const member = interaction.guild?.members.cache.get(interaction.user.id)
                    ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
                if (!member?.voice?.channelId) {
                    await interaction.reply({
                        content: '🔊 **Voice check:** connect to a voice channel (e.g. the Waiting Room) to accept the match.',
                        ephemeral: true
                    });
                    return;
                }
            }

            playerState.status = 'accepted';
            await interaction.deferUpdate();
        } else {
            playerState.status = 'declined';
            await interaction.update({ content: '❌ You declined the match.', components: [] });
            await this.endReadyCheck(sessionId, true); // End immediately if someone declines
            return;
        }

        // Check if all accepted
        const allAccepted = Array.from(state.players.values()).every(p => p.status === 'accepted');
        if (allAccepted) {
            await this.endReadyCheck(sessionId, true);
        } else {
            const channel = interaction.channel as TextChannel;
            await this.sendReadyEmbed(state, channel);
        }
    }

    async endReadyCheck(sessionId: string, success: boolean) {
        const state = this.checks.get(sessionId);
        if (!state) return;

        clearTimeout(state.timer);
        this.checks.delete(sessionId);

        const { game, mode } = state;
        const channel = (await (await import('../index')).client.channels.fetch(state.channelId).catch(() => null)) as TextChannel | null;
        if (!channel) return;

        const declinedPlayers = Array.from(state.players.values()).filter(p => p.status === 'declined' || p.status === 'waiting');
        const acceptedPlayers = Array.from(state.players.values()).filter(p => p.status === 'accepted');
        const lang = await getGuildLanguage(channel.guild.id);

        if (declinedPlayers.length > 0) {
            // Match Cancelled
            await channel.send({ content: t('ready_check_cancelled', lang, { count: declinedPlayers.length }) });

            // Kick declined/AFK players + escalating no-show penalty (P2-4)
            const { getManagers } = await import('./registry');
            const { logAdmin } = await import('../utils/adminLog');
            const queueName = queueManager.getConfig(game, mode)?.name ?? game;
            for (const p of declinedPlayers) {
                await queueManager.removePlayer(game, mode, p.user.id);
                const minutes = await getManagers().penalty
                    .applyNoShowPenalty(p.user.id, `ready-check ${queueName}`)
                    .catch(() => 0);
                if (minutes > 0) {
                    await logAdmin(channel.guild, game, '⏱️ No-show penalty',
                        `<@${p.user.id}> — ready-check **${queueName}** declined/expired → queue-ban **${minutes} min**.`);
                }
            }

            // Return accepted players to queue (they are already there, just update state)
            for (const p of acceptedPlayers) {
                await queueManager.setPlayerState(p.user.id, 'QUEUED');
            }
        } else {
            // Match Start
            await channel.send({ content: t('ready_check_success', lang) });

            // Players are still in the queue at this point: recover the original QueuePlayer objects
            const queue = queueManager.getQueue(game, mode);
            const matchPlayers = queue.filter(p => state.players.has(p.user.id));

            for (const p of matchPlayers) {
                await queueManager.setPlayerState(p.user.id, 'IN_GAME');
            }

            // Placement modes (Arena, TFT) have no team-formation vote:
            // teams/entrants are assigned directly and ranked 1→N at report time.
            const { getModeConfig } = await import('../utils/constants');
            if (getModeConfig(game, mode)?.matchType === 'placement') {
                const { getManagers } = await import('./registry');
                await getManagers().matchmaker.createMatch(game, mode, matchPlayers, 'Ranked');
                return;
            }

            // Trigger Vote (same session id carries through the pipeline)
            await voteManager.startVote(sessionId, game, mode, matchPlayers, channel);
        }
    }
}

export const readyCheckManager = new ReadyCheckManager();
