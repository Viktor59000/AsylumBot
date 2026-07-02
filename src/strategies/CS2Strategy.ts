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
import { vetoManager } from '../managers/VetoManager';

export class CS2Strategy implements GameStrategy {

    async onLobbyReady(lobby: LobbyState, channel: TextChannel): Promise<void> {
        // 1. Fetch IGNs
        const userIds = lobby.players.map(p => p.user.id);
        const igns = await prisma.userIgn.findMany({
            where: { userId: { in: userIds }, game: lobby.game }
        });
        const ignMap = new Map(igns.map(i => [i.userId, i.ign]));

        // 2. Build Basic Lobby Embed
        const embed = new EmbedBuilder()
            .setTitle(`🏟️ Match Lobby #${lobby.matchId}`)
            .setDescription(`**Mode:** ${lobby.mode}\n\n**Connect:** \`connect server.asylum.gg:27015\` (Example)\n**Map:** To be decided via Veto.`)
            .setColor(COLORS.ASYLUM_GOLD as ColorResolvable)
            .setThumbnail(BOT_ICON)
            .addFields(
                {
                    name: '🔵 Team Blue (CT Start)',
                    value: lobby.team1.map(u => `\`${ignMap.get(u.id) || u.username}\``).join('\n') || 'TBD',
                    inline: true
                },
                {
                    name: '🔴 Team Red (T Start)',
                    value: lobby.team2.map(u => `\`${ignMap.get(u.id) || u.username}\``).join('\n') || 'TBD',
                    inline: true
                }
            )
            .setFooter({ text: 'ASYLUM ELO SYSTEM', iconURL: BOT_ICON });

        // 3. Attach Banner
        const files: AttachmentBuilder[] = [];
        const bannerPath = AssetManager.getAssetPath(lobby.game, 'live_banner');
        if (bannerPath) {
            const name = bannerPath.split(/[\\/]/).pop()!;
            embed.setImage(`attachment://${name}`);
            files.push(new AttachmentBuilder(bannerPath, { name }));
        }

        const msg = await channel.send({ embeds: [embed], files });
        await msg.pin().catch(() => { });

        // 4. Start Veto
        await vetoManager.startVeto(lobby, channel);

        // Mention players
        const mentions = lobby.players.map(p => `<@${p.user.id}>`).join(' ');
        await channel.send({ content: `🔔 Match is ready! Captains, please proceed with Map Veto. ${mentions}` });
    }

    async handleInteraction(interaction: Interaction, lobby: LobbyState): Promise<void> {
        // Delegate to VetoManager
        if (interaction.isStringSelectMenu() && interaction.customId === 'veto_ban') {
            await vetoManager.handleInteraction(interaction);
        }
    }
}
