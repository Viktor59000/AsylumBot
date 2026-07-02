import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Interaction,
    TextChannel
} from 'discord.js';
import { QueuePlayer } from './QueueManager';
import { queueManager } from './QueueManager';
import { Matchmaker } from './Matchmaker';

interface VoteState {
    sessionId: string;
    game: string;
    mode: string;
    players: QueuePlayer[];
    votes: Map<string, string>; // UserId -> Vote (Formation or Game)
    messageId?: string;
    channelId: string;
    endTime: number;
    timer?: NodeJS.Timeout;
}

/**
 * Votes are indexed by SESSION id (not by game): with multi-mode, several
 * votes of the same game can run concurrently without collision.
 */
export class VoteManager {
    private votes: Map<string, VoteState> = new Map(); // Key: sessionId
    private matchmaker?: Matchmaker;

    constructor() { }

    setMatchmaker(matchmaker: Matchmaker) {
        this.matchmaker = matchmaker;
    }

    async startVote(sessionId: string, game: string, mode: string, players: QueuePlayer[], channel: TextChannel) {
        // Cancel any stale vote for this session so its timer can't fire on the new one
        const existing = this.votes.get(sessionId);
        if (existing?.timer) clearTimeout(existing.timer);

        const endTime = Date.now() + 30000; // 30 seconds
        const state: VoteState = {
            sessionId,
            game,
            mode,
            players,
            votes: new Map(),
            channelId: channel.id,
            endTime
        };

        this.votes.set(sessionId, state);
        await this.sendVoteEmbed(state, channel);

        // Start Timer (stored so it can be cancelled)
        state.timer = setTimeout(() => this.endVote(sessionId), 30000);
    }

