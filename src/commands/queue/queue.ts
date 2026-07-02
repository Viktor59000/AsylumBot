import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { queueManager } from '../../managers/QueueManager';
import { createQueueEmbed } from '../../utils/embeds';
import { GAME_CONFIGS } from '../../utils/constants';
import { getGuildLanguage, t } from '../../utils/i18n';

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
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const subcommand = interaction.options.getSubcommand();
        const game = interaction.options.getString('game'); // Optional for force_leave

        if (subcommand === 'view') {
            if (!game) return; // Should be required by option
            const queue = queueManager.getQueue(game);
            const required = queueManager.getRequiredPlayers(game);

            const { embed, files } = createQueueEmbed(game, queue, required);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(`join_queue_${game}`)
                    .setLabel('Join Queue')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`leave_queue_${game}`)
                    .setLabel('Leave Queue')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`invite_party_${game}`)
                    .setLabel('Invite Duo/Trio')
                    .setStyle(ButtonStyle.Primary),
            );

            await interaction.reply({ embeds: [embed], components: [row], files });
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

            const result = queueManager.forceStart(game);
            if (result.success) {
                await interaction.reply({ content: `✅ **Force Start Initiated for ${GAME_CONFIGS[game as keyof typeof GAME_CONFIGS].name}**!`, ephemeral: false });
            } else {
                await interaction.reply({ content: `❌ Failed to force start: ${result.reason}`, ephemeral: true });
            }
        }
    },
};

export const handleQueueInteraction = async (interaction: any) => {
    const customId = interaction.customId;
    const user = interaction.user;

    if (interaction.isButton()) {
        const parts = customId.split('_');
        const action = parts[0];
        const type = parts[1]; // queue or invite

        if (action === 'join') {
            const game = parts[2];
            const lang = await getGuildLanguage(interaction.guildId);
            const result = await queueManager.addPlayer(game, user, undefined, lang);
            if (!result.success) {
                await interaction.reply({ content: result.reason || t('error_generic', lang), ephemeral: true });
                return;
            }
            await interaction.reply({ content: t('queue_joined', lang, { game: GAME_CONFIGS[game as keyof typeof GAME_CONFIGS].name }), ephemeral: true });
        } else if (action === 'leave') {
            const game = parts[2];
            const lang = await getGuildLanguage(interaction.guildId);
            const success = await queueManager.removePlayer(game, user.id);
            if (!success) {
                await interaction.reply({ content: t('queue_already_in', lang), ephemeral: true });
                return;
            }
            await interaction.reply({ content: t('queue_left', lang, { game: GAME_CONFIGS[game as keyof typeof GAME_CONFIGS].name }), ephemeral: true });
        } else if (action === 'invite') {
            const game = parts[2];
            const queue = queueManager.getQueue(game);
            if (!queue.some(p => p.user.id === user.id)) {
                await interaction.reply({ content: 'You must be in the queue to invite others.', ephemeral: true });
                return;
            }

            const userSelect = new ActionRowBuilder<any>().addComponents(
                {
                    type: ComponentType.UserSelect,
                    custom_id: `select_party_member_${game}`,
                    placeholder: 'Select a player to invite',
                    max_values: 1,
                }
            );

            await interaction.reply({
                content: 'Select a player to invite to your party:',
                components: [userSelect],
                ephemeral: true
            });
            return;
        } else if (action === 'accept' && type === 'invite') {
            const game = parts[2];
            const inviterId = parts[3];

            const queue = queueManager.getQueue(game);
            const inviter = queue.find(p => p.user.id === inviterId);

            if (!inviter) {
                await interaction.reply({ content: 'The inviter is no longer in the queue.', ephemeral: true });
                return;
            }

            let groupId = inviter.groupId;
            if (!groupId) {
                groupId = `group_${Date.now()}_${inviterId}`;
                inviter.groupId = groupId;
            }

            const result = await queueManager.addPlayer(game, user, groupId, await getGuildLanguage(interaction.guildId));
            if (!result.success) {
                await interaction.reply({ content: result.reason || 'Failed to join queue.', ephemeral: true });
                return;
            }

            await interaction.update({ content: `✅ You joined <@${inviterId}>'s party!`, components: [] });
            return;

        } else if (action === 'decline' && type === 'invite') {
            await interaction.update({ content: `❌ Invite declined.`, components: [] });
            return;
        }

        let game = parts[2];
        if (action === 'join' || action === 'leave') {
            const queue = queueManager.getQueue(game);
            const required = queueManager.getRequiredPlayers(game);
            const { embed, files } = createQueueEmbed(game, queue, required);

            await interaction.update({ embeds: [embed], files });
        }

    } else if (interaction.isUserSelectMenu()) {
        const parts = customId.split('_');
        const game = parts[3];
        const targetUserId = interaction.values[0];

        if (targetUserId === user.id) {
            await interaction.reply({ content: 'You cannot invite yourself.', ephemeral: true });
            return;
        }

        // Check if target user is a bot
        const targetUser = await interaction.guild?.members.fetch(targetUserId);
        if (targetUser?.user.bot) {
            await interaction.reply({ content: 'You cannot invite bots.', ephemeral: true });
            return;
        }

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`accept_invite_${game}_${user.id}`)
                .setLabel('Accept')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`decline_invite_${game}_${user.id}`)
                .setLabel('Decline')
                .setStyle(ButtonStyle.Danger),
        );

        await interaction.reply({
            content: `<@${targetUserId}>, you have been invited to join <@${user.id}>'s party for **${GAME_CONFIGS[game as keyof typeof GAME_CONFIGS].name}**!`,
            components: [row]
        });
        return;
    }
};
