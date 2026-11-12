import Database from 'better-sqlite3';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Receipt, Report, Snapshot, CurrencyRate } from './receipts';
const file = resolve(process.env.DATABASE_PATH || './data/billkeeper.sqlite');
mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
const db = new Database(file);
chmodSync(file, 0o600);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS currency_cache (
 currency TEXT PRIMARY KEY CHECK(currency IN ('USD','AED','GBP','EUR')),
 rate_micros INTEGER NOT NULL CHECK(rate_micros > 0), fetched_at TEXT NOT NULL, source_updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS currency_fetch_state (id INTEGER PRIMARY KEY CHECK(id=1), last_attempt_at INTEGER NOT NULL, last_error TEXT);
INSERT OR IGNORE INTO currency_fetch_state(id,last_attempt_at) VALUES (1,0);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (email TEXT PRIMARY KEY, attempts INTEGER NOT NULL, first_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS password_reset_requests (email TEXT PRIMARY KEY, requested_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS scan_attempts (user_id INTEGER NOT NULL REFERENCES users(id), attempted_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS scan_attempts_user ON scan_attempts(user_id,attempted_at);
CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), hash TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
 storage TEXT NOT NULL, storage_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id, hash), UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS reports (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 total_inr_minor INTEGER NOT NULL, closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(id,user_id)
);
CREATE TABLE IF NOT EXISTS receipts (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), vendor TEXT NOT NULL, date TEXT NOT NULL,
 category TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
 rate_micros INTEGER NOT NULL CHECK(rate_micros > 0), inr_minor INTEGER NOT NULL CHECK(inr_minor >= 0), summary TEXT NOT NULL,
 document_id TEXT UNIQUE, report_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(document_id,user_id) REFERENCES documents(id,user_id), FOREIGN KEY(report_id,user_id) REFERENCES reports(id,user_id)
);
CREATE INDEX IF NOT EXISTS receipts_user ON receipts(user_id,date);
`);
export default db;
export type User = { id: number; email: string };
export function snapshot(user: User): Snapshot {
  return { user: { email: user.email },
    receipts: db.prepare('SELECT r.*, d.mime AS document_mime FROM receipts r LEFT JOIN documents d ON r.document_id=d.id AND r.user_id=d.user_id WHERE r.user_id = ? ORDER BY r.date DESC, r.created_at DESC').all(user.id) as Receipt[],
    reports: db.prepare('SELECT r.*, (SELECT COUNT(*) FROM receipts WHERE report_id = r.id) AS count FROM reports r WHERE user_id = ? ORDER BY closed_at DESC').all(user.id) as Report[],
    scanning: Boolean(process.env.GEMINI_API_KEY), recovery: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.APP_URL),
    currencyCache: currencyCache(),
    storage: process.env.HETZNER_OS_BUCKET ? 'Private object storage' : 'Private server files',
  };
}

export function currencyCache() {
  const rates = db.prepare(`SELECT * FROM currency_cache ORDER BY CASE currency WHEN 'USD' THEN 1 WHEN 'AED' THEN 2 WHEN 'GBP' THEN 3 ELSE 4 END`).all() as CurrencyRate[];
  const state = db.prepare('SELECT last_error FROM currency_fetch_state WHERE id=1').get() as { last_error: string | null };
  return { rates, last_error: state.last_error, stale: rates.length !== 4 || rates.some(rate => Date.now() - Date.parse(rate.fetched_at) >= 86_400_000) };
}
