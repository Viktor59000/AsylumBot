import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';

export interface Command {
    data: SlashCommandBuilder | any; // using any for now to avoid complex typing issues with builders
    execute: (interaction: ChatInputCommandInteraction) => Promise<any>;
}
