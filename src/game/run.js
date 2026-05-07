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

function finishCurrentHand(run) {
  run.bankroll += run.currentGame.totalBet + run.currentGame.result.net;
  run.handsPlayed += 1;
  run.currentGame = null;
  if (run.handsPlayed >= run.maxHands || run.bankroll < MIN_BET) {
    run.phase = 'done';
    run.finalScore = run.bankroll;
  } else {
    run.phase = 'awaiting-bet';
  }
}
