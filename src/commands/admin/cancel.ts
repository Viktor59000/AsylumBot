import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const command = {
    data: new SlashCommandBuilder()
        .setName('cancel')
        .setDescription('Cancel a match and delete voice channels')
        .addIntegerOption((option) =>
            option.setName('match_id').setDescription('The ID of the match to cancel').setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction: ChatInputCommandInteraction) {
        const matchId = interaction.options.getInteger('match_id', true);

        const match = await prisma.match.findUnique({
            where: { id: matchId },
        });

        if (!match) {
            await interaction.reply({ content: 'Match not found.', ephemeral: true });
            return;
        }

        // Delete Voice Channels
        if (interaction.guild) {
            if (match.channelId1) {
                const channel1 = interaction.guild.channels.cache.get(match.channelId1);
                if (channel1) await channel1.delete().catch(console.error);
            }
            if (match.channelId2) {
                const channel2 = interaction.guild.channels.cache.get(match.channelId2);
                if (channel2) await channel2.delete().catch(console.error);
            }
        }

        // Delete Match from DB (or set status to cancelled if we had a status field, but we'll delete for now)
        // Note: Deleting match might violate foreign key constraints if we have MatchPlayer records.
        // We should delete MatchPlayers first or use cascade delete.
        // Prisma schema usually handles cascade if configured, but let's check.
        // Our schema: MatchPlayer has relation to Match. We didn't specify onDelete: Cascade.
        // So we need to delete MatchPlayers first.

        await prisma.matchPlayer.deleteMany({
            where: { matchId: matchId },
        });

        await prisma.match.delete({
            where: { id: matchId },
        });

        await interaction.reply({ content: `Match #${matchId} has been cancelled and deleted.`, ephemeral: false });
    },
};
