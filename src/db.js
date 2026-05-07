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
