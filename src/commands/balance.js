import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getProfile, seenAs } from '../db.js';
import { MAX_LEVEL, MAX_PRESTIGE, formatTitleWithPrestige, levelFromXp, prestigeMultiplier, progressBar, tierColorFor, tierEmojiFor } from '../game/levels.js';

export default {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your chips, level, and progress'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    seenAs(userId, username);
    const profile = getProfile(userId);
    const { level, xpInLevel, xpForNext, isMaxLevel } = levelFromXp(profile.xp, profile.prestige);
    const title = formatTitleWithPrestige(level, profile.prestige);
    const tierEmoji = tierEmojiFor(level);
    const color = tierColorFor(level);
    const multiplier = prestigeMultiplier(profile.prestige);

    const embed = new EmbedBuilder()
      .setTitle(`${tierEmoji}  ${title}`)
      .setColor(color)
      .setFooter({ text: username });

    embed.addFields(
      { name: 'Chips', value: `**${profile.chips.toLocaleString()}**`, inline: true },
      {
        name: 'Level',
        value: `**${level}**/${MAX_LEVEL}`,
        inline: true,
      },
      {
        name: 'Prestige',
        value: profile.prestige > 0
          ? `**★${profile.prestige}**/${MAX_PRESTIGE}  *(${multiplier}× XP)*`
          : '—',
        inline: true,
      },
      {
        name: isMaxLevel ? 'Progress' : `Progress to ${level + 1}`,
        value: '`' + progressBar({ xpInLevel, xpForNext, isMaxLevel }) + '`',
      },
    );

    if (isMaxLevel && profile.prestige < MAX_PRESTIGE) {
      embed.addFields({ name: '​', value: '⭐ You\'ve reached max level. Use `/prestige` to ascend — but the next climb is steeper.' });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
