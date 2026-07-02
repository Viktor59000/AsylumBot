import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { COLORS } from '../../utils/constants';

export const command = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands'),
    async execute(interaction: ChatInputCommandInteraction) {
        const embed = new EmbedBuilder()
            .setTitle('📚 ASYLUM-BOT Commands')
            .setDescription('Complete command reference for the ASYLUM ELO HUB.\n**Tip:** You must set your IGN with `/ign` before joining any queue!')
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setThumbnail('https://i.imgur.com/AfFp7pu.png')
            .addFields(
                {
                    name: '👤 Player Commands',
                    value: [
                        '`/ign game:<game> pseudo:<name>` - **Required!** Set your In-Game Name before queueing',
                        '`/queue view game:<game>` - View queue and join/leave with buttons',
                        '`/queue force_leave` - Emergency: Leave all queues and reset status',
                        '`/stats [member] [game]` - View player stats and match history',
                        '`/profile [user]` - View detailed player profile',
                        '`/leaderboard [game]` - View top 20 players ranking',
                        '`/setprofile` - Customize your profile card',
                    ].join('\n'),
                },
                {
                    name: '⚔️ Match Commands',
                    value: [
                        '`/report match_id:<id>` - Report match results (Updates Elo)',
                        '**[Spectate]** button - Watch ongoing matches (in match channels)',
                    ].join('\n'),
                },
                {
                    name: '🎮 Queue Features',
                    value: [
                        '**Join Queue** - Click to join the queue',
                        '**Leave Queue** - Click to leave the queue',
                        '**Party Invite** - Invite friends to queue together (Duo/Trio)',
                        '**AFK Check** - Auto-warning after 15min, kicked after 20min',
                    ].join('\n'),
                },
                {
                    name: '🛠️ Admin Commands',
                    value: [
                        '`/setup` - Launch setup wizard to create game channels',
                        '`/config` - Configure game settings (region, mode, channels)',
                        '`/queue force_start game:<game>` - Force start match with current players',
                        '`/kick user:<user> game:<game>` - Remove player from queue',
                        '`/cancel match_id:<id>` - Cancel match and cleanup channels',
                        '`/sub match_id:<id> old:<user> new:<user>` - Substitute player',
                        '`/mmr user:<user> game:<game> amount:<#>` - Adjust player Elo',
                        '`/suspend user:<user> duration:<hours>` - Ban from queues',
                        '`/season end name:<name>` - End season and archive stats',
                        '`/language set language:<lang>` - Set server language',
                    ].join('\n'),
                }
            )
            .setFooter({ text: 'ASYLUM ELO HUB • v1.1 | Arena Mode & Spectating Available', iconURL: 'https://i.imgur.com/AfFp7pu.png' });

        await interaction.reply({ embeds: [embed] });
    },
};