    async sendVoteEmbed(state: VoteState, channel: TextChannel) {
        const queueName = queueManager.getConfig(state.game, state.mode)?.name ?? state.game;

        const total = state.players.length;
        const voted = state.votes.size;

        // Progress Bars (Visual)
        const progressBar = (count: number) => {
            const percentage = total > 0 ? count / total : 0;
            const blocks = Math.round(percentage * 10);
            return '🟦'.repeat(blocks) + '⬛'.repeat(10 - blocks) + ` (${count})`;
        };

        const embed = new EmbedBuilder()
            .setFooter({ text: `${voted}/${total} players voted` });

        const row = new ActionRowBuilder<ButtonBuilder>();

        if (state.game === 'multigaming') {
            embed.setTitle(`🗳️ Vote for Game Selection`);

            // Count game votes
            const counts: Record<string, number> = { lol: 0, valorant: 0, cs2: 0, r6s: 0 };
            state.votes.forEach(v => { if (counts[v] !== undefined) counts[v]++; });

            embed.addFields(
                { name: 'League of Legends', value: progressBar(counts.lol), inline: false },
                { name: 'Valorant', value: progressBar(counts.valorant), inline: false },
                { name: 'Counter-Strike 2', value: progressBar(counts.cs2), inline: false },
                { name: 'Rainbow Six Siege', value: progressBar(counts.r6s), inline: false }
            );

            row.addComponents(
                new ButtonBuilder().setCustomId(`vote_${state.sessionId}_lol`).setLabel('LoL').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`vote_${state.sessionId}_valorant`).setLabel('Valorant').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`vote_${state.sessionId}_cs2`).setLabel('CS2').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`vote_${state.sessionId}_r6s`).setLabel('R6S').setStyle(ButtonStyle.Success)
            );
        } else {
            embed.setTitle(`🗳️ Vote for Team Formation - ${queueName}`);

            // Count formation votes
            let balanced = 0, captain = 0, random = 0;
            state.votes.forEach(v => {
                if (v === 'balanced') balanced++;
                if (v === 'captain') captain++;
                if (v === 'random') random++;
            });

            embed.addFields(
                { name: '⚖️ Balanced (Ranked)', value: progressBar(balanced), inline: false },
                { name: '👑 Captains (Draft)', value: progressBar(captain), inline: false },
                { name: '🎲 Random (Casual)', value: progressBar(random), inline: false }
            );

            row.addComponents(
                new ButtonBuilder().setCustomId(`vote_${state.sessionId}_balanced`).setLabel('Balanced').setStyle(ButtonStyle.Primary).setEmoji('⚖️'),
                new ButtonBuilder().setCustomId(`vote_${state.sessionId}_captain`).setLabel('Captains').setStyle(ButtonStyle.Secondary).setEmoji('👑'),
                new ButtonBuilder().setCustomId(`vote_${state.sessionId}_random`).setLabel('Random').setStyle(ButtonStyle.Success).setEmoji('🎲')
            );
        }

        if (state.messageId) {
            const msg = await channel.messages.fetch(state.messageId).catch(() => null);
            if (msg) await msg.edit({ embeds: [embed], components: [row] });
        } else {
            const msg = await channel.send({ content: '🔔 **Queue Full! Voting Phase Started!**', embeds: [embed], components: [row] });
            state.messageId = msg.id;
        }
    }

    async handleInteraction(interaction: Interaction) {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith('vote_')) return;

        const parts = interaction.customId.split('_');
        const sessionId = parts[1];
        const voteType = parts[2];

        const state = this.votes.get(sessionId);
        if (!state) {
            await interaction.reply({ content: '❌ This vote is no longer active.', ephemeral: true });
            return;
        }

        // Check if user is in the match
        if (!state.players.some(p => p.user.id === interaction.user.id)) {
            await interaction.reply({ content: '❌ You are not in this match.', ephemeral: true });
            return;
        }

        // Register Vote
        state.votes.set(interaction.user.id, voteType);

        await interaction.deferUpdate();
        const channel = interaction.channel as TextChannel;
        await this.sendVoteEmbed(state, channel);
    }

    async endVote(sessionId: string) {
        const state = this.votes.get(sessionId);
        if (!state) return;

        if (state.timer) clearTimeout(state.timer);
        this.votes.delete(sessionId);

        // Count votes
        let balanced = 0, captain = 0, random = 0;
        state.votes.forEach(v => {
            if (v === 'balanced') balanced++;
            if (v === 'captain') captain++;
            if (v === 'random') random++;
        });

        // Determine Winner (Priority: Balanced > Captain > Random)
        // Logic: Random only wins if it has > 50% of votes.
        // Otherwise, the winner is between Balanced and Captain (Competitive modes).

        const totalVotes = balanced + captain + random;
        let winner = 'balanced';

        if (random > totalVotes / 2) {
            winner = 'random';
        } else {
            // Competitive Block wins. Decide between Balanced and Captain.
            // Tie-breaker: Balanced > Captain
            if (captain > balanced) {
                winner = 'captain';
            } else {
                winner = 'balanced';
            }
        }

        const channel = await this.matchmaker?.['client'].channels.fetch(state.channelId) as TextChannel;
        if (!channel) return;

        await channel.send({ content: `🗳️ **Vote Finished!** Winning Mode: **${winner.toUpperCase()}**` });

        // Trigger Match Logic
        if (this.matchmaker) {
            if (state.game === 'multigaming') {
                // Determine winning game
                const counts: Record<string, number> = { lol: 0, valorant: 0, cs2: 0, r6s: 0 };
                state.votes.forEach(v => { if (counts[v] !== undefined) counts[v]++; });

                // Find max
                let winningGame = 'lol';
                let maxVotes = -1;
                Object.entries(counts).forEach(([g, count]) => {
                    if (count > maxVotes) {
                        maxVotes = count;
                        winningGame = g;
                    }
                });

                await channel.send({ content: `🗳️ **Vote Finished!** Winning Game: **${winningGame.toUpperCase()}**` });
                await this.matchmaker.createMatch(winningGame, 'soloq', state.players, 'Ranked');
            } else {
                if (winner === 'captain') {
                    await this.matchmaker.createMatch(state.game, state.mode, state.players, 'Captain');
                } else {
                    const formation = winner === 'balanced' ? 'Ranked' : 'Casual';
                    await this.matchmaker.createMatch(state.game, state.mode, state.players, formation);
                }
            }
        }
    }
}

export const voteManager = new VoteManager();
