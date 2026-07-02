import { PrismaClient } from '@prisma/client';
import { ButtonInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, GuildMember } from 'discord.js';
import { COLORS, BOT_ICON } from '../utils/constants';

const prisma = new PrismaClient();

export class RoleMenuManager {
    constructor() { }

    async addOption(guildId: string, label: string, emoji: string, roleId: string) {
        return await prisma.roleMenuOption.create({
            data: {
                guildId,
                label,
                emoji,
                roleId
            }
        });
    }

    async getOptions(guildId: string) {
        return await prisma.roleMenuOption.findMany({
            where: { guildId }
        });
    }

    async postMenu(channel: TextChannel, imageUrl?: string) {
        const options = await this.getOptions(channel.guild.id);

        if (options.length === 0) {
            return { success: false, reason: 'No options configured. Use /role_menu add first.' };
        }

        const embed = new EmbedBuilder()
            .setTitle('🎮 CHOOSE YOUR BATTLEGROUNDS')
            .setDescription(
                "Bienvenue dans l'ASYLUM. Pour ne pas encombrer ton interface, les catégories de jeux sont masquées par défaut.\n\n" +
                "**Clique sur les boutons ci-dessous pour débloquer l'accès aux salons des jeux qui t'intéressent.**\n\n" +
                "*Tu peux cliquer à nouveau pour retirer le rôle et masquer la catégorie.*"
            )
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setThumbnail(BOT_ICON);

        if (imageUrl) {
            embed.setImage(imageUrl);
        }

        // Create Buttons (Max 5 per row)
        const components: ActionRowBuilder<ButtonBuilder>[] = [];
        let row = new ActionRowBuilder<ButtonBuilder>();

        options.forEach((option: any, index: number) => {
            if (index > 0 && index % 5 === 0) {
                components.push(row);
                row = new ActionRowBuilder<ButtonBuilder>();
            }
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`role_select_${option.roleId}`)
                    .setLabel(option.label)
                    .setEmoji(option.emoji)
                    .setStyle(ButtonStyle.Secondary)
            );
        });
        components.push(row);

        await channel.send({ embeds: [embed], components });
        return { success: true };
    }

    async handleInteraction(interaction: ButtonInteraction) {
        if (!interaction.customId.startsWith('role_select_')) return;

        const roleId = interaction.customId.replace('role_select_', '');
        const member = interaction.member as GuildMember;
        const role = interaction.guild?.roles.cache.get(roleId);

        if (!role) {
            await interaction.reply({ content: '❌ Role not found. Please contact an admin.', ephemeral: true });
            return;
        }

        try {
            if (member.roles.cache.has(roleId)) {
                // Remove Role
                await member.roles.remove(role);
                await interaction.reply({
                    content: `🗑️ **Accès retiré : ${role.name}**. La catégorie est maintenant masquée.`,
                    ephemeral: true
                });
            } else {
                // Add Role
                await member.roles.add(role);
                await interaction.reply({
                    content: `✅ **Accès débloqué : ${role.name}**. La catégorie est maintenant visible.`,
                    ephemeral: true
                });
            }
        } catch (error) {
            console.error('Role toggle failed:', error);
            await interaction.reply({ content: '❌ Failed to toggle role. Check bot permissions.', ephemeral: true });
        }
    }
}
