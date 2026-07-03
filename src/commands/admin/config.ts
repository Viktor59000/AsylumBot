import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { queueManager } from '../../managers/QueueManager';
import { ALL_MODE_KEYS, getDefaultMode } from '../../utils/constants';

export const command = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure game settings')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) =>
            option
                .setName('game')
                .setDescription('The game to configure')
                .setRequired(true)
                .addChoices(
                    { name: 'Rocket League', value: 'rl' },
                    { name: 'Counter-Strike 2', value: 'cs2' },
                    { name: 'Rainbow Six Siege', value: 'r6s' },
                ),
        )
        .addStringOption((option) =>
            option
                .setName('mode')
                .setDescription('The queue mode (default: first mode of the game)')
                .addChoices(...ALL_MODE_KEYS.map(m => ({ name: m, value: m }))),
        )
        .addIntegerOption((option) =>
            option.setName('teamsize').setDescription('Players per team').setRequired(false),
        )
        .addBooleanOption((option) =>
            option.setName('voice_gate').setDescription('Require being in voice to accept the ready-check').setRequired(false),
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const game = interaction.options.getString('game', true);
        const mode = interaction.options.getString('mode') ?? getDefaultMode(game);
        const teamSize = interaction.options.getInteger('teamsize');
        const voiceGate = interaction.options.getBoolean('voice_gate');

        const config = queueManager.getConfig(game, mode);
        if (!config) {
            await interaction.reply({ content: 'Invalid game/mode.', ephemeral: true });
            return;
        }

        let updates = [];

        if (teamSize) {
            config.teamSize = teamSize;
            updates.push(`Team Size: **${teamSize}**`);
        }

        if (voiceGate !== null && interaction.guildId) {
            queueManager.setVoiceGate(game, mode, voiceGate);
            const { prisma } = await import('../../utils/db');
            await prisma.gameConfig.updateMany({
                where: { guildId: interaction.guildId, game, mode },
                data: { voiceGateEnabled: voiceGate },
            });
            updates.push(`Voice gate (ready-check): **${voiceGate ? 'ON 🔊' : 'OFF'}**`);
        }

        if (updates.length > 0) {
            await interaction.reply({ content: `✅ Updated **${config.name}** configuration:\n${updates.join('\n')}` });
        } else {
            await interaction.reply({
                content: `ℹ️ **${config.name}** configuration:\nTeam Size: ${config.teamSize}\nTotal Players: ${config.teamSize * config.teamCount}\nVoice gate: ${config.voiceGate ? 'ON 🔊' : 'OFF'}`
            });
        }
    },
};
