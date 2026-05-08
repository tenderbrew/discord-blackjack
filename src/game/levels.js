import { TIER_COLORS, TIER_EMOJI, TITLES } from './titles.js';

export const MAX_LEVEL = 100;
export const MAX_PRESTIGE = 100;
export const PUSH_XP = 50;

export function xpForLevelDelta(level) {
  return 2500 + level * 100;
}

export function cumulativeXpForLevel(level) {
  let total = 0;
  for (let i = 1; i < level; i++) total += xpForLevelDelta(i);
  return total;
}

export function levelFromXp(xp) {
  let level = 1;
  let cum = 0;
  while (level < MAX_LEVEL) {
    const needed = xpForLevelDelta(level);
    if (cum + needed > xp) break;
    cum += needed;
    level++;
  }
  const isMaxLevel = level === MAX_LEVEL;
  return {
    level,
    xpInLevel: xp - cum,
    xpForNext: isMaxLevel ? 0 : xpForLevelDelta(level),
    isMaxLevel,
  };
}

export function titleFor(level) {
  const idx = Math.max(0, Math.min(level - 1, TITLES.length - 1));
  return TITLES[idx];
}

export function tierEmojiFor(level) {
  const idx = Math.max(0, Math.min(Math.floor((level - 1) / 10), TIER_EMOJI.length - 1));
  return TIER_EMOJI[idx];
}

export function tierColorFor(level) {
  const idx = Math.max(0, Math.min(Math.floor((level - 1) / 10), TIER_COLORS.length - 1));
  return TIER_COLORS[idx];
}

export function formatTitleWithPrestige(level, prestige) {
  const base = titleFor(level);
  return prestige > 0 ? `${base} ★${prestige}` : base;
}

export function progressBar(profile, width = 16) {
  if (profile.isMaxLevel) return '█'.repeat(width) + '  MAX';
  const pct = profile.xpForNext > 0 ? profile.xpInLevel / profile.xpForNext : 0;
  const filled = Math.max(0, Math.min(width, Math.round(pct * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled) + `  ${profile.xpInLevel}/${profile.xpForNext} XP`;
}
