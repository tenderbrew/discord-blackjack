import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getBalance } from '../db.js';

export default {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your chip balance'),
  async execute(interaction) {
    const balance = getBalance(interaction.user.id);
    await interaction.reply({
      content: `**${interaction.user.username}** has **${balance}** chips.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
