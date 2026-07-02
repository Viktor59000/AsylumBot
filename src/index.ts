import { Client, GatewayIntentBits, Collection, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { Command } from './utils/types';
import { logger } from './utils/logger';
import { handleQueueInteraction } from './commands/queue/queue';
import { handleSetupInteraction } from './commands/admin/setup';
import { handleSetProfileInteraction } from './commands/player/setProfile';
import { voteManager } from './managers/VoteManager';
import { handleStatsInteraction } from './commands/player/stats';
import { readyCheckManager } from './managers/ReadyCheckManager';
import { draftManager } from './managers/DraftManager';
import { vetoManager } from './managers/VetoManager';
import { spectatorManager } from './managers/SpectatorManager';
import { afkManager } from './managers/AFKManager';
import { allCommands } from './commands/registry';

dotenv.config();

export class ExtendedClient extends Client {
    commands: Collection<string, Command>;

    constructor() {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                // MessageContent removed (P1-7): the bot never reads message content.
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMembers,
            ],
        });
        this.commands = new Collection();
    }

    async start() {
        await this.registerModules();
        await this.login(process.env.DISCORD_TOKEN);
    }

    async registerModules() {
        const commandsToRegister = [];

        for (const command of allCommands) {
            if (command && 'data' in command && 'execute' in command) {
                this.commands.set(command.data.name, command);
                commandsToRegister.push(command.data.toJSON());
                console.log(`Loaded command: ${command.data.name}`);
            } else {
                console.log(`[WARNING] A command is missing a required "data" or "execute" property.`);
            }
        }

        // Register commands with Discord REST API
        const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

        try {
            console.log(`Started refreshing ${commandsToRegister.length} application (/) commands.`);
            // For development, register to a specific guild (faster updates)
            // For production, use Routes.applicationCommands(clientId)
            if (process.env.CLIENT_ID && process.env.GUILD_ID) {
                console.log(`Using CLIENT_ID: ${process.env.CLIENT_ID}, GUILD_ID: ${process.env.GUILD_ID}`);
                await rest.put(
                    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                    { body: commandsToRegister },
                );
                console.log('Successfully reloaded application (/) commands.');
            } else {
                console.warn('CLIENT_ID or GUILD_ID missing in .env, skipping command registration.');
            }
        } catch (error) {
            console.error('Failed verification or registration:', error);
        }
    }
}

export const client = new ExtendedClient();

client.once('ready', async () => {
    logger.info(`Logged in as ${client.user?.tag}!`);
    logger.info(`Currently in ${client.guilds.cache.size} servers.`);

    // Initialize all managers exactly once (P1-3)
    const { initManagers } = await import('./managers/registry');
    initManagers(client);

    // Unified Queue System
    const { queueManager } = await import('./managers/QueueManager');

    try {
        const { prisma } = await import('./utils/db');
        const gameConfigs = await prisma.gameConfig.findMany();
        for (const cfg of gameConfigs) {
            if (cfg.queueChannelId) {
                queueManager.setChannel(cfg.game, cfg.mode, cfg.queueChannelId, cfg.guildId, cfg.queueMessageId ?? undefined);
            } else {
                logger.warn(`[startup] Queue "${cfg.game} ${cfg.mode}" configured without a queue channel.`);
            }
        }
    } catch (err) {
        logger.error('[startup] Failed to load game configs:', err);
    }

    // Crash-safety: clean up whatever a restart orphaned (P1-2)
    try {
        const { runStartupRecovery } = await import('./managers/RecoveryManager');
        await runStartupRecovery(client);
    } catch (err) {
        logger.error('[startup] Recovery failed:', err);
    }

    // Refresh every permanent queue message (queues are empty after a restart)
    const { prisma: db } = await import('./utils/db');
    const boundConfigs = await db.gameConfig.findMany({ where: { queueMessageId: { not: null } } });
    for (const cfg of boundConfigs) {
        queueManager.emit('queueUpdate', cfg.game, cfg.mode);
    }

    queueManager.on('queueFull', async (game, mode, players) => {
        const config = queueManager.getConfig(game, mode);
        if (!config || !config.channelId) {
            logger.error(`[queueFull] No channel bound for queue "${game} ${mode}".`);
            return;
        }

        const channel = await client.channels.fetch(config.channelId).catch(() => null) as any;
        if (channel) {
            await readyCheckManager.startReadyCheck(game, mode, players, channel);
        }
    });
});

