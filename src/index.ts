import { Client, GatewayIntentBits, Collection, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { Command } from './utils/types';
import { handleQueueInteraction } from './commands/queue/queue';
import { handleSetupInteraction } from './commands/admin/setup';
import { handleSetProfileInteraction } from './commands/player/setProfile';
import { voteManager } from './managers/VoteManager';
import { RoleMenuManager } from './managers/RoleMenuManager';
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
                GatewayIntentBits.MessageContent,
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
    console.log(`Logged in as ${client.user?.tag}!`);
    console.log(`Currently in ${client.guilds.cache.size} servers.`);

    // Initialize Managers
    const { DecayManager } = await import('./managers/DecayManager');
    new DecayManager(client);

    const { ChallengeManager } = await import('./managers/ChallengeManager');
    new ChallengeManager(client);

    // Unified Queue System
    const { queueManager } = await import('./managers/QueueManager');
    const { Matchmaker } = await import('./managers/Matchmaker');

    const matchmaker = new Matchmaker(client);
    voteManager.setMatchmaker(matchmaker);

    try {
        const { prisma } = await import('./utils/db');
        const gameConfigs = await prisma.gameConfig.findMany();
        for (const cfg of gameConfigs) {
            if (cfg.queueChannelId) {
                queueManager.setChannel(cfg.game, cfg.queueChannelId, cfg.guildId);
            }
        }
    } catch (err) {
        console.error('[startup] Failed to load game configs:', err);
    }

    queueManager.on('queueFull', async (game, players) => {
        const config = queueManager.getConfig(game);
        if (!config || !config.channelId) {
            console.error(`[queueFull] No channel bound for game "${game}".`);
            return;
        }

        const channel = await client.channels.fetch(config.channelId).catch(() => null) as any;
        if (channel) {
            await readyCheckManager.startReadyCheck(game, players, channel);
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
                const roleMenuManager = new RoleMenuManager();
                await roleMenuManager.handleInteraction(interaction);
            } else if (interaction.customId.startsWith('stats_view_')) {
                await handleStatsInteraction(interaction);
            } else if (interaction.customId.startsWith('ready_')) {
                await readyCheckManager.handleInteraction(interaction);
            } else if (interaction.customId.startsWith('spectate_')) {
                await spectatorManager.handleSpectateButton(interaction);
            } else if (interaction.customId.startsWith('afk_')) {
                await afkManager.handleInteraction(interaction);
            } else if (interaction.customId.startsWith('refresh_leaderboard_')) {
                const game = interaction.customId.replace('refresh_leaderboard_', '');
                await interaction.deferReply({ ephemeral: true });
                const { LeaderboardManager } = await import('./managers/LeaderboardManager');
                await new LeaderboardManager(client).updateLeaderboard(game);
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

client.start();
