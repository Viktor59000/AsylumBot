import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Interaction,
    TextChannel,
    ColorResolvable,
    VoiceChannel
} from 'discord.js';
import { GameStrategy } from './GameStrategy';
import { LobbyState } from '../managers/LobbyManager';
import { prisma } from '../utils/db';
import { COLORS, BOT_ICON } from '../utils/constants';
import { AssetManager } from '../utils/AssetManager';
import { VoiceManager } from '../managers/VoiceManager';

export class RLStrategy implements GameStrategy {

    async onLobbyReady(lobby: LobbyState, channel: TextChannel): Promise<void> {
        // 1. Fetch IGNs
        const userIds = lobby.players.map(p => p.user.id);
        const igns = await prisma.userIgn.findMany({
            where: { userId: { in: userIds }, game: lobby.game }
        });
        const ignMap = new Map(igns.map(i => [i.userId, i.ign]));

        // 2. Generate Credentials
        const roomName = `ASYLUM${lobby.matchId}`;
        const roomPass = Math.random().toString(36).slice(-4).toUpperCase(); // Simple random pass

        // 3. Auto-Move Voice (Async)
        const guild = channel.guild;
        const voice1 = await guild.channels.fetch(lobby.voiceChannelId1) as VoiceChannel;
        const voice2 = await guild.channels.fetch(lobby.voiceChannelId2) as VoiceChannel;

        if (voice1) VoiceManager.moveUsersToChannel(lobby.team1, voice1);
        if (voice2) VoiceManager.moveUsersToChannel(lobby.team2, voice2);

        // 4. Build Embed
        const embed = new EmbedBuilder()
            .setTitle(`🏟️ Match Lobby #${lobby.matchId}`)
            .setDescription(`**Mode:** ${lobby.mode}\n**Auto-Move:** Voice channels engaged.\n\nCreating Private Match...`)
            .setColor(COLORS.ASYLUM_GOLD as ColorResolvable)
            .setThumbnail(BOT_ICON)
            .addFields(
                { name: '🔑 Room Name', value: `\`${roomName}\``, inline: true },
                { name: '🔒 Password', value: `\`${roomPass}\``, inline: true },
                {
                    name: '🔵 Blue',
                    value: lobby.team1.map(u => `\`${ignMap.get(u.id) || u.username}\``).join('\n') || 'TBD',
                    inline: true
                },
                {
                    name: '🟠 Orange',
                    value: lobby.team2.map(u => `\`${ignMap.get(u.id) || u.username}\``).join('\n') || 'TBD',
                    inline: true
                }
            )
            .setFooter({ text: 'ASYLUM ELO SYSTEM', iconURL: BOT_ICON });

        // 5. Attach Banner
        const files: AttachmentBuilder[] = [];
        const bannerPath = AssetManager.getAssetPath(lobby.game, 'live_banner');
        if (bannerPath) {
            const name = bannerPath.split(/[\\/]/).pop()!;
            embed.setImage(`attachment://${name}`);
            files.push(new AttachmentBuilder(bannerPath, { name }));
        }

        // 6. Check-in Button
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('rl_checkin')
                    .setLabel('I am in the Lobby')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('🙋‍♂️')
            );

        const msg = await channel.send({ embeds: [embed], components: [row], files });
        await msg.pin().catch(() => { });

        // Mention players
        const mentions = lobby.players.map(p => `<@${p.user.id}>`).join(' ');
        await channel.send({ content: `🔔 Match is ready! Voice channels set. ${mentions}` });
    }

    async handleInteraction(interaction: Interaction, lobby: LobbyState): Promise<void> {
        if (!interaction.isButton()) return;

        if (interaction.customId === 'rl_checkin') {
            await interaction.reply({ content: `✅ **${interaction.user.username}** is ready.`, ephemeral: false });
            // Could add logic to track how many checked in and ping missing ones.
        }
    }
}
