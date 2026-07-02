import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    Interaction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuOptionBuilder
} from 'discord.js';
import { prisma } from '../../utils/db';
import { GAME_CONFIGS, COLORS, BOT_ICON } from '../../utils/constants';

export const command = {
    data: new SlashCommandBuilder()
        .setName('set-profile')
        .setDescription('Launch the Interactive Profile Setup Wizard'),
    async execute(interaction: ChatInputCommandInteraction) {
        const embed = new EmbedBuilder()
            .setTitle('👤 Profile Setup Wizard')
            .setDescription('Configure your gaming profiles, link accounts, and set your preferences.\n\n**Supported Games:**\n' + Object.values(GAME_CONFIGS).map(g => `• ${g.name}`).join('\n'))
            .setColor(COLORS.ASYLUM_GOLD as any)
            .setThumbnail(BOT_ICON)
            .setFooter({ text: 'Click below to start' });

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('setprofile_start')
                    .setLabel('Start Setup')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('⚙️')
            );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
};

export const handleSetProfileInteraction = async (interaction: Interaction) => {
    // 1. Button: Start -> Game Selection
    if (interaction.isButton() && interaction.customId === 'setprofile_start') {
        const embed = new EmbedBuilder()
            .setTitle('🎮 Select Game')
            .setDescription('Which game do you want to configure?')
            .setColor(COLORS.ASYLUM_GOLD as any);

        const select = new StringSelectMenuBuilder()
            .setCustomId('setprofile_game')
            .setPlaceholder('Select a game...')
            .addOptions(
                Object.entries(GAME_CONFIGS).map(([key, config]) =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(config.name)
                        .setValue(key)
                        .setEmoji(config.emoji)
                )
            );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
        await interaction.update({ embeds: [embed], components: [row] });
        return;
    }

    // 2. Menu: Game Selected -> Action Selection (IGN or Attributes)
    // Actually simpler flow: IGN first, then Attributes.
    if (interaction.isStringSelectMenu() && interaction.customId === 'setprofile_game') {
        const game = interaction.values[0];
        const config = GAME_CONFIGS[game as keyof typeof GAME_CONFIGS];

        // Store game in customId for next steps? 
        // We can't easily pass state except via customId.
        // Let's ask for IGN via Button -> Modal.

        const embed = new EmbedBuilder()
            .setTitle(`${config.name} Setup`)
            .setDescription(`**Step 1:** Link your Account.\nPlease enter your in-game name exactly as it appears.`)
            .addFields({
                name: 'Format Examples',
                value: game === 'lol' ? 'Hide on bush#EUW' : (game === 'valorant' ? 'TenZ#NA1' : 'SteamID / Epic ID')
            })
            .setColor(COLORS.ASYLUM_GOLD as any);

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`setprofile_ign_btn_${game}`)
                    .setLabel('Enter IGN')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✏️')
            );

        await interaction.update({ embeds: [embed], components: [row] });
        return;
    }

    // 3. Button: Enter IGN -> Show Modal
    if (interaction.isButton() && interaction.customId.startsWith('setprofile_ign_btn_')) {
        const game = interaction.customId.split('_')[3];

        const modal = new ModalBuilder()
            .setCustomId(`setprofile_ign_modal_${game}`)
            .setTitle(`Link ${GAME_CONFIGS[game as keyof typeof GAME_CONFIGS]?.name || 'Account'}`);

        const input = new TextInputBuilder()
            .setCustomId('ign_input')
            .setLabel('In-Game Name (incl. Tag)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Name#Tag')
            .setRequired(true);

        const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
        modal.addComponents(row);

        await interaction.showModal(modal);
        return;
    }

    // 4. Modal Submit: Save IGN -> Ask Preferences
    if (interaction.isModalSubmit() && interaction.customId.startsWith('setprofile_ign_modal_')) {
        const game = interaction.customId.split('_')[3];
        const ign = interaction.fields.getTextInputValue('ign_input');

        // Save IGN
        await prisma.userIgn.upsert({
            where: {
                userId_game: {
                    userId: interaction.user.id,
                    game: game
                }
            },
            update: { ign },
            create: {
                userId: interaction.user.id,
                game,
                ign
            }
        });

        // Determine next step based on game
        // LoL: Roles
        // Valo: Agents (Class)
        // RL: Mode Preference?

        const config = GAME_CONFIGS[game as keyof typeof GAME_CONFIGS];

        const embed = new EmbedBuilder()
            .setTitle(`${config.name} Preferences`)
            .setDescription(`✅ Account **${ign}** linked!\n\n**Step 2:** Configure your gameplay preferences.`)
            .setColor(COLORS.ASYLUM_GOLD as any);

        let components: ActionRowBuilder<any>[] = [];

        if (game === 'lol') {
            const roles = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];
            const select = new StringSelectMenuBuilder()
                .setCustomId(`setprofile_pref_lol_main`)
                .setPlaceholder('Select Main Role')
                .addOptions(roles.map(r => ({ label: r, value: r })));

            components.push(new ActionRowBuilder().addComponents(select));
        }
        else if (game === 'valorant') {
            const agents = ['Duelist', 'Initiator', 'Controller', 'Sentinel'];
            const select = new StringSelectMenuBuilder()
                .setCustomId(`setprofile_pref_valo_class`)
                .setPlaceholder('Select Preferred Class')
                .addOptions(agents.map(a => ({ label: a, value: a })));
            components.push(new ActionRowBuilder().addComponents(select));
        }
        else if (game === 'rl') {
            const modes = ['1v1', '2v2', '3v3'];
            const select = new StringSelectMenuBuilder()
                .setCustomId(`setprofile_pref_rl_mode`)
                .setPlaceholder('Select Preferred Mode')
                .addOptions(modes.map(m => ({ label: m, value: m })));
            components.push(new ActionRowBuilder().addComponents(select));
        }
        else {
            // Generic finish
            await interaction.reply({ content: `✅ Setup complete for ${config.name}!`, ephemeral: true });
            return;
        }

        await interaction.reply({ embeds: [embed], components: components, ephemeral: true });
        return; // Modal replied
    }

    // 5. Select Preference -> Save -> Finish
    // We catch anything starting with setprofile_pref_
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('setprofile_pref_')) {
        const parts = interaction.customId.split('_'); // setprofile, pref, game, type
        const game = parts[2];
        const type = parts[3];
        const value = interaction.values[0];

        // Fetch existing preferences
        const userIgn = await prisma.userIgn.findUnique({
            where: {
                userId_game: {
                    userId: interaction.user.id,
                    game: game
                }
            }
        });

        let prefs: any = userIgn?.preferences ? JSON.parse(userIgn.preferences) : {};
        prefs[type] = value;

        await prisma.userIgn.update({
            where: {
                userId_game: {
                    userId: interaction.user.id,
                    game: game
                }
            },
            data: {
                preferences: JSON.stringify(prefs)
            }
        });

        // If LoL and we just set main, ask secondary? 
        // For simplicity, let's just confirm for now, or use a second dropdown if possible.
        // But we replied to the modal interaction. Updates here must be new messages or updates.

        await interaction.update({
            content: `✅ Preference **${type}** set to **${value}**. Setup Saved!`,
            embeds: [],
            components: []
        });
    }
};
