import Database from "better-sqlite3";
import { config } from "./config.js";

let _db: Database.Database | null = null;

/** Singleton SQLite handle. WAL for concurrent read during the demo. */
export function db(): Database.Database {
  if (_db) return _db;
  const d = new Database(config.dbPath);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  migrate(d);
  _db = d;
  return d;
}

function migrate(d: Database.Database): void {
  d.exec(`
    -- Append-only audit log with hash chain (SPEC §5.13, I4)
    CREATE TABLE IF NOT EXISTS audit_log (
      id         TEXT PRIMARY KEY,        -- ulid (also gives ordering)
      ts         TEXT NOT NULL,
      intent_id  TEXT,
      actor      TEXT NOT NULL,
      event      TEXT NOT NULL,
      payload    TEXT NOT NULL,           -- JSON snapshot
      prev_hash  TEXT NOT NULL,
      hash       TEXT NOT NULL
    );

    -- Float spend tracking, reconciled against ws-observed balances (SPEC §5.13, I5)
    CREATE TABLE IF NOT EXISTS float_ledger (
      id         TEXT PRIMARY KEY,        -- ulid
      ts         TEXT NOT NULL,
      intent_id  TEXT,
      delta_rlusd REAL NOT NULL,          -- negative = spend, positive = refill
      balance_after_rlusd REAL,           -- optional reconciliation snapshot
      note       TEXT
    );
  `);
}
