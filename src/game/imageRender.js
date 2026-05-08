import sharp from 'sharp';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handTotal, isSoft } from './cards.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PNG_DIR = join(__dirname, '..', '..', 'assets', 'cards');

const CARD_W = 128;
const CARD_H = 128;
const COL_GAP = 8;
const LABEL_H = 38;
const LABEL_GAP = 6;
const ROW_GAP = 24;
const MIN_WIDTH = 540;

const SUIT_CODE = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

function cardFile(card) {
  return `c_${card.rank.toLowerCase()}${SUIT_CODE[card.suit]}.png`;
}

const cache = new Map();
async function getScaledCard(filename) {
  if (!cache.has(filename)) {
    const buf = await sharp(join(PNG_DIR, filename))
      .resize(CARD_W, CARD_H, { kernel: 'nearest' })
      .toBuffer();
    cache.set(filename, buf);
  }
  return cache.get(filename);
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function labelSvg(text, width, color) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL_H}">` +
    `<text x="2" y="28" font-family="Segoe UI, 'Helvetica Neue', Arial, 'DejaVu Sans', sans-serif" font-size="26" font-weight="700" fill="${color}">${escapeXml(text)}</text>` +
    `</svg>`,
  );
}

function dealerLabel(game, hideHole) {
  if (hideHole) return `Dealer  ·  showing ${handTotal([game.dealer[0]])}`;
  const total = handTotal(game.dealer);
  return total > 21 ? `Dealer  ·  ${total}  ·  bust` : `Dealer  ·  ${total}`;
}

function playerLabel(game, i) {
  const hand = game.hands[i];
  const total = handTotal(hand.cards);
  const isCurrent = game.phase === 'player' && i === game.currentHandIndex;
  const arrow = isCurrent ? '▶ ' : '';
  const isSplit = game.hands.length > 1;
  const name = isSplit ? `${arrow}Hand ${i + 1}` : `${arrow}Your hand`;

  let totalStr;
  if (total > 21) totalStr = `bust (${total})`;
  else if (total === 21 && hand.cards.length === 2 && !isSplit) totalStr = '21 · blackjack';
  else if (isSoft(hand.cards) && total < 21) totalStr = `${total} (soft)`;
  else totalStr = `${total}`;

  const bet = `bet ${hand.bet}${hand.doubled ? ', doubled' : ''}`;
  return `${name}  ·  ${totalStr}  ·  ${bet}`;
}

export async function buildGameImage(game, { hideHole = false } = {}) {
  const dealerFiles = hideHole
    ? [cardFile(game.dealer[0]), 'c_back.png']
    : game.dealer.map(cardFile);

  const rows = [
    { files: dealerFiles, label: dealerLabel(game, hideHole), color: '#dbdee1' },
    ...game.hands.map((_, i) => ({
      files: game.hands[i].cards.map(cardFile),
      label: playerLabel(game, i),
      color: '#fee75c',
    })),
  ];

  const numRows = rows.length;
  const maxCols = Math.max(...rows.map(r => r.files.length));
  const cardsW = maxCols * CARD_W + (maxCols - 1) * COL_GAP;
  const totalW = Math.max(cardsW, MIN_WIDTH);
  const rowH = LABEL_H + LABEL_GAP + CARD_H;
  const totalH = numRows * rowH + (numRows - 1) * ROW_GAP;

  const composites = [];
  for (let r = 0; r < numRows; r++) {
    const yBase = r * (rowH + ROW_GAP);
    composites.push({
      input: labelSvg(rows[r].label, totalW, rows[r].color),
      top: yBase,
      left: 0,
    });
    for (let c = 0; c < rows[r].files.length; c++) {
      const buf = await getScaledCard(rows[r].files[c]);
      composites.push({
        input: buf,
        top: yBase + LABEL_H + LABEL_GAP,
        left: c * (CARD_W + COL_GAP),
      });
    }
  }

  return sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png().toBuffer();
}

export async function preloadCards() {
  const files = readdirSync(PNG_DIR).filter(f => f.endsWith('.png'));
  await Promise.all(files.map(getScaledCard));
  return files.length;
}
