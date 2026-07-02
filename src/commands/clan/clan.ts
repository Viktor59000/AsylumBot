import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, User } from 'discord.js';
import { ClanManager } from '../../managers/ClanManager';
import { COLORS } from '../../utils/constants';
import { prisma } from '../../utils/db';

const clanManager = new ClanManager();

export const command = {
    data: new SlashCommandBuilder()
        .setName('clan')
        .setDescription('Clan management commands')
        .addSubcommand(sub =>
            sub.setName('create')
                .setDescription('Create a new clan')
                .addStringOption(opt => opt.setName('name').setDescription('Clan name').setRequired(true))
                .addAttachmentOption(opt => opt.setName('image').setDescription('Clan image').setRequired(false))
        )
        .addSubcommand(sub =>
            sub.setName('update')
                .setDescription('Update clan details (Leader only)')
                .addStringOption(opt => opt.setName('name').setDescription('New clan name'))
                .addAttachmentOption(opt => opt.setName('image').setDescription('New clan image'))
        )
        .addSubcommand(sub =>
            sub.setName('invite')
                .setDescription('Invite a member to your clan')
                .addUserOption(opt => opt.setName('user').setDescription('User to invite').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('leave')
                .setDescription('Leave your current clan')
        )
        .addSubcommand(sub =>
            sub.setName('kick')
                .setDescription('Kick a member from your clan (Leader only)')
                .addUserOption(opt => opt.setName('user').setDescription('User to kick').setRequired(true))
        )
        .addSubcommand(sub =>
            sub.setName('info')
                .setDescription('View clan stats')
                .addStringOption(opt => opt.setName('name').setDescription('Clan name (optional)'))
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View clan leaderboard')
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'create') {
                const name = interaction.options.getString('name', true);
                const image = interaction.options.getAttachment('image');

                await clanManager.createClan(name, interaction.user.id, interaction.user.username, image?.url || undefined);
                await interaction.reply({ content: `✅ Clan **${name}** created successfully!`, ephemeral: true });

            } else if (subcommand === 'update') {
                const name = interaction.options.getString('name');
                const image = interaction.options.getAttachment('image');

                if (!name && !image) {
                    return await interaction.reply({ content: '❌ You must specify at least one option to update.', ephemeral: true });
                }

                const caller = await prisma.user.findUnique({
                    where: { id: interaction.user.id },
                    include: { clan: true }
                });

                if (!caller?.clan) {
                    return await interaction.reply({ content: '❌ You are not in a clan.', ephemeral: true });
                }

                if (caller.clan.leaderId !== interaction.user.id) {
                    return await interaction.reply({ content: '❌ Only the clan leader can update clan details.', ephemeral: true });
                }

                await clanManager.updateClan(caller.clan.id, {
                    name: name || undefined,
                    imageUrl: image?.url || undefined
                });

                await interaction.reply({ content: `✅ Clan updated successfully!`, ephemeral: true });

            } else if (subcommand === 'invite') {
                const targetUser = interaction.options.getUser('user', true);

                if (targetUser.bot) {
                    return await interaction.reply({ content: '❌ You cannot invite bots.', ephemeral: true });
                }
                if (targetUser.id === interaction.user.id) {
                    return await interaction.reply({ content: '❌ You cannot invite yourself.', ephemeral: true });
                }

                const caller = await prisma.user.findUnique({
                    where: { id: interaction.user.id },
                    include: { clan: true }
                });

                if (!caller?.clan) {
                    return await interaction.reply({ content: '❌ You are not in a clan.', ephemeral: true });
                }

                if (caller.clan.leaderId !== interaction.user.id) {
                    return await interaction.reply({ content: '❌ Only the clan leader can invite members.', ephemeral: true });
                }

                const targetData = await prisma.user.findUnique({ where: { id: targetUser.id } });
                if (targetData?.clanId) {
                    return await interaction.reply({ content: '❌ This user is already in a clan.', ephemeral: true });
                }

                const row = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('accept_invite')
                            .setLabel('Accept')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId('decline_invite')
                            .setLabel('Decline')
                            .setStyle(ButtonStyle.Danger)
                    );

                const reply = await interaction.reply({
                    content: `${targetUser}, you have been invited to join **${caller.clan.name}** by ${interaction.user}.`,
                    components: [row],
                    fetchReply: true
                });

                const collector = reply.createMessageComponentCollector({
                    componentType: ComponentType.Button,
                    time: 60000
                });

                collector.on('collect', async i => {
                    if (i.user.id !== targetUser.id) {
                        await i.reply({ content: '❌ This invitation is not for you.', ephemeral: true });
                        return;
                    }

                    if (i.customId === 'accept_invite') {
                        await clanManager.addMember(caller.clan!.id, targetUser.id);
                        await i.update({ content: `✅ ${targetUser} has joined **${caller.clan!.name}**!`, components: [] });
                    } else {
                        await i.update({ content: `❌ ${targetUser} declined the invitation.`, components: [] });
                    }
                    collector.stop();
                });

                collector.on('end', async (collected, reason) => {
                    if (reason === 'time') {
                        await interaction.editReply({ content: '❌ Invitation expired.', components: [] });
                    }
                });

            } else if (subcommand === 'leave') {
                const user = await prisma.user.findUnique({
                    where: { id: interaction.user.id },
                    include: { clan: true }
                });

                if (!user?.clanId) {
                    return await interaction.reply({ content: '❌ You are not in a clan.', ephemeral: true });
                }

                if (user.clan?.leaderId === interaction.user.id) {
                    return await interaction.reply({ content: '❌ You are the leader. You must delete the clan or transfer ownership (not implemented) to leave.', ephemeral: true });
                }

                await clanManager.removeMember(interaction.user.id);
                await interaction.reply({ content: `✅ You have left **${user.clan?.name}**.`, ephemeral: true });

            } else if (subcommand === 'kick') {
                const targetUser = interaction.options.getUser('user', true);

                const caller = await prisma.user.findUnique({
                    where: { id: interaction.user.id },
                    include: { clan: true }
                });

                if (!caller?.clan) {
                    return await interaction.reply({ content: '❌ You are not in a clan.', ephemeral: true });
                }

                if (caller.clan.leaderId !== interaction.user.id) {
                    return await interaction.reply({ content: '❌ Only the clan leader can kick members.', ephemeral: true });
                }

                const targetData = await prisma.user.findUnique({ where: { id: targetUser.id } });
                if (targetData?.clanId !== caller.clan.id) {
                    return await interaction.reply({ content: '❌ This user is not in your clan.', ephemeral: true });
                }

                if (targetUser.id === interaction.user.id) {
                    return await interaction.reply({ content: '❌ You cannot kick yourself.', ephemeral: true });
                }

                await clanManager.removeMember(targetUser.id);
                await interaction.reply({ content: `✅ ${targetUser} has been kicked from the clan.`, ephemeral: true });

            } else if (subcommand === 'info') {
                const name = interaction.options.getString('name');
                let clanId: number | undefined;

                if (name) {
                    const clan = await clanManager.getClanByName(name);
                    if (!clan) return await interaction.reply({ content: '❌ Clan not found.', ephemeral: true });
                    clanId = clan.id;
                } else {
                    const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });
                    if (!user?.clanId) return await interaction.reply({ content: '❌ You are not in a clan. Specify a clan name.', ephemeral: true });
                    clanId = user.clanId!;
                }

                const stats = await clanManager.getClanStats(clanId!);
                if (!stats) return await interaction.reply({ content: '❌ Clan not found.', ephemeral: true });

                const embed = new EmbedBuilder()
                    .setTitle(`🛡️ ${stats.name}`)
                    .setColor(COLORS.ASYLUM_GOLD as any)
                    .addFields(
                        { name: 'Members', value: `${stats.totalMembers}`, inline: true },
                        { name: 'Total Elo', value: `${stats.totalElo}`, inline: true },
                        { name: 'Total Games', value: `${stats.totalGames}`, inline: true },
                        { name: 'Best Player', value: `${stats.bestPlayer.username} (${stats.bestPlayer.elo} Elo)`, inline: false }
                    );

                if (stats.imageUrl) embed.setThumbnail(stats.imageUrl);

                await interaction.reply({ embeds: [embed] });

            } else if (subcommand === 'list') {
                const leaderboard = await clanManager.getLeaderboard();

                const embed = new EmbedBuilder()
                    .setTitle('🏆 Clan Leaderboard')
                    .setColor(COLORS.ASYLUM_GOLD as any)
                    .setDescription(leaderboard.map((c: any, i: number) => `${i + 1}. **${c.name}** - ${c.totalElo} pts (${c.memberCount} members)`).join('\n') || 'No clans yet.');

                await interaction.reply({ embeds: [embed] });




            }
        } catch (error: any) {
            console.error(error);
            await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
        }
    }
};
