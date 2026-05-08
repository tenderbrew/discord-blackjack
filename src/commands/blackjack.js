import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import * as game from '../game/blackjack.js';
import { buildGameMessage } from '../game/render.js';
import { adjustChips, getBalance } from '../db.js';

const activeGames = new Map();

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
      await interaction.editReply(await buildGameMessage(g, { username, balance: getBalance(userId) }));
      return;
    }

    await interaction.editReply(await buildGameMessage(g, { username, balance: getBalance(userId) }));
    const message = await interaction.fetchReply();
    activeGames.set(message.id, g);
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

    if (g.phase === 'done') {
      adjustChips(userId, g.totalBet + g.result.net);
      activeGames.delete(messageId);
    }

    await interaction.editReply(await buildGameMessage(g, { username, balance: getBalance(userId) }));
  },
};
