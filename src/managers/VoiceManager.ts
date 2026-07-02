import { Guild, ChannelType, CategoryChannel, VoiceChannel, PermissionsBitField, User } from 'discord.js';

export class VoiceManager {
    static async createMatchChannels(guild: Guild, gameName: string, matchId: number, team1: User[], team2: User[]) {
        // Find or create category
        let category = guild.channels.cache.find(
            (c) => c.type === ChannelType.GuildCategory && c.name === 'ASYLUM MATCHES'
        ) as CategoryChannel;

        if (!category) {
            category = await guild.channels.create({
                name: 'ASYLUM MATCHES',
                type: ChannelType.GuildCategory,
            });
        }

        // Create Team A Channel
        const channelA = await guild.channels.create({
            name: `${gameName} #${matchId} - Team A`,
            type: ChannelType.GuildVoice,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionsBitField.Flags.Connect], // Deny everyone
                },
                ...team1.map((user) => ({
                    id: user.id,
                    allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak],
                })),
            ],
        });

        // Create Team B Channel
        const channelB = await guild.channels.create({
            name: `${gameName} #${matchId} - Team B`,
            type: ChannelType.GuildVoice,
            parent: category.id,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionsBitField.Flags.Connect], // Deny everyone
                },
                ...team2.map((user) => ({
                    id: user.id,
                    allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak],
                })),
            ],
        });

        return [channelA, channelB];
    }

    static async deleteChannels(channels: VoiceChannel[]) {
        for (const channel of channels) {
            try {
                await channel.delete();
            } catch (error) {
                console.error(`Failed to delete channel ${channel.name}:`, error);
            }
        }
    }

    static async moveUsersToChannel(users: User[], channel: VoiceChannel) {
        for (const user of users) {
            const member = await channel.guild.members.fetch(user.id).catch(() => null);
            if (member && member.voice.channel) {
                try {
                    await member.voice.setChannel(channel);
                } catch (error) {
                    console.log(`Could not move user ${user.username}: ${error}`);
                }
            }
        }
    }
}
