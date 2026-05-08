import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import * as game from '../game/blackjack.js';
import { buildGameMessage } from '../game/render.js';
import { addXp, adjustChips, deleteLiveGame, getBalance, getProfile, loadLiveGames, recordHandStats, saveLiveGame, seenAs } from '../db.js';
import { MAX_LEVEL, PUSH_XP, formatTitleWithPrestige, levelFromXp, tierEmojiFor } from '../game/levels.js';

const activeGames = new Map();

function buildLevelUpMessage(userId, newLevel, prestige) {
  const title = formatTitleWithPrestige(newLevel, prestige);
  const emoji = tierEmojiFor(newLevel);
  let content = `🎉 <@${userId}> leveled up to ${emoji}  **${title}**  *(Level ${newLevel})*`;
  if (newLevel === MAX_LEVEL) {
    content += `\n👑 **Max level reached.** Run \`/prestige\` to ascend.`;
  }
  return { content, allowedMentions: { parse: [] } };
}

function settleAndDetectLevelUp(userId, net) {
  const before = getProfile(userId);
  if (net > 0) addXp(userId, net);
  else if (net === 0) addXp(userId, PUSH_XP);
  const after = getProfile(userId);
  const oldLevel = levelFromXp(before.xp, before.prestige).level;
  const newLevel = levelFromXp(after.xp, after.prestige).level;
  return { leveledUp: newLevel > oldLevel, newLevel, prestige: after.prestige };
}

export default {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play a hand of blackjack')
    .addIntegerOption(opt =>
      opt.setName('bet')
        .setDescription('Chips to wager')
        .setMinValue(1)
        .setRequired(true),
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    seenAs(userId, username);
    const bet = interaction.options.getInteger('bet');

    const balance = getBalance(userId);
    if (bet > balance) {
      await interaction.reply({
        content: `You only have **${balance}** chips. Try \`/daily\` if you're broke.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    adjustChips(userId, -bet);
    const g = game.startGame({ userId, channelId: interaction.channelId, bet });

    if (g.phase === 'done') {
      adjustChips(userId, g.totalBet + g.result.net);
      recordHandStats(userId, { outcomes: g.result.outcomes, net: g.result.net, totalBet: g.totalBet });
      const lvl = settleAndDetectLevelUp(userId, g.result.net);
      const profile = getProfile(userId);
      await interaction.editReply(await buildGameMessage(g, { username, balance: profile.chips, prestige: profile.prestige }));
      if (lvl.leveledUp) {
        await interaction.followUp(buildLevelUpMessage(userId, lvl.newLevel, lvl.prestige));
      }
      return;
    }

    const profile = getProfile(userId);
    await interaction.editReply(await buildGameMessage(g, { username, balance: profile.chips, prestige: profile.prestige }));
    const message = await interaction.fetchReply();
    activeGames.set(message.id, g);
    saveLiveGame(message.id, userId, 'blackjack', g);
  },

  async handleButton(interaction) {
    const messageId = interaction.message.id;
    const g = activeGames.get(messageId);

    if (!g) {
      await interaction.reply({
        content: 'This game has expired (bot may have restarted). Start a new one with `/blackjack`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== g.userId) {
      await interaction.reply({
        content: "This isn't your game.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const action = interaction.customId.split(':')[1];
    const userId = g.userId;
    const username = interaction.user.username;

    if (action === 'double' || action === 'split') {
      const additional = g.hands[g.currentHandIndex].bet;
      if (getBalance(userId) < additional) {
        await interaction.reply({
          content: `Need **${additional}** more chips to ${action}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferUpdate();

    if (action === 'hit') {
      game.hit(g);
    } else if (action === 'stand') {
      game.stand(g);
    } else if (action === 'double') {
      const additional = g.hands[g.currentHandIndex].bet;
      adjustChips(userId, -additional);
      g.totalBet += additional;
      game.double(g);
    } else if (action === 'split') {
      const additional = g.hands[g.currentHandIndex].bet;
      adjustChips(userId, -additional);
      g.totalBet += additional;
      game.split(g);
    }

    let lvl = null;
    if (g.phase === 'done') {
      adjustChips(userId, g.totalBet + g.result.net);
      recordHandStats(userId, { outcomes: g.result.outcomes, net: g.result.net, totalBet: g.totalBet });
      lvl = settleAndDetectLevelUp(userId, g.result.net);
      activeGames.delete(messageId);
      deleteLiveGame(messageId);
    } else {
      saveLiveGame(messageId, userId, 'blackjack', g);
    }

    const profile = getProfile(userId);
    await interaction.editReply(await buildGameMessage(g, { username, balance: profile.chips, prestige: profile.prestige }));

    if (lvl?.leveledUp) {
      await interaction.followUp(buildLevelUpMessage(userId, lvl.newLevel, lvl.prestige));
    }
  },

  restore() {
    const rows = loadLiveGames('blackjack');
    for (const row of rows) {
      try {
        const g = JSON.parse(row.state);
        activeGames.set(row.message_id, g);
      } catch (err) {
        console.error(`Failed to restore blackjack game ${row.message_id}:`, err);
      }
    }
    return rows.length;
  },

  dropFromMemory(messageId) {
    activeGames.delete(messageId);
  },
};
