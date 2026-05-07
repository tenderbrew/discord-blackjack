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

    const r = run.startRun(userId, username, day);
    await interaction.reply(await buildRunMessage(r));
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

    const parts = interaction.customId.split(':');
    const action = parts[1];

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

    if (r.phase === 'done') {
      recordRun(r.userId, r.username, r.day, r.bankroll, r.handsPlayed);
      activeRuns.delete(messageId);
    }

    await interaction.update(await buildRunMessage(r));
  },
};

async function buildRunMessage(r) {
  const embed = new EmbedBuilder()
    .setTitle('🂡 Daily Run')
    .setColor(getColor(r));

  const headerLines = [
    `**Day** ${r.day}`,
    `**Bankroll** ${r.bankroll}`,
    `**Hands** ${r.handsPlayed}/${r.maxHands}`,
  ];

  if (r.phase === 'awaiting-bet') {
    embed.setDescription(headerLines.join('  ·  ') + `\n\nPlace your bet for hand ${r.handsPlayed + 1}.`);
    return { embeds: [embed], components: [buildBetButtons(r)], files: [] };
  }

  if (r.phase === 'in-hand') {
    embed.setDescription(headerLines.join('  ·  '));
    const showHole = r.currentGame.phase !== 'player';
    const imageBuf = await buildGameImage(r.currentGame, { hideHole: !showHole });
    const attachment = new AttachmentBuilder(imageBuf, { name: 'hand.png' });
    embed.setImage('attachment://hand.png');
    const components = r.currentGame.phase === 'player' ? [buildHandButtons(r)] : [];
    return { embeds: [embed], components, files: [attachment] };
  }

  // done
  const rank = rankInDay(r.userId, r.day);
  const streak = getUserStreak(r.userId);
  const delta = r.bankroll - STARTING_BANKROLL;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const summary = [
    `**Final score:** ${r.bankroll} chips (${sign}${Math.abs(delta)} from start)`,
    `**Hands played:** ${r.handsPlayed}/${r.maxHands}`,
    `**Rank today:** #${rank ?? '?'}`,
    `**Streak:** ${streak.current} day${streak.current === 1 ? '' : 's'} (best ${streak.best})`,
    ``,
    `Come back tomorrow for a new daily run. \`/top\` to see the leaderboard.`,
  ].join('\n');
  embed.setDescription(summary);
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
  if (r.phase !== 'done') return 0x2b2d31;
  if (r.bankroll > STARTING_BANKROLL) return 0x57f287;
  if (r.bankroll === 0) return 0xed4245;
  return 0xfee75c;
}
