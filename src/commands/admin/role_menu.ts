import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, TextChannel } from 'discord.js';
import { getManagers } from '../../managers/registry';

export const command = {
    data: new SlashCommandBuilder()
        .setName('role_menu')
        .setDescription('Manage the Role Picker Menu')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a role option to the menu')
                .addStringOption(option =>
                    option.setName('label').setDescription('Label for the button').setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('emoji').setDescription('Emoji for the button').setRequired(true)
                )
                .addRoleOption(option =>
                    option.setName('role').setDescription('Role to assign').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('post')
                .setDescription('Post the Role Menu in a channel')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('Channel to post in').setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('image_url').setDescription('Optional banner image URL')
                )
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const label = interaction.options.getString('label', true);
            const emoji = interaction.options.getString('emoji', true);
            const role = interaction.options.getRole('role', true);

            if (!interaction.guildId) return;

            await getManagers().roleMenu.addOption(interaction.guildId, label, emoji, role.id);
            await interaction.reply({ content: `✅ Added option: **${label}** ${emoji} -> ${role.name}`, ephemeral: true });

        } else if (subcommand === 'post') {
            const channel = interaction.options.getChannel('channel', true) as TextChannel;
            const imageUrl = interaction.options.getString('image_url') || undefined;

            if (!channel.isTextBased()) {
                await interaction.reply({ content: '❌ Invalid channel type.', ephemeral: true });
                return;
            }

            const result = await getManagers().roleMenu.postMenu(channel, imageUrl);

            if (result.success) {
                await interaction.reply({ content: `✅ Role Menu posted in <#${channel.id}>.`, ephemeral: true });
            } else {
                await interaction.reply({ content: `❌ Failed: ${result.reason}`, ephemeral: true });
            }
        }
    },
};
