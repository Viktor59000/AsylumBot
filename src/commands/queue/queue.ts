import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder } from 'discord.js';
import { queueManager } from '../../managers/QueueManager';
import { createQueueEmbed } from '../../utils/embeds';
import { GAME_CONFIGS, GAME_MODES, ALL_MODE_KEYS, getDefaultMode, getModeConfig } from '../../utils/constants';
import { getGuildLanguage, t } from '../../utils/i18n';

/** Resolves the mode option: defaults to the game's first mode, validates it exists. */
const resolveMode = (game: string, mode: string | null): { mode?: string; error?: string } => {
    const resolved = mode ?? getDefaultMode(game);
    if (!getModeConfig(game, resolved)) {
        const valid = Object.keys(GAME_MODES[game] ?? {}).join(', ');
        return { error: `❌ Invalid mode **${resolved}** for this game. Valid modes: ${valid}` };
    }
    return { mode: resolved };
};

export const command = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Manage the queue')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View the queue and join/leave')
                .addStringOption(option =>
                    option
                        .setName('game')
                        .setDescription('The game to queue for')
                        .setRequired(true)
                        .addChoices(
                            ...Object.entries(GAME_CONFIGS).map(([key, config]) => ({ name: config.name, value: key }))
                        )
                )
                .addStringOption(option =>
                    option
                        .setName('mode')
                        .setDescription('The queue mode (default: first mode of the game)')
                        .addChoices(...ALL_MODE_KEYS.map(m => ({ name: m, value: m })))
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('force_leave')
                .setDescription('Emergency: Force leave all queues and reset status')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('force_start')
                .setDescription('Force start a match with current players (Admin only)')
                .addStringOption(option =>
                    option
                        .setName('game')
                        .setDescription('The game to force start')
                        .setRequired(true)
                        .addChoices(
                            ...Object.entries(GAME_CONFIGS).map(([key, config]) => ({ name: config.name, value: key }))
                        )
                )
                .addStringOption(option =>
                    option
                        .setName('mode')
                        .setDescription('The queue mode (default: first mode of the game)')
                        .addChoices(...ALL_MODE_KEYS.map(m => ({ name: m, value: m })))
                )
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const subcommand = interaction.options.getSubcommand();
        const game = interaction.options.getString('game'); // Optional for force_leave

        if (subcommand === 'view') {
            if (!game) return; // Should be required by option
            const { mode, error } = resolveMode(game, interaction.options.getString('mode'));
            if (error || !mode) {
                await interaction.reply({ content: error, ephemeral: true });
                return;
            }

            const queue = queueManager.getQueue(game, mode);
            const required = queueManager.getRequiredPlayers(game, mode);

            const { embed, files } = createQueueEmbed(game, mode, queue, required);

            await interaction.reply({ embeds: [embed], components: [buildQueueButtons(game, mode)], files });
        } else if (subcommand === 'force_leave') {
            await queueManager.removePlayerFromAllQueues(interaction.user.id);
            await interaction.reply({ content: '✅ **Force Leave:** You have been removed from all queues and your status has been reset.', ephemeral: true });
        } else if (subcommand === 'force_start') {
            if (!game) return;
            // Check permissions (Admin only)
            if (!interaction.memberPermissions?.has('Administrator')) {
                await interaction.reply({ content: '❌ You need Administrator permissions to force start a match.', ephemeral: true });
                return;
            }

            const { mode, error } = resolveMode(game, interaction.options.getString('mode'));
            if (error || !mode) {
                await interaction.reply({ content: error, ephemeral: true });
                return;
            }

            const result = queueManager.forceStart(game, mode);
            if (result.success) {
                const queueName = queueManager.getConfig(game, mode)?.name ?? game;
                await interaction.reply({ content: `✅ **Force Start Initiated for ${queueName}**!`, ephemeral: false });
            } else {
                await interaction.reply({ content: `❌ Failed to force start: ${result.reason}`, ephemeral: true });
            }
        }
    },
};

/** Join/Leave/Invite buttons for one (game, mode) queue. Invite hidden for 1-player teams. */
export const buildQueueButtons = (game: string, mode: string) => {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`join_queue_${game}_${mode}`)
            .setLabel('Join Queue')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`leave_queue_${game}_${mode}`)
            .setLabel('Leave Queue')
            .setStyle(ButtonStyle.Danger),
    );
    const teamSize = getModeConfig(game, mode)?.teamSize ?? 5;
    if (teamSize >= 2) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`invite_party_${game}_${mode}`)
                .setLabel('Invite Duo/Trio')
                .setStyle(ButtonStyle.Primary),
        );
    }
    return row;
};

