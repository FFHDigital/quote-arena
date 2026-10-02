// Tiny document store on the SQLite built into Node (no dependencies).
// Each collection is a table of JSON documents with optional expression indexes.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { nowIso, clone } from './util.js';

const COLLECTIONS = {
  customers: ['email'],
  agents: ['key_hash'],
  sessions: ['token_hash'],
  mandates: ['token_hash', 'agent_id', 'customer_id'],
  quotes: ['customer_id'],
  confirmations: ['customer_email'],
  policies: ['customer_id', 'status', 'number'],
  payments: ['policy_id'],
  claims: ['policy_id', 'customer_id', 'status'],
  complaints: ['customer_id', 'status'],
  cases: ['customer_id', 'status'],
  events: ['customer_id'],
  notifications: ['to'],
  audit: ['customer_id', 'entity_id'],
  idempotency: [],
  price_overrides: [],
  meta: [],
};

let db;
const cols = {};

class Collection {
  constructor(name, indexes) {
    this.name = name;
    db.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    db.exec(`CREATE INDEX IF NOT EXISTS ix_${name}_created ON ${name}(created_at)`);
    for (const f of indexes) db.exec(`CREATE INDEX IF NOT EXISTS ix_${name}_${f} ON ${name}(json_extract(data, '$.${f}'))`);
    this.s = {
      ins: db.prepare(`INSERT INTO ${name} (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)`),
      get: db.prepare(`SELECT data FROM ${name} WHERE id = ?`),
      upd: db.prepare(`UPDATE ${name} SET data = ?, updated_at = ? WHERE id = ?`),
      del: db.prepare(`DELETE FROM ${name} WHERE id = ?`),
    };
  }
  insert(doc) {
    const t = nowIso();
    const d = { created_at: t, ...doc, updated_at: t };
    this.s.ins.run(d.id, JSON.stringify(d), d.created_at, t);
    return clone(d);
  }
  get(idv) {
    const r = this.s.get.get(String(idv));
    return r ? JSON.parse(r.data) : null;
  }
  /** update(id, patchObject | (doc) => newDoc) */
  update(idv, patch) {
    const cur = this.get(idv);
    if (!cur) return null;
    const next = typeof patch === 'function' ? patch(clone(cur)) || cur : { ...cur, ...patch };
    next.updated_at = nowIso();
    this.s.upd.run(JSON.stringify(next), next.updated_at, String(idv));
    return next;
  }
  upsert(doc) { return this.get(doc.id) ? this.update(doc.id, doc) : this.insert(doc); }
  delete(idv) { this.s.del.run(String(idv)); }
  /** find({field: value, ...}, {limit, desc}) - equality filters on top-level JSON fields */
  find(filter = {}, { limit = 500, desc = true } = {}) {
    const keys = Object.keys(filter).filter((k) => filter[k] !== undefined);
    const where = keys.length ? 'WHERE ' + keys.map((k) => `json_extract(data, '$.${k}') = ?`).join(' AND ') : '';
    const vals = keys.map((k) => (typeof filter[k] === 'boolean' ? Number(filter[k]) : filter[k]));
    const rows = db.prepare(`SELECT data FROM ${this.name} ${where} ORDER BY created_at ${desc ? 'DESC' : 'ASC'} LIMIT ${Number(limit)}`).all(...vals);
    return rows.map((r) => JSON.parse(r.data));
  }
  findOne(filter) { return this.find(filter, { limit: 1 })[0] || null; }
  count(filter = {}) { return this.find(filter, { limit: 1e9 }).length; }
  where(sqlWhere, params = [], { limit = 500, desc = true } = {}) {
    return db.prepare(`SELECT data FROM ${this.name} WHERE ${sqlWhere} ORDER BY created_at ${desc ? 'DESC' : 'ASC'} LIMIT ${Number(limit)}`)
      .all(...params).map((r) => JSON.parse(r.data));
  }
}

export function openDb(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  // WAL needs shared memory, which network file shares (e.g. Azure App Service /home) don't support reliably.
  db.exec(`PRAGMA journal_mode = ${process.env.FK_DB_JOURNAL || 'WAL'}; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;`);
  for (const [name, idx] of Object.entries(COLLECTIONS)) cols[name] = new Collection(name, idx);
  return cols;
}

export const store = new Proxy({}, {
  get(_, name) {
    if (!db) openDb();
    if (!cols[name]) throw new Error(`Unknown collection ${String(name)}`);
    return cols[name];
  },
});

export function transaction(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
