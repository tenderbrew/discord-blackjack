import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getProfile, prestigePlayer, seenAs } from '../db.js';
import { MAX_LEVEL, MAX_PRESTIGE, formatTitleWithPrestige, levelFromXp, tierColorFor, tierEmojiFor, titleFor } from '../game/levels.js';

export default {
  data: new SlashCommandBuilder()
    .setName('prestige')
    .setDescription('Ascend: reset to level 1 and gain a prestige star (requires max level)'),

  async execute(interaction) {
    const userId = interaction.user.id;
    seenAs(userId, interaction.user.username);
    const profile = getProfile(userId);
    const { level, isMaxLevel } = levelFromXp(profile.xp);

    if (!isMaxLevel) {
      await interaction.reply({
        content: `You must reach level ${MAX_LEVEL} (**${titleFor(MAX_LEVEL)}**) to prestige. You're level **${level}** (${titleFor(level)}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (profile.prestige >= MAX_PRESTIGE) {
      await interaction.reply({
        content: `You've reached the maximum prestige (★${MAX_PRESTIGE}). There's nowhere left to climb. Take a bow.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nextPrestige = profile.prestige + 1;
    const embed = new EmbedBuilder()
      .setTitle('Ascend?')
      .setColor(tierColorFor(MAX_LEVEL))
      .setDescription([
        `You are currently **${formatTitleWithPrestige(MAX_LEVEL, profile.prestige)}**.`,
        ``,
        `Ascending will reset you to **Level 1** (${tierEmojiFor(1)} ${titleFor(1)}) but mark you with **★${nextPrestige}** for the climb to come.`,
        ``,
        `Your chips and daily-run history are untouched.`,
      ].join('\n'));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prestige:yes').setLabel('Ascend').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('prestige:no').setLabel('Not yet').setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  },

  async handleButton(interaction) {
    const action = interaction.customId.split(':')[1];
    if (action === 'no') {
      await interaction.update({ content: 'Ascension cancelled. Take your time.', embeds: [], components: [] });
      return;
    }

    const userId = interaction.user.id;
    const profile = getProfile(userId);
    const { isMaxLevel } = levelFromXp(profile.xp);
    if (!isMaxLevel || profile.prestige >= MAX_PRESTIGE) {
      await interaction.update({ content: 'You\'re no longer eligible to ascend.', embeds: [], components: [] });
      return;
    }

    prestigePlayer(userId);
    const after = getProfile(userId);

    await interaction.update({
      content: `🎉  Ascended to **★${after.prestige}**.`,
      embeds: [],
      components: [],
    });

    await interaction.followUp({
      content: [
        `⭐ <@${userId}> has **ascended** to **★${after.prestige}** ${tierEmojiFor(1)} ${titleFor(1)}.`,
        `The climb begins again — but the world remembers.`,
      ].join('\n'),
    });
  },
};
