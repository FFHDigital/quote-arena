import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

// Runtime data, not source: excluded from build tracing.
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.ARENA_DATA_DIR ?? "./data");
export const SCREENSHOT_DIR = path.join(DATA_DIR, "screenshots");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS countries (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  flag TEXT NOT NULL,
  currency TEXT NOT NULL,
  regulator_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS product_lines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS insurers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  country_code TEXT NOT NULL REFERENCES countries(code),
  home_url TEXT NOT NULL,
  licence_ref TEXT,
  logo_color TEXT NOT NULL DEFAULT '#64748b',
  active INTEGER NOT NULL DEFAULT 1,
  -- Legal gate: audits only run when an admin has cleared the insurer's site terms.
  audit_allowed INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  parent_group TEXT,
  UNIQUE (country_code, slug)
);
CREATE TABLE IF NOT EXISTS insurer_products (
  insurer_id INTEGER NOT NULL REFERENCES insurers(id) ON DELETE CASCADE,
  product_line_id TEXT NOT NULL REFERENCES product_lines(id),
  quote_start_url TEXT NOT NULL,
  PRIMARY KEY (insurer_id, product_line_id)
);
CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  product_line_id TEXT NOT NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  insurer_id INTEGER NOT NULL REFERENCES insurers(id),
  product_line_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  status TEXT NOT NULL,
  driver TEXT,
  started_at TEXT,
  finished_at TEXT,
  outcome TEXT,
  metrics TEXT,
  scores TEXT,
  overall REAL,
  notes TEXT,
  error TEXT,
  rubric_version TEXT,
  prompt_version TEXT,
  cost_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS audits_lookup ON audits (insurer_id, product_line_id, status);
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  step_no INTEGER NOT NULL,
  kind TEXT NOT NULL,
  url TEXT,
  summary TEXT NOT NULL,
  screenshot TEXT,
  payload TEXT,
  UNIQUE (audit_id, ref)
);
CREATE TABLE IF NOT EXISTS verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_a_id INTEGER NOT NULL REFERENCES audits(id),
  audit_b_id INTEGER NOT NULL REFERENCES audits(id),
  winner TEXT NOT NULL,
  margin TEXT NOT NULL,
  reason TEXT NOT NULL,
  criteria TEXT NOT NULL,
  caveats TEXT NOT NULL,
  judge TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  order_agreement INTEGER NOT NULL,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (audit_a_id, audit_b_id, prompt_version)
);
CREATE TABLE IF NOT EXISTS ratings (
  insurer_id INTEGER NOT NULL REFERENCES insurers(id),
  product_line_id TEXT NOT NULL,
  elo REAL NOT NULL DEFAULT 1500,
  matches INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  ties INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (insurer_id, product_line_id)
);
CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verdict_id INTEGER NOT NULL REFERENCES verdicts(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verdict_id INTEGER NOT NULL REFERENCES verdicts(id),
  helpful INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress TEXT NOT NULL DEFAULT '[]',
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status, id);
`;

// Columns added after the first release, for databases created before them.
function migrate(conn: DatabaseSync) {
  const cols = conn.prepare(`PRAGMA table_info(insurers)`).all().map((c) => c.name);
  if (!cols.includes("parent_group")) conn.exec(`ALTER TABLE insurers ADD COLUMN parent_group TEXT`);
}

const globalForDb = globalThis as unknown as { __arenaDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!globalForDb.__arenaDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const conn = new DatabaseSync(path.join(DATA_DIR, "arena.db"));
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
    conn.exec(SCHEMA);
    migrate(conn);
    globalForDb.__arenaDb = conn;
  }
  return globalForDb.__arenaDb;
}

export function now(): string {
  return new Date().toISOString();
}

type Param = string | number | bigint | null | Uint8Array;

// node:sqlite returns null-prototype rows; spread them into plain objects so they can cross into client components.
export function all<T>(sql: string, ...params: Param[]): T[] {
  return db().prepare(sql).all(...params).map((r) => ({ ...r }) as T);
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  const row = db().prepare(sql).get(...params);
  return row ? ({ ...row } as T) : undefined;
}

export function run(sql: string, ...params: Param[]) {
  return db().prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  const conn = db();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}
