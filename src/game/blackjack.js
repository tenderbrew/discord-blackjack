import { newDeck, handTotal, isBlackjack } from './cards.js';

function draw(game) {
  if (game.deck.length === 0) game.deck = newDeck(game.rng);
  return game.deck.pop();
}

export function startGame({ userId, channelId, bet, rng }) {
  const deck = newDeck(rng);
  const player = [deck.pop(), deck.pop()];
  const dealer = [deck.pop(), deck.pop()];

  const game = {
    userId,
    channelId,
    deck,
    rng,
    hands: [{ cards: player, bet, doubled: false, finished: false }],
    dealer,
    currentHandIndex: 0,
    phase: 'player',
    totalBet: bet,
    result: null,
  };

  const playerBJ = isBlackjack(player);
  const dealerBJ = isBlackjack(dealer);

  if (playerBJ || dealerBJ) {
    game.phase = 'done';
    if (playerBJ && dealerBJ) {
      game.result = { outcomes: ['push'], net: 0 };
    } else if (playerBJ) {
      game.result = { outcomes: ['blackjack'], net: Math.floor(bet * 1.5) };
    } else {
      game.result = { outcomes: ['dealer_blackjack'], net: -bet };
    }
  }

  return game;
}

export function canDouble(game) {
  if (game.phase !== 'player') return false;
  const hand = game.hands[game.currentHandIndex];
  return hand.cards.length === 2 && !hand.doubled;
}

export function canSplit(game) {
  if (game.phase !== 'player') return false;
  if (game.hands.length > 1) return false;
  const hand = game.hands[game.currentHandIndex];
  return hand.cards.length === 2 && hand.cards[0].rank === hand.cards[1].rank;
}

export function hit(game) {
  if (game.phase !== 'player') return;
  const hand = game.hands[game.currentHandIndex];
  hand.cards.push(draw(game));
  if (handTotal(hand.cards) >= 21) finishHand(game);
}

export function stand(game) {
  if (game.phase !== 'player') return;
  finishHand(game);
}

export function double(game) {
  if (!canDouble(game)) return;
  const hand = game.hands[game.currentHandIndex];
  hand.bet *= 2;
  hand.doubled = true;
  hand.cards.push(draw(game));
  finishHand(game);
}

export function split(game) {
  if (!canSplit(game)) return;
  const hand = game.hands[game.currentHandIndex];
  const movedCard = hand.cards.pop();
  const newHand = {
    cards: [movedCard, draw(game)],
    bet: hand.bet,
    doubled: false,
    finished: false,
  };
  hand.cards.push(draw(game));
  game.hands.push(newHand);

  if (hand.cards[0].rank === 'A') {
    hand.finished = true;
    newHand.finished = true;
    playDealer(game);
  }
}

function finishHand(game) {
  game.hands[game.currentHandIndex].finished = true;
  for (let i = game.currentHandIndex + 1; i < game.hands.length; i++) {
    if (!game.hands[i].finished) {
      game.currentHandIndex = i;
      return;
    }
  }
  playDealer(game);
}

function playDealer(game) {
  const anySurvivors = game.hands.some(h => handTotal(h.cards) <= 21);
  if (anySurvivors) {
    game.phase = 'dealer';
    while (handTotal(game.dealer) < 17) {
      game.dealer.push(draw(game));
    }
  }
  game.phase = 'done';
  settle(game);
}

function settle(game) {
  const dealerTotal = handTotal(game.dealer);
  const dealerBust = dealerTotal > 21;
  const outcomes = [];
  let net = 0;

  for (const hand of game.hands) {
    const total = handTotal(hand.cards);
    if (total > 21) {
      outcomes.push('bust');
      net -= hand.bet;
    } else if (dealerBust || total > dealerTotal) {
      outcomes.push('win');
      net += hand.bet;
    } else if (total < dealerTotal) {
      outcomes.push('loss');
      net -= hand.bet;
    } else {
      outcomes.push('push');
    }
  }

  game.result = { outcomes, net };
}
