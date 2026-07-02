import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    EmbedBuilder,
    Interaction,
    ChannelType,
    CategoryChannel,
    TextChannel
} from 'discord.js';
import { GAME_CONFIGS, COLORS, BOT_ICON } from '../../utils/constants';
import { createQueueEmbed } from '../../utils/embeds';
import { queueManager } from '../../managers/QueueManager';

// Constants for selections
const REGIONS = [
    { label: 'Europe West (EUW)', value: 'EUW', emoji: '🇪🇺' },
    { label: 'North America (NA)', value: 'NA', emoji: '🇺🇸' },
    { label: 'Korea (KR)', value: 'KR', emoji: '🇰🇷' },
    { label: 'Europe Nordic & East (EUNE)', value: 'EUNE', emoji: '🇪🇺' },
    { label: 'China (CN)', value: 'CN', emoji: '🇨🇳' },
];

const MODES = [
    { label: 'Ranked (MMR Active)', value: 'Ranked', description: 'Strict matchmaking with Elo system', emoji: '🏆' },
    { label: 'Rosters (Teams)', value: 'Rosters', description: 'Pre-made teams competition', emoji: '🤝' },
    { label: 'Casual (No MMR)', value: 'Casual', description: 'Random teams, just for fun', emoji: '🎲' },
    { label: 'Captain (Draft)', value: 'Captain', description: 'Captains pick players', emoji: '👑' },
];

export const command = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Launch the ASYLUM Setup Wizard')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction: ChatInputCommandInteraction) {
        try {
            console.log('[SETUP] Command executed, deferring reply...');
            await interaction.deferReply();

            const embed = new EmbedBuilder()
                .setTitle('🛠️ ASYLUM Setup Wizard')
                .setDescription('Welcome to the automated setup assistant.\nThis wizard will help you configure a new game section in less than 30 seconds.\n\n**What we will create:**\n• Game Categories & Channels\n• Roles & Permissions\n• Matchmaking Configuration')
                .setColor(COLORS.ASYLUM_GOLD as any)
                .setThumbnail(BOT_ICON)
                .setFooter({ text: 'Step 1/5: Initialization' });

            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('setup_start')
                        .setLabel('Start Setup')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('🚀'),
                    new ButtonBuilder()
                        .setCustomId('setup_cancel')
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Danger)
                );

            console.log('[SETUP] Sending embed and buttons...');
            await interaction.editReply({ embeds: [embed], components: [row] });
            console.log('[SETUP] Successfully sent initial message');
        } catch (e) {
            console.error('[SETUP] Execute Error:', e);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Error in setup command', ephemeral: true }).catch(() => { });
            }
        }
    },
};

