import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    Interaction,
    TextChannel,
    ColorResolvable
} from 'discord.js';
import { GameStrategy } from './GameStrategy';
import { LobbyState } from '../managers/LobbyManager';
import { prisma } from '../utils/db';
import { COLORS, BOT_ICON } from '../utils/constants';
import { AssetManager } from '../utils/AssetManager';
import { DraftLoLManager } from '../managers/DraftLoLManager';

export class LoLStrategy implements GameStrategy {

    async onLobbyReady(lobby: LobbyState, channel: TextChannel): Promise<void> {
        // 1. Fetch Data (Regions, IGNs)
        const dbConfig = await prisma.gameConfig.findFirst({
            where: { game: lobby.game, guildId: channel.guild.id }
        });
        const region = dbConfig?.region || 'EUW';

        const userIds = lobby.players.map(p => p.user.id);
        const igns = await prisma.userIgn.findMany({
            where: { userId: { in: userIds }, game: lobby.game }
        });
        const ignMap = new Map(igns.map(i => [i.userId, i.ign]));

        // 2. Generate Links
        const draftLink = DraftLoLManager.createDraftLink('Team Blue', 'Team Red');
        const summoners = igns.map(i => encodeURIComponent(i.ign.replace('#', '-'))).join('%2C');
        const opggLink = `https://www.op.gg/multisearch/${region.toLowerCase()}?summoners=${summoners}`;

        // 3. Build Embed
        const embed = new EmbedBuilder()
            .setTitle(`🏟️ Match Lobby #${lobby.matchId}`)
            .setDescription(`**Region:** ${region}\n**Mode:** ${lobby.mode}\n\n**Match Ready!** Check the links below to start your draft and scout opponents.`)
            .setColor(COLORS.ASYLUM_GOLD as ColorResolvable)
            .setThumbnail(BOT_ICON)
            .addFields(
                {
                    name: '🔵 Team Blue',
                    value: lobby.team1.map(u => `\`${ignMap.get(u.id) || u.username}\``).join('\n') || 'TBD',
                    inline: true
                },
                {
                    name: '🔴 Team Red',
                    value: lobby.team2.map(u => `\`${ignMap.get(u.id) || u.username}\``).join('\n') || 'TBD',
                    inline: true
                },
                {
                    name: '⚔️ Tools',
                    value: `[**Draft Phase**](${draftLink}) • [**OP.GG Multi**](${opggLink})`,
                    inline: false
                }
            )
            .setFooter({ text: 'ASYLUM ELO SYSTEM', iconURL: BOT_ICON });

        // 4. Attach Banner
        const files: AttachmentBuilder[] = [];
        const bannerPath = AssetManager.getBanner(lobby.game, lobby.queueMode, 'live_banner');
        if (bannerPath) {
            const name = bannerPath.split(/[\\/]/).pop()!;
            embed.setImage(`attachment://${name}`);
            files.push(new AttachmentBuilder(bannerPath, { name }));
        }

        // 5. Send lobby embed (report controls are posted by ReportManager)
        const msg = await channel.send({ embeds: [embed], files });
        await msg.pin().catch(() => { });

        // Mention players
        const mentions = lobby.players.map(p => `<@${p.user.id}>`).join(' ');
        await channel.send({ content: `🔔 Match is ready! ${mentions}` });
    }

    async handleInteraction(interaction: Interaction, lobby: LobbyState): Promise<void> {
        // Reporting is handled globally by ReportManager.
    }
}