client.on('interactionCreate', async (interaction) => {
    try {
        const context = interaction.isChatInputCommand() ? interaction.commandName : (interaction as any).customId || 'Unknown Interaction';
        console.log('Interaction received:', context);

        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
                }
            }
        } else if (interaction.isButton()) {
            if (interaction.customId.startsWith('setup_')) {
                await handleSetupInteraction(interaction);
            } else if (interaction.customId.startsWith('setprofile_')) {
                await handleSetProfileInteraction(interaction);
            } else if (
                interaction.customId.startsWith('join_queue_') ||
                interaction.customId.startsWith('leave_queue_') ||
                interaction.customId.startsWith('invite_party_') ||
                interaction.customId.startsWith('accept_invite_') ||
                interaction.customId.startsWith('decline_invite_')
            ) {
                await handleQueueInteraction(interaction);
            } else if (interaction.customId.startsWith('vote_')) {
                await voteManager.handleInteraction(interaction);
            } else if (interaction.customId.startsWith('role_select_')) {
                const { getManagers } = await import('./managers/registry');
                await getManagers().roleMenu.handleInteraction(interaction);
            } else if (interaction.customId.startsWith('stats_view_')) {
                await handleStatsInteraction(interaction);
            } else if (interaction.customId.startsWith('ready_')) {
                await readyCheckManager.handleInteraction(interaction);
            } else if (interaction.customId.startsWith('spectate_')) {
                await spectatorManager.handleSpectateButton(interaction);
            } else if (interaction.customId.startsWith('afk_')) {
                await afkManager.handleInteraction(interaction);
            } else if (interaction.customId.startsWith('refresh_leaderboard_')) {
                // refresh_leaderboard_<game>[_<mode>] (legacy buttons have no mode)
                const rest = interaction.customId.replace('refresh_leaderboard_', '');
                const [game, mode] = rest.split('_');
                await interaction.deferReply({ ephemeral: true });
                const { getManagers } = await import('./managers/registry');
                if (mode) {
                    await getManagers().leaderboard.updateLeaderboard(game, mode);
                } else {
                    await getManagers().leaderboard.updateGameLeaderboards(game);
                }
                await interaction.editReply({ content: '🔄 Leaderboard refreshed.' });
            } else if (interaction.customId === 'rl_checkin') {
                await interaction.reply({ content: `✅ **${interaction.user.username}** is checked in.`, ephemeral: false });
            } else if (interaction.customId === 'match_report_win' || interaction.customId === 'match_cancel') {
                const { lobbyManager } = await import('./managers/LobbyManager');
                const lobby = lobbyManager.getLobby(interaction.channelId!);
                const hint = lobby
                    ? (interaction.customId === 'match_cancel'
                        ? `Use \`/cancel match_id:${lobby.matchId}\` to cancel this match.`
                        : `Use \`/reportwin match_id:${lobby.matchId} winning_team:<team1|team2>\` to report.`)
                    : 'This match is no longer active.';
                await interaction.reply({ content: `ℹ️ ${hint}`, ephemeral: true });
            }
        } else if (interaction.isStringSelectMenu()) {
            if (interaction.customId.startsWith('setup_')) {
                await handleSetupInteraction(interaction);
            } else if (interaction.customId.startsWith('setprofile_')) {
                await handleSetProfileInteraction(interaction);
            } else if (interaction.customId === 'draft_pick') {
                await draftManager.handleInteraction(interaction);
            } else if (interaction.customId === 'veto_ban') {
                await vetoManager.handleInteraction(interaction);
            } else if (interaction.customId === 'spectate_select') {
                await spectatorManager.handleSpectateSelect(interaction);
            }
        } else if (interaction.isUserSelectMenu()) {
            if (interaction.customId.startsWith('select_party_member_')) {
                await handleQueueInteraction(interaction);
            }
        } else if (interaction.isModalSubmit()) {
            if (interaction.customId.startsWith('setprofile_')) {
                await handleSetProfileInteraction(interaction);
            }
        }
    } catch (error) {
        console.error('Interaction Handling Error:', error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ An error occurred while processing this interaction.', ephemeral: true }).catch(() => { });
        }
    }
});

// ---- Global error handlers & graceful shutdown (P1-4) ----
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
});

client.on('error', (err) => logger.error('Discord client error:', err));
client.on('shardError', (err) => logger.error('Discord shard error:', err));
client.on('warn', (message) => logger.warn(`Discord client warning: ${message}`));

let shuttingDown = false;
async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down gracefully...`);

    try {
        const { destroyManagers } = await import('./managers/registry');
        destroyManagers();
    } catch (err) {
        logger.error('Error while destroying managers:', err);
    }

    try {
        await client.destroy();
    } catch (err) {
        logger.error('Error while destroying client:', err);
    }

    try {
        const { prisma } = await import('./utils/db');
        await prisma.$disconnect();
    } catch (err) {
        logger.error('Error while disconnecting Prisma:', err);
    }

    process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

client.start();
