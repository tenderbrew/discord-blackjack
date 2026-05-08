import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { canDouble, canSplit } from './blackjack.js';
import { buildGameImage } from './imageRender.js';
import { PUSH_XP, formatTitleWithPrestige, prestigeOrderFor, tierEmojiFor } from './levels.js';

export async function buildGameMessage(game, { username, balance, prestige = 0, levelUp = null } = {}) {
  const order = prestigeOrderFor(prestige);
  const embed = new EmbedBuilder()
    .setTitle(order ? `${order.emoji}  Blackjack — ${order.name}` : '🂡 Blackjack')
    .setColor(getColor(game));

  const showHole = game.phase !== 'player';
  const imageBuf = await buildGameImage(game, { hideHole: !showHole });
  const attachment = new AttachmentBuilder(imageBuf, { name: 'hand.png' });
  embed.setImage('attachment://hand.png');

  if (game.phase === 'done') {
    embed.addFields({ name: 'Result', value: formatResult(game, { levelUp }) });
  }

  if (username && balance != null) {
    embed.setFooter({ text: `${username} • ${balance} chips` });
  }

  const components = game.phase === 'player' ? [buildButtons(game)] : [];
  return { embeds: [embed], components, files: [attachment] };
}

function getColor(game) {
  if (game.phase !== 'done') return 0x2b2d31;
  const net = game.result.net;
  if (net > 0) return 0x57f287;
  if (net < 0) return 0xed4245;
  return 0xfee75c;
}

function xpForResult(net) {
  if (net > 0) return net;
  if (net === 0) return PUSH_XP;
  return 0;
}

function formatResult(game, { levelUp = null } = {}) {
  const { outcomes, net } = game.result;
  const abs = Math.abs(net);
  const lines = [];

  if (outcomes.length === 1) {
    const o = outcomes[0];
    if (o === 'blackjack') lines.push(`🎉 Blackjack! +${abs} chips`);
    else if (o === 'win') lines.push(`✅ You win! +${abs} chips`);
    else if (o === 'push') lines.push(`➖ Push — bet returned`);
    else if (o === 'loss') lines.push(`❌ Dealer wins. −${abs} chips`);
    else if (o === 'bust') lines.push(`💥 Busted. −${abs} chips`);
    else if (o === 'dealer_blackjack') lines.push(`❌ Dealer blackjack. −${abs} chips`);
  } else {
    const tag = { win: '✅ win', push: '➖ push', loss: '❌ loss', bust: '💥 bust', blackjack: '🎉 blackjack' };
    const labels = outcomes.map((o, i) => `Hand ${i + 1}: ${tag[o] ?? o}`);
    const sign = net > 0 ? '+' : net < 0 ? '−' : '';
    lines.push(`${labels.join(' • ')}\n**Net: ${sign}${abs} chips**`);
  }

  const xp = xpForResult(net);
  if (xp > 0) lines.push(`✨ +${xp} XP`);

  if (levelUp) {
    const tierEmoji = tierEmojiFor(levelUp.newLevel);
    const title = formatTitleWithPrestige(levelUp.newLevel, levelUp.prestige);
    lines.push(`🆙 **LEVEL UP!**  ${tierEmoji}  **${title}**  *(Lv ${levelUp.newLevel})*`);
  }

  return lines.join('\n');
}

function buildButtons(game) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bj:hit').setLabel('Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('bj:stand').setLabel('Stand').setStyle(ButtonStyle.Secondary),
  );
  if (canDouble(game)) {
    row.addComponents(
      new ButtonBuilder().setCustomId('bj:double').setLabel('Double').setStyle(ButtonStyle.Success),
    );
  }
  if (canSplit(game)) {
    row.addComponents(
      new ButtonBuilder().setCustomId('bj:split').setLabel('Split').setStyle(ButtonStyle.Success),
    );
  }
  return row;
}
