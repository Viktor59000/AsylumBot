import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { ShopManager } from '../../managers/ShopManager';
import { COLORS, BOT_ICON } from '../../utils/constants';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const shopManager = new ShopManager();

export const command = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Asylum Shop System')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View available items in the shop')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('balance')
                .setDescription('Check your coin balance')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('buy')
                .setDescription('Buy an item')
                .addIntegerOption(option =>
                    option.setName('item_id').setDescription('The ID of the item to buy').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('add_role')
                .setDescription('Add a role to the shop (Admin only)')
                .addRoleOption(option =>
                    option.setName('role').setDescription('The role to sell').setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('price').setDescription('Price in coins').setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('name').setDescription('Display name of the item').setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('description').setDescription('Description of the item')
                )
        ),
    async execute(interaction: ChatInputCommandInteraction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'view') {
            const items = await shopManager.getItems();

            const embed = new EmbedBuilder()
                .setTitle('🛒 Asylum Shop')
                .setColor(COLORS.ASYLUM_GOLD as any)
                .setThumbnail(BOT_ICON)
                .setDescription('Use `/shop buy [id]` to purchase an item.');

            if (items.length === 0) {
                embed.addFields({ name: 'Empty', value: 'No items available yet.' });
            } else {
                items.forEach(item => {
                    embed.addFields({
                        name: `[#${item.id}] ${item.name} - 💰 ${item.price}`,
                        value: item.description || 'No description',
                        inline: false
                    });
                });
            }

            await interaction.reply({ embeds: [embed] });

        } else if (subcommand === 'balance') {
            const user = await prisma.user.findUnique({ where: { id: interaction.user.id } });
            const coins = user?.coins || 0;
            await interaction.reply({ content: `💰 You have **${coins} Coins**.` });

        } else if (subcommand === 'buy') {
            const itemId = interaction.options.getInteger('item_id', true);

            if (!interaction.guild) {
                await interaction.reply({ content: '❌ This command can only be used in a server.', ephemeral: true });
                return;
            }

            const result = await shopManager.buyItem(interaction.user.id, itemId, interaction.guild);

            if (result.success) {
                await interaction.reply({ content: `✅ Successfully purchased **${result.itemName}**! You now have ${result.remainingCoins} coins.` });
            } else {
                await interaction.reply({ content: `❌ Purchase failed: ${result.reason}`, ephemeral: true });
            }

        } else if (subcommand === 'add_role') {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
                await interaction.reply({ content: '❌ You need Administrator permissions.', ephemeral: true });
                return;
            }

            const role = interaction.options.getRole('role', true);
            const price = interaction.options.getInteger('price', true);
            const name = interaction.options.getString('name', true);
            const description = interaction.options.getString('description') || undefined;

            await shopManager.addItem(name, price, role.id, description);

            await interaction.reply({ content: `✅ Added **${name}** to the shop for **${price} Coins** (Role: ${role.name}).` });
        }
    },
};
