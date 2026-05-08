import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getStats } from '../db.js';
import { formatTitleWithPrestige, levelFromXp, tierColorFor, tierEmojiFor } from '../game/levels.js';

export default {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Career stats for solo /blackjack')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription("Whose stats to look up (defaults to you)")),

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const s = getStats(target.id);
    const { level } = levelFromXp(s.xp);
    const title = formatTitleWithPrestige(level, s.prestige);

    const decided = s.hands_won + s.hands_lost + s.hands_pushed;
    const winRate = decided > 0 ? ((s.hands_won / decided) * 100).toFixed(1) : '—';
    const netPL = s.lifetime_won - s.lifetime_lost;
    const sign = netPL > 0 ? '+' : netPL < 0 ? '−' : '';

    const embed = new EmbedBuilder()
      .setTitle(`${tierEmojiFor(level)}  ${title}`)
      .setColor(tierColorFor(level))
      .setDescription(`**Lifetime net:**  ${sign}${Math.abs(netPL).toLocaleString()} chips`)
      .setFooter({ text: target.username });

    embed.addFields(
      { name: 'Hands played', value: `**${s.hands_played.toLocaleString()}**`, inline: true },
      { name: 'Win rate', value: `**${winRate}${decided > 0 ? '%' : ''}**`, inline: true },
      { name: 'Blackjacks', value: `**${s.hands_blackjack.toLocaleString()}**`, inline: true },
      { name: 'Wins', value: s.hands_won.toLocaleString(), inline: true },
      { name: 'Losses', value: s.hands_lost.toLocaleString(), inline: true },
      { name: 'Pushes', value: s.hands_pushed.toLocaleString(), inline: true },
      { name: 'Biggest win', value: s.biggest_win > 0 ? `+${s.biggest_win.toLocaleString()}` : '—', inline: true },
      { name: 'Biggest loss', value: s.biggest_loss > 0 ? `−${s.biggest_loss.toLocaleString()}` : '—', inline: true },
      { name: 'Wagered', value: s.lifetime_wagered.toLocaleString(), inline: true },
    );

    await interaction.reply({ embeds: [embed] });
  },
};