export const handleQueueInteraction = async (interaction: any) => {
    const customId = interaction.customId;
    const user = interaction.user;

    if (interaction.isButton()) {
        const parts = customId.split('_');
        const action = parts[0];
        const type = parts[1]; // queue or party or invite

        if (action === 'join' || action === 'leave') {
            const game = parts[2];
            const mode = parts[3] ?? getDefaultMode(game); // legacy buttons have no mode
            const lang = await getGuildLanguage(interaction.guildId);
            const queueName = queueManager.getConfig(game, mode)?.name ?? game;

            if (action === 'join') {
                const result = await queueManager.addPlayer(game, mode, user, undefined, lang);
                if (!result.success) {
                    await interaction.reply({ content: result.reason || t('error_generic', lang), ephemeral: true });
                    return;
                }
                await interaction.reply({ content: t('queue_joined', lang, { game: queueName }), ephemeral: true });
            } else {
                const success = await queueManager.removePlayer(game, mode, user.id);
                if (!success) {
                    await interaction.reply({ content: t('queue_already_in', lang), ephemeral: true });
                    return;
                }
                await interaction.reply({ content: t('queue_left', lang, { game: queueName }), ephemeral: true });
            }
            // The permanent queue embed is refreshed automatically by QueueMessageUpdater.
            return;
        } else if (action === 'invite') {
            const game = parts[2];
            const mode = parts[3] ?? getDefaultMode(game);
            const lang = await getGuildLanguage(interaction.guildId);

            const teamSize = getModeConfig(game, mode)?.teamSize ?? 5;
            if (teamSize < 2) {
                await interaction.reply({ content: t('party_no_1v1', lang), ephemeral: true });
                return;
            }

            const queue = queueManager.getQueue(game, mode);
            if (!queue.some(p => p.user.id === user.id)) {
                await interaction.reply({ content: t('party_must_be_in_queue', lang), ephemeral: true });
                return;
            }

            const userSelect = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(`select_party_member_${game}_${mode}`)
                    .setPlaceholder('Select a player to invite')
                    .setMaxValues(1)
            );

            await interaction.reply({
                content: t('party_select_player', lang),
                components: [userSelect],
                ephemeral: true
            });
            return;
        } else if (action === 'accept' && type === 'invite') {
            // accept_invite_<game>_<mode>_<inviterId>_<targetId>
            const game = parts[2];
            const mode = parts[3];
            const inviterId = parts[4];
            const targetId = parts[5];
            const lang = await getGuildLanguage(interaction.guildId);

            if (targetId && user.id !== targetId) {
                await interaction.reply({ content: t('party_not_for_you', lang), ephemeral: true });
                return;
            }

            const queue = queueManager.getQueue(game, mode);
            const inviter = queue.find(p => p.user.id === inviterId);

            if (!inviter) {
                await interaction.reply({ content: t('party_inviter_gone', lang), ephemeral: true });
                return;
            }

            let groupId = inviter.groupId;
            if (!groupId) {
                groupId = `group_${Date.now()}_${inviterId}`;
                inviter.groupId = groupId;
            }

            // A group can never exceed one team
            const teamSize = getModeConfig(game, mode)?.teamSize ?? 5;
            const groupSize = queue.filter(p => p.groupId === groupId).length;
            if (groupSize + 1 > teamSize) {
                await interaction.reply({ content: t('party_full', lang, { max: teamSize }), ephemeral: true });
                return;
            }

            const result = await queueManager.addPlayer(game, mode, user, groupId, lang);
            if (!result.success) {
                await interaction.reply({ content: result.reason || t('error_generic', lang), ephemeral: true });
                return;
            }

            await interaction.update({ content: t('party_joined', lang, { user: `<@${user.id}>`, inviter: `<@${inviterId}>` }), components: [] });
            return;

        } else if (action === 'decline' && type === 'invite') {
            const targetId = parts[5];
            const lang = await getGuildLanguage(interaction.guildId);
            if (targetId && user.id !== targetId) {
                await interaction.reply({ content: t('party_not_for_you', lang), ephemeral: true });
                return;
            }
            await interaction.update({ content: t('party_declined', lang), components: [] });
            return;
        }

    } else if (interaction.isUserSelectMenu()) {
        // select_party_member_<game>_<mode>
        const parts = customId.split('_');
        const game = parts[3];
        const mode = parts[4] ?? getDefaultMode(game);
        const targetUserId = interaction.values[0];
        const lang = await getGuildLanguage(interaction.guildId);

        if (targetUserId === user.id) {
            await interaction.reply({ content: t('party_no_self', lang), ephemeral: true });
            return;
        }

        // Check if target user is a bot
        const targetUser = await interaction.guild?.members.fetch(targetUserId).catch(() => null);
        if (!targetUser) {
            await interaction.reply({ content: t('error_generic', lang), ephemeral: true });
            return;
        }
        if (targetUser.user.bot) {
            await interaction.reply({ content: t('party_no_bots', lang), ephemeral: true });
            return;
        }

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`accept_invite_${game}_${mode}_${user.id}_${targetUserId}`)
                .setLabel('Accept')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`decline_invite_${game}_${mode}_${user.id}_${targetUserId}`)
                .setLabel('Decline')
                .setStyle(ButtonStyle.Danger),
        );

        const queueName = queueManager.getConfig(game, mode)?.name ?? game;
        await interaction.reply({
            content: t('party_invited', lang, { target: `<@${targetUserId}>`, inviter: `<@${user.id}>`, game: queueName }),
            components: [row]
        });
        return;
    }
};
