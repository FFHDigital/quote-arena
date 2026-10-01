/**
 * Job loop: runs audits (browser + Claude) and pairwise verdicts.
 * Runs as its own process (`npm run worker`) or inside the web server (ARENA_EMBEDDED_WORKER=1).
 */
import { get, now, run } from "./db";
import { claimNext, complete, fail, progress, requeueStale, type AuditPayload, type ComparePayload } from "./jobs";
import { isFresh, latestScoredAudit, personaFor } from "./queries";
import { runAudit } from "./audit/runAudit";
import { judgePair } from "./judge";
import { claudeAvailable } from "./claude";
import { ensureSeeded } from "./seed";
import type { InsurerRow } from "./types";

const POLL_MS = 1500;

async function auditInsurer(jobId: number, insurerId: number, product: string, force: boolean): Promise<number> {
  const insurer = get<InsurerRow>(`SELECT * FROM insurers WHERE id = ?`, insurerId);
  if (!insurer) throw new Error(`Insurer ${insurerId} not found`);
  const existing = latestScoredAudit(insurerId, product);
  if (!force && existing && isFresh(existing)) {
    progress(jobId, `Using the audit of ${insurer.name} from ${existing.finished_at?.slice(0, 10)}`);
    return existing.id;
  }
  const persona = personaFor(insurer.country_code, product);
  if (!persona) throw new Error(`No persona for ${insurer.country_code} ${product}`);
  const res = run(`INSERT INTO audits (insurer_id, product_line_id, persona_id, status) VALUES (?, ?, ?, 'queued')`, insurerId, product, persona);
  const auditId = Number(res.lastInsertRowid);
  progress(jobId, `Auditing ${insurer.name}`);
  try {
    await runAudit(auditId, (msg) => progress(jobId, `${insurer.name}: ${msg}`));
  } catch (err) {
    run(`UPDATE audits SET status = 'failed', error = ?, finished_at = ? WHERE id = ?`, err instanceof Error ? err.message : String(err), now(), auditId);
    throw err;
  }
  return auditId;
}

async function handle(job: NonNullable<ReturnType<typeof claimNext>>) {
  const payload = JSON.parse(job.payload);
  if (job.type === "compare") {
    const p = payload as ComparePayload;
    const a = await auditInsurer(job.id, p.insurerA, p.product, false);
    const b = await auditInsurer(job.id, p.insurerB, p.product, false);
    progress(job.id, claudeAvailable() ? "Judging the pair (both orders)" : "Comparing scores (rule-based judge)");
    const verdictId = await judgePair(a, b);
    complete(job.id, { verdictId, auditA: a, auditB: b });
  } else {
    const p = payload as AuditPayload;
    const auditId = await auditInsurer(job.id, p.insurerId, p.product, true);
    complete(job.id, { auditId });
  }
}

/** Polls the jobs table forever (or until the queue is empty with `once`). */
export async function runWorker({ once = false }: { once?: boolean } = {}) {
  ensureSeeded();
  requeueStale();
  console.log(`Quote Arena worker started (${claudeAvailable() ? "Claude agent + judge" : "rule-based driver and judge: set ANTHROPIC_API_KEY to use Claude"}).`);
  for (;;) {
    const job = claimNext();
    if (!job) {
      if (once) return;
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    console.log(`Job ${job.id} (${job.type}) started`);
    try {
      await handle(job);
      console.log(`Job ${job.id} done`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Job ${job.id} failed: ${msg}`);
      progress(job.id, `Failed: ${msg}`);
      fail(job.id, msg);
    }
  }
}
