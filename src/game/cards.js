import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, '..', '..', 'data', 'card-emojis.json');
const SUIT_CODE = { '♠': 's', '♥': 'h', '♦': 'd', '♣': 'c' };

let emojiMap = {};
try {
  emojiMap = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
} catch {
  // No manifest yet — fall back to text rendering until upload-emojis is run.
}

export const DECKS_PER_SHOE = 6;

export function newDeck(rng = Math.random, deckCount = DECKS_PER_SHOE) {
  const deck = [];
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit });
      }
    }
  }
  return shuffle(deck, rng);
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      total += 11;
      aces++;
    } else if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') {
      total += 10;
    } else {
      total += parseInt(c.rank, 10);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export function isSoft(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      total += 11;
      aces++;
    } else if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') {
      total += 10;
    } else {
      total += parseInt(c.rank, 10);
    }
  }
  let soft = aces;
  while (total > 21 && soft > 0) {
    total -= 10;
    soft--;
  }
  return soft > 0;
}

export function isBlackjack(cards) {
  return cards.length === 2 && handTotal(cards) === 21;
}

function emojiName(card) {
  return `c_${card.rank.toLowerCase()}${SUIT_CODE[card.suit]}`;
}

function formatCard(card) {
  const name = emojiName(card);
  const id = emojiMap[name];
  return id ? `<:${name}:${id}>` : `\`${card.rank}${card.suit}\``;
}

export function formatHand(cards, { hideHole = false } = {}) {
  const backId = emojiMap['c_back'];
  const hole = backId ? `<:c_back:${backId}>` : '`??`';
  const parts = hideHole ? [formatCard(cards[0]), hole] : cards.map(formatCard);
  return parts.join(' ');
}
