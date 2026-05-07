import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { canDouble, canSplit } from './blackjack.js';
import { buildGameImage } from './imageRender.js';

export async function buildGameMessage(game, { username, balance } = {}) {
  const embed = new EmbedBuilder()
    .setTitle('🂡 Blackjack')
    .setColor(getColor(game));

  const showHole = game.phase !== 'player';
  const imageBuf = await buildGameImage(game, { hideHole: !showHole });
  const attachment = new AttachmentBuilder(imageBuf, { name: 'hand.png' });
  embed.setImage('attachment://hand.png');

  if (game.phase === 'done') {
    embed.addFields({ name: 'Result', value: formatResult(game) });
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

function formatResult(game) {
  const { outcomes, net } = game.result;
  const abs = Math.abs(net);
  if (outcomes.length === 1) {
    const o = outcomes[0];
    if (o === 'blackjack') return `🎉 Blackjack! +${abs} chips`;
    if (o === 'win') return `✅ You win! +${abs} chips`;
    if (o === 'push') return `➖ Push — bet returned`;
    if (o === 'loss') return `❌ Dealer wins. −${abs} chips`;
    if (o === 'bust') return `💥 Busted. −${abs} chips`;
    if (o === 'dealer_blackjack') return `❌ Dealer blackjack. −${abs} chips`;
  }
  const tag = { win: '✅ win', push: '➖ push', loss: '❌ loss', bust: '💥 bust', blackjack: '🎉 blackjack' };
  const labels = outcomes.map((o, i) => `Hand ${i + 1}: ${tag[o] ?? o}`);
  const sign = net > 0 ? '+' : net < 0 ? '−' : '';
  return `${labels.join(' • ')}\n**Net: ${sign}${abs} chips**`;
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