export const handleSetupInteraction = async (interaction: Interaction) => {
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith('setup_')) return;

    const parts = interaction.customId.split('_');
    const action = parts[1]; // start, game, region, mode, confirm, cancel

    // Handle Cancel
    if (action === 'cancel') {
        await interaction.update({ content: '❌ Setup cancelled.', embeds: [], components: [] });
        return;
    }

    // Step 2: Game Selection
    if (action === 'start') {
        const embed = new EmbedBuilder()
            .setTitle('🎮 Select a Game')
            .setDescription('Choose the game you want to configure.\nWe will set up the specific roles and channels for this game.')
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setFooter({ text: 'Step 2/5: Game Selection' });

        const select = new StringSelectMenuBuilder()
            .setCustomId('setup_game')
            .setPlaceholder('Select a game...')
            .addOptions(
                Object.entries(GAME_CONFIGS).map(([key, config]) => ({
                    label: config.name,
                    value: key,
                    emoji: config.emoji,
                }))
            );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

        await interaction.update({ embeds: [embed], components: [row] });
    }

    // Step 3: Region Selection
    if (action === 'game') {
        if (!interaction.isStringSelectMenu()) return;
        const selectedGame = interaction.values[0];

        const embed = new EmbedBuilder()
            .setTitle('🌍 Select a Region')
            .setDescription(`Configuring for **${GAME_CONFIGS[selectedGame as keyof typeof GAME_CONFIGS].name}**.\nSelect the region for matchmaking and API data (OP.GG, etc.).`)
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setFooter({ text: 'Step 3/5: Region Selection' });

        const select = new StringSelectMenuBuilder()
            .setCustomId(`setup_region_${selectedGame}`)
            .setPlaceholder('Select a region...')
            .addOptions(REGIONS);

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

        await interaction.update({ embeds: [embed], components: [row] });
    }

    // Step 4: Mode Selection
    if (action === 'region') {
        if (!interaction.isStringSelectMenu()) return;
        const selectedGame = parts[2];
        const selectedRegion = interaction.values[0];

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Select Game Mode')
            .setDescription(`Region: **${selectedRegion}**\nChoose the matchmaking mode for this queue.`)
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setFooter({ text: 'Step 4/5: Mode Selection' });

        const select = new StringSelectMenuBuilder()
            .setCustomId(`setup_mode_${selectedGame}_${selectedRegion}`)
            .setPlaceholder('Select a mode...')
            .addOptions(MODES);

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

        await interaction.update({ embeds: [embed], components: [row] });
    }

    // Step 5: Confirmation
    if (action === 'mode') {
        if (!interaction.isStringSelectMenu()) return;
        const selectedGame = parts[2];
        const selectedRegion = parts[3];
        const selectedMode = interaction.values[0];

        const gameName = GAME_CONFIGS[selectedGame as keyof typeof GAME_CONFIGS].name;

        const embed = new EmbedBuilder()
            .setTitle('✅ Confirm Deployment')
            .setDescription('Please review your configuration before deployment.')
            .setColor(COLORS.SUCCESS as any)
            .addFields(
                { name: 'Game', value: gameName, inline: true },
                { name: 'Region', value: selectedRegion, inline: true },
                { name: 'Mode', value: selectedMode, inline: true }
            )
            .setFooter({ text: 'Step 5/5: Confirmation' });

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`setup_confirm_${selectedGame}_${selectedRegion}_${selectedMode}`)
                    .setLabel('Confirm & Deploy')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🚀'),
                new ButtonBuilder()
                    .setCustomId('setup_cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.update({ embeds: [embed], components: [row] });
    }

    // Backend Deployment
    if (action === 'confirm') {
        const selectedGame = parts[2];
        const selectedRegion = parts[3];
        const selectedMode = parts[4];
        const gameConfig = GAME_CONFIGS[selectedGame as keyof typeof GAME_CONFIGS];

        await interaction.update({ content: '🔄 Deploying... Please wait.', embeds: [], components: [] });

        const guild = interaction.guild;
        if (!guild) return;

        try {
            // 1. Create Main Category
            const mainCategoryName = `InHouse - ${gameConfig.name}`;
            let mainCategory = guild.channels.cache.find(c => c.name === mainCategoryName && c.type === ChannelType.GuildCategory) as CategoryChannel;
            if (!mainCategory) {
                mainCategory = await guild.channels.create({
                    name: mainCategoryName,
                    type: ChannelType.GuildCategory,
                });
            }

            // 2. Create Channels
            const channelsToCreate = [
                {
                    name: 'match-history',
                    type: ChannelType.GuildText,
                    topic: 'Match results and history.',
                    permissions: [
                        { id: guild.id, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel] }
                    ]
                },
                {
                    name: 'top-20',
                    type: ChannelType.GuildText,
                    topic: 'Leaderboard for the top 20 players.',
                    permissions: [
                        { id: guild.id, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel] }
                    ]
                },
                {
                    name: 'queue',
                    type: ChannelType.GuildText,
                    topic: 'Join the queue here!',
                    permissions: [
                        { id: guild.id, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel] }
                    ]
                },
                {
                    name: 'inhouse-admin-logs',
                    type: ChannelType.GuildText,
                    topic: 'Private logs.',
                    permissions: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }
                    ]
                },
            ];

            const createdChannels: Record<string, TextChannel> = {};

            for (const ch of channelsToCreate) {
                let channel = guild.channels.cache.find(c => c.name === ch.name && c.parentId === mainCategory.id) as TextChannel;
                if (!channel) {
                    const newChannel = await guild.channels.create({
                        name: ch.name,
                        type: ch.type as any,
                        parent: mainCategory.id,
                        topic: ch.topic,
                        permissionOverwrites: ch.permissions,
                    });
                    channel = newChannel as TextChannel;
                }
                createdChannels[ch.name] = channel;
            }

            // 3. Create Ongoing Category
            const ongoingCategoryName = `Ongoing ${gameConfig.name} Games`;
            let ongoingCategory = guild.channels.cache.find(c => c.name === ongoingCategoryName && c.type === ChannelType.GuildCategory) as CategoryChannel;
            if (!ongoingCategory) {
                ongoingCategory = await guild.channels.create({
                    name: ongoingCategoryName,
                    type: ChannelType.GuildCategory,
                });
            }

            // 4. Create In-Progress Channel
            let inProgressChannel = guild.channels.cache.find(c => c.name === 'in-progress' && c.parentId === ongoingCategory.id) as TextChannel;
            if (!inProgressChannel) {
                inProgressChannel = await guild.channels.create({
                    name: 'in-progress',
                    type: ChannelType.GuildText,
                    parent: ongoingCategory.id,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel] }
                    ]
                });
            }

            // 5. Send Initialization Messages

            // Match History Embed
            const historyChannel = createdChannels['match-history'];
            if (historyChannel) {
                const historyEmbed = new EmbedBuilder()
                    .setTitle('📜 Match History')
                    .setDescription(`All **${gameConfig.name}** match results will be posted here automatically.`)
                    .setColor(COLORS.ASYLUM_GOLD as any)
                    .setFooter({ text: 'Powered by ASYLUM-BOT' });
                await historyChannel.send({ embeds: [historyEmbed] });
            }

            // Leaderboard Embed
            const leaderboardChannel = createdChannels['top-20'];
            if (leaderboardChannel) {
                const leaderboardEmbed = new EmbedBuilder()
                    .setTitle('🏆 Leaderboard')
                    .setDescription(`Top 20 players for **${gameConfig.name}** ${selectedMode}.\nUpdates automatically after every match.`)
                    .addFields({ name: 'Current Standings', value: '*No suitable records to display yet. Be the first to win!*' })
                    .setColor(COLORS.ASYLUM_GOLD as any)
                    .setFooter({ text: 'Powered by ASYLUM-BOT' });

                const refreshBtn = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`refresh_leaderboard_${selectedGame}`)
                            .setLabel('Refresh Leaderboard')
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji('🔄')
                    );

                await leaderboardChannel.send({ embeds: [leaderboardEmbed], components: [refreshBtn] });
            }

            // Admin Logs Embed
            const logsChannel = createdChannels['inhouse-admin-logs'];
            if (logsChannel) {
                const logsEmbed = new EmbedBuilder()
                    .setTitle('🔒 Admin Log Channel Created')
                    .setDescription('This channel will be used to log important administrative actions and events within the server (Force Start, Bans, MMR changes).')
                    .setColor(COLORS.ASYLUM_DARK as any);
                await logsChannel.send({ embeds: [logsEmbed] });
            }

            // In Progress Embed
            if (inProgressChannel) {
                const inProgressEmbed = new EmbedBuilder()
                    .setTitle('⏳ On Going Matches')
                    .setDescription(`**${gameConfig.name}** Matches in progress will be displayed in this channel.\nMembers will be able to spectate by joining the voice channels.`)
                    .setColor(COLORS.ASYLUM_GOLD as any)
                    .setImage('https://i.imgur.com/AfFp7pu.png') // Placeholder for Banner
                    .setFooter({ text: "If you don't want spectators, toggle it off in settings." });
                await inProgressChannel.send({ embeds: [inProgressEmbed] });
            }

            // Send Queue Embed
            const queueChannel = createdChannels['queue'];
            if (queueChannel) {
                const requiredPlayers = gameConfig.teamSize * 2;
                const { embed: queueEmbed, files: queueFiles } = createQueueEmbed(selectedGame, [], requiredPlayers);
                const queueRow = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder().setCustomId(`join_queue_${selectedGame}`).setLabel('Join Queue').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`leave_queue_${selectedGame}`).setLabel('Leave Queue').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId(`invite_party_${selectedGame}`).setLabel('Party Invite').setStyle(ButtonStyle.Primary)
                    );

                const queueMessage = await queueChannel.send({
                    content: `**${gameConfig.name} ${selectedMode} Queue** (${selectedRegion})`,
                    embeds: [queueEmbed],
                    files: queueFiles,
                    components: [queueRow]
                });

                await interaction.followUp({ content: `✅ **Setup Complete!**\nDeployed ${gameConfig.name} (${selectedRegion} - ${selectedMode}) successfully.\nCheck <#${queueChannel.id}> to start playing.`, ephemeral: true });

                // Save Configuration to Database
                const { prisma } = await import('../../utils/db');
                await prisma.gameConfig.upsert({
                    where: {
                        guildId_game: {
                            guildId: guild.id,
                            game: selectedGame
                        }
                    },
                    update: {
                        region: selectedRegion,
                        mode: selectedMode,
                        queueChannelId: queueChannel.id,
                        historyChannelId: historyChannel?.id,
                        leaderboardChannelId: leaderboardChannel?.id,
                        adminLogChannelId: logsChannel?.id,
                        queueMessageId: queueMessage.id, // Store message ID for updates
                    },
                    create: {
                        guildId: guild.id,
                        game: selectedGame,
                        region: selectedRegion,
                        mode: selectedMode,
                        queueChannelId: queueChannel.id,
                        historyChannelId: historyChannel?.id,
                        leaderboardChannelId: leaderboardChannel?.id,
                        adminLogChannelId: logsChannel?.id,
                        queueMessageId: queueMessage.id, // Store message ID for updates
                    }
                });
            }

        } catch (error) {
            console.error(error);
            await interaction.followUp({ content: '❌ An error occurred during deployment. Check my permissions.', ephemeral: true });
        }
    }
};
