import { get, now, run } from "./db";
import type { JobRow } from "./types";

export interface ComparePayload {
  insurerA: number;
  insurerB: number;
  product: string;
}

export interface AuditPayload {
  insurerId: number;
  product: string;
}

export interface ProgressEntry {
  t: string;
  msg: string;
}

export function enqueue(type: JobRow["type"], payload: ComparePayload | AuditPayload): number {
  const body = JSON.stringify(payload);
  const open = get<{ id: number }>(`SELECT id FROM jobs WHERE type = ? AND payload = ? AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1`, type, body);
  if (open) return open.id;
  const res = run(`INSERT INTO jobs (type, payload, created_at, updated_at) VALUES (?, ?, ?, ?)`, type, body, now(), now());
  return Number(res.lastInsertRowid);
}

export function job(id: number): JobRow | undefined {
  return get<JobRow>(`SELECT * FROM jobs WHERE id = ?`, id);
}

/** Atomically takes the oldest queued job. */
export function claimNext(): JobRow | undefined {
  return get<JobRow>(
    `UPDATE jobs SET status = 'running', updated_at = ? WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1) RETURNING *`,
    now(),
  );
}

export function progress(id: number, msg: string) {
  const row = job(id);
  if (!row) return;
  const entries = JSON.parse(row.progress) as ProgressEntry[];
  entries.push({ t: now(), msg });
  run(`UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?`, JSON.stringify(entries), now(), id);
}

export function complete(id: number, result: unknown) {
  run(`UPDATE jobs SET status = 'done', result = ?, updated_at = ? WHERE id = ?`, JSON.stringify(result), now(), id);
}

export function fail(id: number, error: string) {
  run(`UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`, error, now(), id);
}

/** Jobs left 'running' by a crashed worker go back in the queue. */
export function requeueStale(minutes = 30) {
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
  run(`UPDATE jobs SET status = 'queued' WHERE status = 'running' AND updated_at < ?`, cutoff);
}
