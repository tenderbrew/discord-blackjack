import { canDouble, canSplit, double, hit, split, stand, startGame } from './blackjack.js';
import { dayKey, deckRngForHand } from './rng.js';

export const STARTING_BANKROLL = 500;
export const MAX_HANDS = 10;
export const MIN_BET = 10;

export function startRun(userId, username, day = dayKey()) {
  return {
    userId,
    username,
    day,
    bankroll: STARTING_BANKROLL,
    handsPlayed: 0,
    maxHands: MAX_HANDS,
    currentGame: null,
    phase: 'awaiting-bet',
    history: [],
    finalScore: null,
  };
}

export function placeBet(run, bet) {
  if (run.phase !== 'awaiting-bet') return false;
  if (!Number.isInteger(bet) || bet < MIN_BET || bet > run.bankroll) return false;
  const handNumber = run.handsPlayed + 1;
  const rng = deckRngForHand(run.day, handNumber);
  run.bankroll -= bet;
  run.currentGame = startGame({ userId: run.userId, channelId: 'run', bet, rng });
  run.phase = 'in-hand';
  if (run.currentGame.phase === 'done') finishCurrentHand(run);
  return true;
}

export function runHit(run) {
  if (run.phase !== 'in-hand') return;
  hit(run.currentGame);
  if (run.currentGame.phase === 'done') finishCurrentHand(run);
}

export function runStand(run) {
  if (run.phase !== 'in-hand') return;
  stand(run.currentGame);
  if (run.currentGame.phase === 'done') finishCurrentHand(run);
}

export function runDouble(run) {
  if (run.phase !== 'in-hand') return false;
  if (!canDouble(run.currentGame)) return false;
  const additional = run.currentGame.hands[run.currentGame.currentHandIndex].bet;
  if (run.bankroll < additional) return false;
  run.bankroll -= additional;
  run.currentGame.totalBet += additional;
  double(run.currentGame);
  if (run.currentGame.phase === 'done') finishCurrentHand(run);
  return true;
}

export function runSplit(run) {
  if (run.phase !== 'in-hand') return false;
  if (!canSplit(run.currentGame)) return false;
  const additional = run.currentGame.hands[run.currentGame.currentHandIndex].bet;
  if (run.bankroll < additional) return false;
  run.bankroll -= additional;
  run.currentGame.totalBet += additional;
  split(run.currentGame);
  if (run.currentGame.phase === 'done') finishCurrentHand(run);
  return true;
}

export function continueAfterHand(run) {
  if (run.phase !== 'post-hand') return;
  run.currentGame = null;
  if (run.handsPlayed >= run.maxHands || run.bankroll < MIN_BET) {
    run.phase = 'done';
    run.finalScore = run.bankroll;
  } else {
    run.phase = 'awaiting-bet';
  }
}

function finishCurrentHand(run) {
  const game = run.currentGame;
  run.bankroll += game.totalBet + game.result.net;
  run.handsPlayed += 1;
  run.history.push({
    handNum: run.handsPlayed,
    totalBet: game.totalBet,
    net: game.result.net,
    outcomes: game.result.outcomes,
    bankrollAfter: run.bankroll,
  });
  // Keep currentGame so post-hand can render the final cards.
  run.phase = 'post-hand';
}
