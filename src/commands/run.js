import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import * as run from '../game/run.js';
import { MIN_BET, STARTING_BANKROLL } from '../game/run.js';
import { dayKey } from '../game/rng.js';
import { canDouble, canSplit } from '../game/blackjack.js';
import { buildGameImage } from '../game/imageRender.js';
import { getTodayRun, recordRun, rankInDay, getUserStreak } from '../db.js';

const activeRuns = new Map();

export default {
  data: new SlashCommandBuilder()
    .setName('run')
    .setDescription("Play today's daily run — 10 hands, fixed bankroll, same shuffle for everyone"),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const day = dayKey();

    const existing = getTodayRun(userId, day);
    if (existing) {
      const rank = rankInDay(userId, day);
      const streak = getUserStreak(userId);
      await interaction.reply({
        content: [
          `You already played today's run.`,
          `**Score:** ${existing.final_chips} chips in ${existing.hands_played} hand${existing.hands_played === 1 ? '' : 's'}`,
          `**Rank today:** #${rank}`,
          `**Streak:** ${streak.current} day${streak.current === 1 ? '' : 's'} (best ${streak.best})`,
          ``,
          `Come back tomorrow for a new daily run.`,
        ].join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const r = run.startRun(userId, username, day);
    await interaction.editReply(await buildRunMessage(r));
    const message = await interaction.fetchReply();
    activeRuns.set(message.id, r);
  },

  async handleButton(interaction) {
    const messageId = interaction.message.id;
    const r = activeRuns.get(messageId);
    if (!r) {
      await interaction.reply({
        content: 'This run has expired (bot may have restarted). Start a new one with `/run`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (interaction.user.id !== r.userId) {
      await interaction.reply({ content: "This isn't your run.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferUpdate();

    const parts = interaction.customId.split(':');
    const action = parts[1];

    // "Next hand" advances the run AND posts a fresh message for the next phase,
    // freezing the current post-hand message in place as a historical record.
    if (action === 'next') {
      await interaction.editReply(await buildRunMessage(r, { frozen: true }));
      run.continueAfterHand(r);
      if (r.phase === 'done') {
        recordRun(r.userId, r.username, r.day, r.bankroll, r.handsPlayed);
      }
      const newMsg = await interaction.followUp(await buildRunMessage(r));
      activeRuns.delete(messageId);
      if (r.phase !== 'done') {
        activeRuns.set(newMsg.id, r);
      }
      return;
    }

    if (action === 'bet') {
      const bet = parseInt(parts[2], 10);
      run.placeBet(r, bet);
    } else if (action === 'hit') {
      run.runHit(r);
    } else if (action === 'stand') {
      run.runStand(r);
    } else if (action === 'double') {
      run.runDouble(r);
    } else if (action === 'split') {
      run.runSplit(r);
    }

    await interaction.editReply(await buildRunMessage(r));
  },
};

function handIcon(entry) {
  if (entry.outcomes.length === 1) {
    if (entry.outcomes[0] === 'blackjack') return '🎉';
    if (entry.outcomes[0] === 'bust') return '💥';
  }
  if (entry.net > 0) return '✅';
  if (entry.net < 0) return '❌';
  return '➖';
}

function historyStrip(r) {
  const slots = [];
  for (let i = 0; i < r.maxHands; i++) {
    slots.push(i < r.history.length ? handIcon(r.history[i]) : '·');
  }
  return slots.join('  ');
}

function lastHandResultText(r) {
  const e = r.history[r.history.length - 1];
  if (!e) return '';
  const abs = Math.abs(e.net);
  if (e.outcomes.length === 1) {
    const o = e.outcomes[0];
    if (o === 'blackjack') return `🎉 **Blackjack!**  +${abs} chips`;
    if (o === 'win') return `✅ **You win!**  +${abs} chips`;
    if (o === 'push') return `➖ **Push** — bet returned`;
    if (o === 'loss') return `❌ **Dealer wins.**  −${abs} chips`;
    if (o === 'bust') return `💥 **Bust!**  −${abs} chips`;
    if (o === 'dealer_blackjack') return `❌ **Dealer blackjack.**  −${abs} chips`;
  }
  const tag = { win: '✅', push: '➖', loss: '❌', bust: '💥', blackjack: '🎉' };
  const labels = e.outcomes.map((o, i) => `H${i + 1} ${tag[o] ?? '?'}`);
  const sign = e.net > 0 ? '+' : e.net < 0 ? '−' : '';
  return `${labels.join('  ·  ')}\n**Net:** ${sign}${abs} chips`;
}

async function buildRunMessage(r, { frozen = false } = {}) {
  const embed = new EmbedBuilder().setTitle('🂡 Daily Run').setColor(getColor(r));

  if (r.phase === 'awaiting-bet') {
    const lines = [
      `**Bankroll** ${r.bankroll}  ·  **Hand** ${r.handsPlayed + 1}/${r.maxHands}  ·  **Day** ${r.day}`,
      historyStrip(r),
    ];
    if (r.history.length > 0) {
      lines.push('', lastHandResultText(r));
    }
    lines.push('', `Place your bet for hand ${r.handsPlayed + 1}.`);
    embed.setDescription(lines.join('\n'));
    return { embeds: [embed], components: [buildBetButtons(r)], files: [] };
  }

  if (r.phase === 'in-hand') {
    embed.setDescription([
      `**Bankroll** ${r.bankroll}  ·  **Hand** ${r.handsPlayed + 1}/${r.maxHands}`,
      historyStrip(r),
    ].join('\n'));
    const showHole = r.currentGame.phase !== 'player';
    const imageBuf = await buildGameImage(r.currentGame, { hideHole: !showHole });
    const attachment = new AttachmentBuilder(imageBuf, { name: 'hand.png' });
    embed.setImage('attachment://hand.png');
    const components = r.currentGame.phase === 'player' ? [buildHandButtons(r)] : [];
    return { embeds: [embed], components, files: [attachment] };
  }

  if (r.phase === 'post-hand') {
    const willEnd = r.handsPlayed >= r.maxHands || r.bankroll < MIN_BET;
    embed.setDescription([
      `**Hand ${r.handsPlayed} result**  ·  **Bankroll** ${r.bankroll}`,
      historyStrip(r),
      ``,
      lastHandResultText(r),
    ].join('\n'));
    const imageBuf = await buildGameImage(r.currentGame, { hideHole: false });
    const attachment = new AttachmentBuilder(imageBuf, { name: 'hand.png' });
    embed.setImage('attachment://hand.png');
    if (frozen) {
      return { embeds: [embed], components: [], files: [attachment] };
    }
    const nextLabel = willEnd ? 'See final score' : `Next hand (${r.handsPlayed + 1}/${r.maxHands})`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('run:next').setLabel(nextLabel).setStyle(ButtonStyle.Primary),
    );
    return { embeds: [embed], components: [row], files: [attachment] };
  }

  // done
  const rank = rankInDay(r.userId, r.day);
  const streak = getUserStreak(r.userId);
  const delta = r.bankroll - STARTING_BANKROLL;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  embed.setDescription([
    `**Final score:** ${r.bankroll} chips (${sign}${Math.abs(delta)} from start)`,
    historyStrip(r),
    ``,
    `**Hands played:** ${r.handsPlayed}/${r.maxHands}`,
    `**Rank today:** #${rank ?? '?'}`,
    `**Streak:** ${streak.current} day${streak.current === 1 ? '' : 's'} (best ${streak.best})`,
    ``,
    `Come back tomorrow for a new daily run. \`/top\` to see the leaderboard.`,
  ].join('\n'));
  return { embeds: [embed], components: [], files: [] };
}

function buildBetButtons(r) {
  const row = new ActionRowBuilder();
  const candidates = [10, 50, 100, 250, r.bankroll];
  const valid = [...new Set(candidates.filter(v => v >= MIN_BET && v <= r.bankroll))].sort((a, b) => a - b);
  for (const v of valid.slice(0, 5)) {
    const isAllIn = v === r.bankroll;
    const label = isAllIn ? `All-in (${v})` : `${v}`;
    const style = isAllIn ? ButtonStyle.Danger : ButtonStyle.Primary;
    row.addComponents(new ButtonBuilder().setCustomId(`run:bet:${v}`).setLabel(label).setStyle(style));
  }
  return row;
}

function buildHandButtons(r) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('run:hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('run:stand').setLabel('Stand').setStyle(ButtonStyle.Secondary),
  );
  const currentBet = r.currentGame.hands[r.currentGame.currentHandIndex].bet;
  if (canDouble(r.currentGame) && r.bankroll >= currentBet) {
    row.addComponents(
      new ButtonBuilder().setCustomId('run:double').setLabel('Double').setStyle(ButtonStyle.Success),
    );
  }
  if (canSplit(r.currentGame) && r.bankroll >= currentBet) {
    row.addComponents(
      new ButtonBuilder().setCustomId('run:split').setLabel('Split').setStyle(ButtonStyle.Success),
    );
  }
  return row;
}

function getColor(r) {
  if (r.phase === 'post-hand') {
    const last = r.history[r.history.length - 1];
    if (last) {
      if (last.net > 0) return 0x57f287;
      if (last.net < 0) return 0xed4245;
      return 0xfee75c;
    }
  }
  if (r.phase !== 'done') return 0x2b2d31;
  if (r.bankroll > STARTING_BANKROLL) return 0x57f287;
  if (r.bankroll === 0) return 0xed4245;
  return 0xfee75c;
}
