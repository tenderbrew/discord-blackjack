import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'blackjack.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    user_id TEXT PRIMARY KEY,
    chips INTEGER NOT NULL,
    last_hourly_at INTEGER,
    last_daily_at INTEGER,
    last_weekly_at INTEGER,
    last_monthly_at INTEGER,
    xp INTEGER NOT NULL DEFAULT 0,
    prestige INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

const existingCols = new Set(
  db.prepare('PRAGMA table_info(players)').all().map(r => r.name),
);
for (const col of ['last_hourly_at', 'last_daily_at', 'last_weekly_at', 'last_monthly_at']) {
  if (!existingCols.has(col)) {
    db.exec(`ALTER TABLE players ADD COLUMN ${col} INTEGER`);
  }
}
if (!existingCols.has('xp')) {
  db.exec('ALTER TABLE players ADD COLUMN xp INTEGER NOT NULL DEFAULT 0');
}
if (!existingCols.has('prestige')) {
  db.exec('ALTER TABLE players ADD COLUMN prestige INTEGER NOT NULL DEFAULT 0');
}
for (const col of [
  'hands_played', 'hands_won', 'hands_lost', 'hands_pushed', 'hands_blackjack',
  'biggest_win', 'biggest_loss', 'lifetime_wagered', 'lifetime_won', 'lifetime_lost',
]) {
  if (!existingCols.has(col)) {
    db.exec(`ALTER TABLE players ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
  }
}
if (!existingCols.has('username')) {
  db.exec(`ALTER TABLE players ADD COLUMN username TEXT NOT NULL DEFAULT ''`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const XP_CURVE_VERSION = '3';
const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?');
const setMetaStmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
const currentXpCurve = getMetaStmt.get('xp_curve_version');
if (currentXpCurve?.value !== XP_CURVE_VERSION) {
  const reset = db.prepare('UPDATE players SET xp = 0').run();
  setMetaStmt.run('xp_curve_version', XP_CURVE_VERSION);
  if (reset.changes > 0) {
    console.log(`XP curve v${XP_CURVE_VERSION}: reset xp on ${reset.changes} player(s).`);
  }
}

export const STARTING_CHIPS = 1000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

const TIERS = [
  { col: 'last_hourly_at',  key: 'hourly',  interval: HOUR_MS,  amount:    50 },
  { col: 'last_daily_at',   key: 'daily',   interval: DAY_MS,   amount:   500 },
  { col: 'last_weekly_at',  key: 'weekly',  interval: WEEK_MS,  amount:  2500 },
  { col: 'last_monthly_at', key: 'monthly', interval: MONTH_MS, amount: 15000 },
];

const getPlayerStmt = db.prepare('SELECT * FROM players WHERE user_id = ?');
const insertPlayerStmt = db.prepare(
  'INSERT INTO players (user_id, chips, created_at) VALUES (?, ?, ?)',
);
const updateChipsStmt = db.prepare(
  'UPDATE players SET chips = chips + ? WHERE user_id = ?',
);

function getOrCreatePlayer(userId) {
  let row = getPlayerStmt.get(userId);
  if (!row) {
    insertPlayerStmt.run(userId, STARTING_CHIPS, Date.now());
    row = getPlayerStmt.get(userId);
  }
  return row;
}

function accrue(userId) {
  const player = getOrCreatePlayer(userId);
  const now = Date.now();
  const credits = { hourly: 0, daily: 0, weekly: 0, monthly: 0 };
  let totalChips = 0;
  const tsUpdates = {};

  for (const tier of TIERS) {
    const last = player[tier.col];
    if (last == null) {
      tsUpdates[tier.col] = now;
      continue;
    }
    const elapsed = now - last;
    if (elapsed <= 0) continue;
    const intervals = Math.floor(elapsed / tier.interval);
    if (intervals > 0) {
      const credit = intervals * tier.amount;
      credits[tier.key] = credit;
      totalChips += credit;
      tsUpdates[tier.col] = last + intervals * tier.interval;
    }
  }

  const updateCols = Object.keys(tsUpdates);
  if (totalChips > 0 || updateCols.length > 0) {
    const sets = [];
    const params = [];
    if (totalChips > 0) {
      sets.push('chips = chips + ?');
      params.push(totalChips);
    }
    for (const col of updateCols) {
      sets.push(`${col} = ?`);
      params.push(tsUpdates[col]);
    }
    params.push(userId);
    db.prepare(`UPDATE players SET ${sets.join(', ')} WHERE user_id = ?`).run(...params);
  }

  return { ...credits, total: totalChips };
}

function touch(userId) {
  getOrCreatePlayer(userId);
  return accrue(userId);
}

const setUsernameStmt = db.prepare('UPDATE players SET username = ? WHERE user_id = ? AND username != ?');

export function seenAs(userId, username) {
  touch(userId);
  if (username) setUsernameStmt.run(username, userId, username);
}

export function getBalance(userId) {
  touch(userId);
  return getPlayerStmt.get(userId).chips;
}

export function adjustChips(userId, delta) {
  touch(userId);
  updateChipsStmt.run(delta, userId);
}

export function getAccrualRates() {
  return Object.fromEntries(TIERS.map(t => [t.key, t.amount]));
}

const allPlayerIdsStmt = db.prepare('SELECT user_id FROM players');

export function accrueAll() {
  const rows = allPlayerIdsStmt.all();
  for (const row of rows) accrue(row.user_id);
  return rows.length;
}

const addXpStmt = db.prepare('UPDATE players SET xp = xp + ? WHERE user_id = ?');
const setPrestigeStmt = db.prepare('UPDATE players SET prestige = prestige + 1, xp = 0 WHERE user_id = ?');
const recordHandStatsStmt = db.prepare(`
  UPDATE players SET
    hands_played = hands_played + ?,
    hands_won = hands_won + ?,
    hands_lost = hands_lost + ?,
    hands_pushed = hands_pushed + ?,
    hands_blackjack = hands_blackjack + ?,
    biggest_win = MAX(biggest_win, ?),
    biggest_loss = MAX(biggest_loss, ?),
    lifetime_wagered = lifetime_wagered + ?,
    lifetime_won = lifetime_won + ?,
    lifetime_lost = lifetime_lost + ?
  WHERE user_id = ?
`);

export function addXp(userId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  touch(userId);
  addXpStmt.run(Math.floor(amount), userId);
}

export function getProfile(userId) {
  touch(userId);
  const row = getPlayerStmt.get(userId);
  return {
    chips: row.chips,
    xp: row.xp ?? 0,
    prestige: row.prestige ?? 0,
  };
}

export function prestigePlayer(userId) {
  touch(userId);
  setPrestigeStmt.run(userId);
}

export function recordHandStats(userId, { outcomes, net, totalBet }) {
  touch(userId);
  let won = 0, lost = 0, pushed = 0, bj = 0;
  for (const o of outcomes) {
    if (o === 'win' || o === 'blackjack') won++;
    if (o === 'blackjack') bj++;
    if (o === 'push') pushed++;
    if (o === 'loss' || o === 'bust' || o === 'dealer_blackjack') lost++;
  }
  recordHandStatsStmt.run(
    outcomes.length,
    won, lost, pushed, bj,
    Math.max(0, net),
    Math.max(0, -net),
    totalBet,
    Math.max(0, net),
    Math.max(0, -net),
    userId,
  );
}

export function getStats(userId) {
  touch(userId);
  return getPlayerStmt.get(userId);
}

const topChipsStmt = db.prepare(
  "SELECT user_id, username, chips FROM players WHERE username != '' ORDER BY chips DESC LIMIT ?",
);
const topLevelStmt = db.prepare(
  "SELECT user_id, username, prestige, xp FROM players WHERE username != '' ORDER BY prestige DESC, xp DESC LIMIT ?",
);
const topWageredStmt = db.prepare(
  "SELECT user_id, username, lifetime_wagered FROM players WHERE username != '' AND lifetime_wagered > 0 ORDER BY lifetime_wagered DESC LIMIT ?",
);
const topBiggestStmt = db.prepare(
  "SELECT user_id, username, biggest_win FROM players WHERE username != '' AND biggest_win > 0 ORDER BY biggest_win DESC LIMIT ?",
);

export function getTopChips(limit = 10) { return topChipsStmt.all(limit); }
export function getTopLevel(limit = 10) { return topLevelStmt.all(limit); }
export function getTopWagered(limit = 10) { return topWageredStmt.all(limit); }
export function getTopBiggest(limit = 10) { return topBiggestStmt.all(limit); }

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    day TEXT NOT NULL,
    final_chips INTEGER NOT NULL,
    hands_played INTEGER NOT NULL,
    finished_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)
  );
  CREATE INDEX IF NOT EXISTS idx_runs_day_score ON runs (day, final_chips DESC);

  CREATE TABLE IF NOT EXISTS live_games (
    message_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    state TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_live_games_kind ON live_games (kind);
`);

const upsertLiveGameStmt = db.prepare(
  `INSERT INTO live_games (message_id, user_id, kind, state, updated_at)
   VALUES (?, ?, ?, ?, ?)
   ON CONFLICT (message_id) DO UPDATE SET
     state = excluded.state,
     updated_at = excluded.updated_at`,
);
const deleteLiveGameStmt = db.prepare('DELETE FROM live_games WHERE message_id = ?');
const loadLiveGamesByKindStmt = db.prepare('SELECT message_id, user_id, state FROM live_games WHERE kind = ?');
const sweepStaleLiveGamesStmt = db.prepare(
  'DELETE FROM live_games WHERE updated_at < ? RETURNING message_id, kind',
);

export function saveLiveGame(messageId, userId, kind, state) {
  upsertLiveGameStmt.run(messageId, userId, kind, JSON.stringify(state), Date.now());
}

export function deleteLiveGame(messageId) {
  deleteLiveGameStmt.run(messageId);
}

export function loadLiveGames(kind) {
  return loadLiveGamesByKindStmt.all(kind);
}

export function sweepStaleLiveGames(maxAgeMs) {
  return sweepStaleLiveGamesStmt.all(Date.now() - maxAgeMs);
}

const insertRunStmt = db.prepare(
  'INSERT INTO runs (user_id, username, day, final_chips, hands_played, finished_at) VALUES (?, ?, ?, ?, ?, ?)',
);
const getRunByDayStmt = db.prepare('SELECT * FROM runs WHERE user_id = ? AND day = ?');
const dailyTopStmt = db.prepare(
  'SELECT user_id, username, final_chips, hands_played FROM runs WHERE day = ? ORDER BY final_chips DESC, hands_played ASC LIMIT ?',
);
const periodTopStmt = db.prepare(
  `SELECT user_id, username, MAX(final_chips) AS best, MIN(hands_played) AS fewest_hands
   FROM runs WHERE day >= ?
   GROUP BY user_id
   ORDER BY best DESC, fewest_hands ASC
   LIMIT ?`,
);
const allTimeTopStmt = db.prepare(
  `SELECT user_id, username, MAX(final_chips) AS best, MIN(hands_played) AS fewest_hands
   FROM runs
   GROUP BY user_id
   ORDER BY best DESC, fewest_hands ASC
   LIMIT ?`,
);
const userDaysStmt = db.prepare(
  'SELECT day FROM runs WHERE user_id = ? ORDER BY day DESC LIMIT 365',
);
const dayRanksStmt = db.prepare(
  'SELECT user_id FROM runs WHERE day = ? ORDER BY final_chips DESC, hands_played ASC',
);

export function getTodayRun(userId, day) {
  return getRunByDayStmt.get(userId, day);
}

export function recordRun(userId, username, day, finalChips, handsPlayed) {
  insertRunStmt.run(userId, username, day, finalChips, handsPlayed, Date.now());
}

export function getDailyTop(day, limit = 10) {
  return dailyTopStmt.all(day, limit);
}

export function getPeriodTop(sinceDay, limit = 10) {
  return periodTopStmt.all(sinceDay, limit);
}

export function getAllTimeTop(limit = 10) {
  return allTimeTopStmt.all(limit);
}

export function rankInDay(userId, day) {
  const all = dayRanksStmt.all(day);
  for (let i = 0; i < all.length; i++) {
    if (all[i].user_id === userId) return i + 1;
  }
  return null;
}

export function getUserStreak(userId) {
  const days = userDaysStmt.all(userId).map(r => r.day);
  if (days.length === 0) return { current: 0, best: 0 };

  const dayMs = 24 * 60 * 60 * 1000;
  const dayDates = days.map(d => new Date(d + 'T00:00:00').getTime());
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  let current = 0;
  if (dayDates[0] >= todayMs - dayMs) {
    current = 1;
    for (let i = 1; i < dayDates.length; i++) {
      if (Math.round((dayDates[i - 1] - dayDates[i]) / dayMs) === 1) current++;
      else break;
    }
  }

  let best = 1;
  let cur = 1;
  for (let i = 1; i < dayDates.length; i++) {
    if (Math.round((dayDates[i - 1] - dayDates[i]) / dayMs) === 1) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 1;
    }
  }

  return { current, best };
}
