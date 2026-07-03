import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../../utils/db';
import { GAME_CONFIGS, GAME_MODES, ALL_MODE_KEYS, getDefaultMode, getModeConfig } from '../../utils/constants';


export const command = {
    data: new SlashCommandBuilder()
        .setName('mmr')
        .setDescription('Manage player MMR/Elo')
        .addUserOption((option) =>
            option.setName('user').setDescription('The user to modify').setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('game')
                .setDescription('The game')
                .setRequired(true)
                .addChoices(
                    ...Object.entries(GAME_CONFIGS).map(([key, config]) => ({ name: config.name, value: key }))
                ),
        )
        .addIntegerOption((option) =>
            option.setName('amount').setDescription('The amount of Elo').setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('action')
                .setDescription('Action to perform')
                .setRequired(true)
                .addChoices(
                    { name: 'Set (Override)', value: 'set' },
                    { name: 'Add (Increment)', value: 'add' },
                    { name: 'Remove (Decrement)', value: 'remove' },
                ),
        )
        .addStringOption((option) =>
            option
                .setName('mode')
                .setDescription('The queue mode (default: first mode of the game)')
                .addChoices(...ALL_MODE_KEYS.map(m => ({ name: m, value: m }))),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction: ChatInputCommandInteraction) {
        const targetUser = interaction.options.getUser('user', true);
        const game = interaction.options.getString('game', true);
        const amount = interaction.options.getInteger('amount', true);
        const action = interaction.options.getString('action', true);
        const mode = interaction.options.getString('mode') ?? getDefaultMode(game);

        if (!getModeConfig(game, mode)) {
            await interaction.reply({ content: `❌ Invalid mode **${mode}** for this game. Valid modes: ${Object.keys(GAME_MODES[game] ?? {}).join(', ')}`, ephemeral: true });
            return;
        }

        // Ensure user exists
        await prisma.user.upsert({
            where: { id: targetUser.id },
            update: { username: targetUser.username },
            create: { id: targetUser.id, username: targetUser.username },
        });

        const { getActiveSeasonId } = await import('../../utils/season');
        const seasonId = await getActiveSeasonId();
        const eloRecord = await prisma.elo.findFirst({
            where: { userId: targetUser.id, game, mode, seasonId }
        });

        let newRating = 1000;
        if (eloRecord) {
            newRating = eloRecord.rating;
        }

        if (action === 'set') {
            newRating = amount;
        } else if (action === 'add') {
            newRating += amount;
        } else if (action === 'remove') {
            newRating -= amount;
        }

        if (eloRecord) {
            await prisma.elo.update({
                where: { id: eloRecord.id },
                data: { rating: newRating },
            });
        } else {
            await prisma.elo.create({
                data: {
                    userId: targetUser.id,
                    game,
                    mode,
                    seasonId,
                    rating: newRating,
                    wins: 0,
                    losses: 0,
                },
            });
        }

        await interaction.reply({
            content: `✅ Updated **${game} ${mode}** MMR for <@${targetUser.id}>.\nAction: ${action.toUpperCase()} ${amount}\nNew Rating: **${newRating}**`
        });

        // Update Leaderboard
        const { getManagers } = await import('../../managers/registry');
        await getManagers().leaderboard.updateLeaderboard(game, mode);
    },
};
