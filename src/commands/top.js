import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { dayKey } from '../game/rng.js';
import { getAllTimeTop, getDailyTop, getPeriodTop } from '../db.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export default {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Daily run leaderboard')
    .addStringOption(opt =>
      opt.setName('period')
        .setDescription('Time period (default: today)')
        .addChoices(
          { name: 'Today', value: 'day' },
          { name: 'Past 7 days', value: 'week' },
          { name: 'Past 30 days', value: 'month' },
          { name: 'All time', value: 'all' },
        )),

  async execute(interaction) {
    const period = interaction.options.getString('period') ?? 'day';
    const today = dayKey();
    let rows;
    let title;

    if (period === 'day') {
      rows = getDailyTop(today, 10);
      title = `Daily Run Leaderboard — ${today}`;
    } else if (period === 'week') {
      const since = subtractDays(today, 6);
      rows = getPeriodTop(since, 10);
      title = `Past 7 Days (since ${since})`;
    } else if (period === 'month') {
      const since = subtractDays(today, 29);
      rows = getPeriodTop(since, 10);
      title = `Past 30 Days (since ${since})`;
    } else {
      rows = getAllTimeTop(10);
      title = 'All-Time Leaderboard';
    }

    const embed = new EmbedBuilder().setTitle(title).setColor(0xfee75c);

    if (rows.length === 0) {
      embed.setDescription('No runs yet. Be the first — `/run`.');
    } else {
      const lines = rows.map((r, i) => {
        const rankLabel = MEDALS[i] ?? `\`#${String(i + 1).padStart(2, ' ')}\``;
        const score = period === 'day' ? r.final_chips : r.best;
        const hands = period === 'day' ? r.hands_played : r.fewest_hands;
        return `${rankLabel}  **${r.username}** — ${score} chips (${hands} hand${hands === 1 ? '' : 's'})`;
      });
      embed.setDescription(lines.join('\n'));
    }

    await interaction.reply({ embeds: [embed] });
  },
};

function subtractDays(dayStr, n) {
  const d = new Date(dayStr + 'T00:00:00');
  d.setDate(d.getDate() - n);
  return dayKey(d);
}
