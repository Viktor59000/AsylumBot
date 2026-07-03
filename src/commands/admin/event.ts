import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { prisma } from '../../utils/db';
import { COLORS, GAME_CONFIGS } from '../../utils/constants';

export const command = {
    data: new SlashCommandBuilder()
        .setName('event')
        .setDescription('Manage events (rush hours)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('rushhour')
                .setDescription('Start or schedule a rush hour (Elo/coins multiplier)')
                .addIntegerOption(o => o.setName('duration').setDescription('Duration in minutes').setRequired(true).setMinValue(5).setMaxValue(24 * 60))
                .addNumberOption(o => o.setName('multiplier').setDescription('Multiplier (default 2)').setMinValue(1.1).setMaxValue(5))
                .addStringOption(o => o.setName('game').setDescription('Scope to one game (default: all)')
                    .addChoices(...Object.entries(GAME_CONFIGS).map(([key, cfg]) => ({ name: cfg.name, value: key }))))
                .addIntegerOption(o => o.setName('start_in').setDescription('Start in N minutes (default: now)').setMinValue(1).setMaxValue(7 * 24 * 60))
        )
        .addSubcommand(sub =>
            sub.setName('list').setDescription('List active & upcoming rush hours')
        )
        .addSubcommand(sub =>
            sub.setName('cancel')
                .setDescription('Cancel a rush hour by id')
                .addIntegerOption(o => o.setName('id').setDescription('Event id (see /event list)').setRequired(true))
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guildId) return;
        const sub = interaction.options.getSubcommand();

        if (sub === 'rushhour') {
            const duration = interaction.options.getInteger('duration', true);
            const multiplier = interaction.options.getNumber('multiplier') ?? 2;
            const game = interaction.options.getString('game');
            const startIn = interaction.options.getInteger('start_in') ?? 0;

            const startAt = new Date(Date.now() + startIn * 60 * 1000);
            const endAt = new Date(startAt.getTime() + duration * 60 * 1000);

            const event = await prisma.event.create({
                data: {
                    guildId: interaction.guildId,
                    type: 'rush_hour',
                    game,
                    multiplier,
                    startAt,
                    endAt,
                    createdBy: interaction.user.id,
                },
            });

            const scope = game ? (GAME_CONFIGS[game as keyof typeof GAME_CONFIGS]?.name ?? game) : 'all games';
            await interaction.reply({
                content: `🔥 Rush hour **#${event.id}** created: **×${multiplier}** on **${scope}**, ` +
                    (startIn > 0 ? `starts <t:${Math.floor(startAt.getTime() / 1000)}:R>` : 'starts **now**') +
                    `, ends <t:${Math.floor(endAt.getTime() / 1000)}:R>. Announcement follows within a minute.`,
            });
        } else if (sub === 'list') {
            const now = new Date();
            const events = await prisma.event.findMany({
                where: { guildId: interaction.guildId, type: 'rush_hour', endAt: { gt: now } },
                orderBy: { startAt: 'asc' },
            });

            if (events.length === 0) {
                await interaction.reply({ content: 'No active or upcoming rush hour.', ephemeral: true });
                return;
            }

            const lines = events.map(e => {
                const scope = e.game ? (GAME_CONFIGS[e.game as keyof typeof GAME_CONFIGS]?.name ?? e.game) : 'all games';
                const status = e.startAt <= now ? '🟢 ACTIVE' : '⏳ scheduled';
                return `**#${e.id}** ${status} — ×${e.multiplier} on **${scope}** • <t:${Math.floor(e.startAt.getTime() / 1000)}:t> → <t:${Math.floor(e.endAt.getTime() / 1000)}:t>`;
            });

            const embed = new EmbedBuilder()
                .setTitle('🔥 Rush Hours')
                .setDescription(lines.join('\n'))
                .setColor(COLORS.ASYLUM_GOLD as any);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        } else if (sub === 'cancel') {
            const id = interaction.options.getInteger('id', true);
            const event = await prisma.event.findFirst({ where: { id, guildId: interaction.guildId, type: 'rush_hour' } });
            if (!event) {
                await interaction.reply({ content: `❌ Event #${id} not found.`, ephemeral: true });
                return;
            }
            // Ending now: the ticker announces the end (only if the start was announced)
            await prisma.event.update({ where: { id }, data: { endAt: new Date() } });
            await interaction.reply({ content: `🧯 Rush hour **#${id}** cancelled/stopped.` });
        }
    },
};
