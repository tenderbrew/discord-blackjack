import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { dayKey } from '../game/rng.js';
import {
  getAllTimeTop, getDailyTop, getPeriodTop,
  getTopBiggest, getTopChips, getTopLevel, getTopWagered,
  seenAs,
} from '../db.js';
import { formatTitleWithPrestige, levelFromXp, tierEmojiFor } from '../game/levels.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export default {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Leaderboards')
    .addStringOption(opt =>
      opt.setName('kind')
        .setDescription('What to rank (default: daily runs)')
        .addChoices(
          { name: 'Daily runs', value: 'runs' },
          { name: 'Current chips', value: 'chips' },
          { name: 'Level / prestige', value: 'level' },
          { name: 'Lifetime wagered', value: 'wagered' },
          { name: 'Biggest single hand', value: 'biggest' },
        ))
    .addStringOption(opt =>
      opt.setName('period')
        .setDescription('Time period (only used with kind=runs; default: today)')
        .addChoices(
          { name: 'Today', value: 'day' },
          { name: 'Past 7 days', value: 'week' },
          { name: 'Past 30 days', value: 'month' },
          { name: 'All time', value: 'all' },
        )),

  async execute(interaction) {
    seenAs(interaction.user.id, interaction.user.username);
    const kind = interaction.options.getString('kind') ?? 'runs';
    const period = interaction.options.getString('period') ?? 'day';

    let rows = [];
    let header = '';
    let formatLine;

    if (kind === 'runs') {
      const today = dayKey();
      if (period === 'day') {
        rows = getDailyTop(today, 10);
        header = `Daily Run Leaderboard — ${today}`;
      } else if (period === 'week') {
        const since = subtractDays(today, 6);
        rows = getPeriodTop(since, 10);
        header = `Past 7 Days (since ${since})`;
      } else if (period === 'month') {
        const since = subtractDays(today, 29);
        rows = getPeriodTop(since, 10);
        header = `Past 30 Days (since ${since})`;
      } else {
        rows = getAllTimeTop(10);
        header = 'All-Time Run Leaderboard';
      }
      formatLine = (r) => {
        const score = period === 'day' ? r.final_chips : r.best;
        const hands = period === 'day' ? r.hands_played : r.fewest_hands;
        return `**${r.username}** — ${score} chips (${hands} hand${hands === 1 ? '' : 's'})`;
      };
    } else if (kind === 'chips') {
      rows = getTopChips(10);
      header = '💰 Chip Leaderboard';
      formatLine = (r) => `**${r.username}** — ${r.chips.toLocaleString()} chips`;
    } else if (kind === 'level') {
      rows = getTopLevel(10);
      header = '🏰 Level Leaderboard';
      formatLine = (r) => {
        const { level } = levelFromXp(r.xp, r.prestige);
        const title = formatTitleWithPrestige(level, r.prestige);
        return `${tierEmojiFor(level)}  **${r.username}** — ${title}  *(L${level})*`;
      };
    } else if (kind === 'wagered') {
      rows = getTopWagered(10);
      header = '🎲 Lifetime Wagered';
      formatLine = (r) => `**${r.username}** — ${r.lifetime_wagered.toLocaleString()} chips`;
    } else if (kind === 'biggest') {
      rows = getTopBiggest(10);
      header = '🎉 Biggest Single Hand';
      formatLine = (r) => `**${r.username}** — +${r.biggest_win.toLocaleString()} chips`;
    }

    const embed = new EmbedBuilder().setTitle(header).setColor(0xfee75c);
    if (rows.length === 0) {
      embed.setDescription(noResultsMessage(kind));
    } else {
      const lines = rows.map((r, i) => {
        const rank = MEDALS[i] ?? `\`#${String(i + 1).padStart(2, ' ')}\``;
        return `${rank}  ${formatLine(r)}`;
      });
      embed.setDescription(lines.join('\n'));
    }

    await interaction.reply({ embeds: [embed] });
  },
};

function noResultsMessage(kind) {
  if (kind === 'runs') return 'No runs yet. Be the first — `/run`.';
  if (kind === 'wagered' || kind === 'biggest') return 'No hands played yet. Try `/blackjack`.';
  return 'No players have interacted yet.';
}

function subtractDays(dayStr, n) {
  const d = new Date(dayStr + 'T00:00:00');
  d.setDate(d.getDate() - n);
  return dayKey(d);
}
