import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, GuildChannel } from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const command = {
    data: new SlashCommandBuilder()
        .setName('sub')
        .setDescription('Substitute a player in a match')
        .addIntegerOption((option) =>
            option.setName('match_id').setDescription('The ID of the match').setRequired(true),
        )
        .addUserOption((option) =>
            option.setName('old_player').setDescription('The player to replace').setRequired(true),
        )
        .addUserOption((option) =>
            option.setName('new_player').setDescription('The new player').setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    async execute(interaction: ChatInputCommandInteraction) {
        const matchId = interaction.options.getInteger('match_id', true);
        const oldPlayer = interaction.options.getUser('old_player', true);
        const newPlayer = interaction.options.getUser('new_player', true);

        const match = await prisma.match.findUnique({
            where: { id: matchId },
            include: { players: true },
        });

        if (!match) {
            await interaction.reply({ content: 'Match not found.', ephemeral: true });
            return;
        }

        const playerRecord = match.players.find(p => p.userId === oldPlayer.id);
        if (!playerRecord) {
            await interaction.reply({ content: 'Old player is not in this match.', ephemeral: true });
            return;
        }

        // Update DB
        await prisma.matchPlayer.update({
            where: {
                matchId_userId: {
                    matchId: matchId,
                    userId: oldPlayer.id,
                },
            },
            data: {
                userId: newPlayer.id,
            },
        });

        // Update Voice Permissions
        if (interaction.guild) {
            const channelId = playerRecord.team === 'team1' ? match.channelId1 : match.channelId2;
            if (channelId) {
                const channel = interaction.guild.channels.cache.get(channelId);
                if (channel && (channel.isVoiceBased() || channel.isTextBased())) {
                    const guildChannel = channel as GuildChannel;
                    // Remove old
                    await guildChannel.permissionOverwrites.delete(oldPlayer.id).catch(console.error);
                    // Add new
                    await guildChannel.permissionOverwrites.create(newPlayer.id, {
                        ViewChannel: true,
                        Connect: true,
                        Speak: true,
                    }).catch(console.error);
                }
            }
        }

        await interaction.reply({ content: `Substituted <@${oldPlayer.id}> with <@${newPlayer.id}> in Match #${matchId}.`, ephemeral: false });
    },
};
