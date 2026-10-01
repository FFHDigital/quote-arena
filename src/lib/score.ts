import { z } from "zod";
import { all, get, now, run } from "./db";
import { structured, usesAi, type LlmMode } from "./llm";
import { CRITERIA, RUBRIC_VERSION, codeScores, overallScore, ruleScores, type EvidenceIndex } from "./rubric";
import type { AuditMetrics, AuditRow, AuditScores, CriterionScore, EvidenceRow } from "./types";

export const SCORER_PROMPT_VERSION = "scorer-v1";

const JUDGED = ["online_availability", "data_lookups", "clarity_errors", "mobile"] as const;

const Scored = z.object({ score: z.number(), evidence: z.array(z.string()), note: z.string() });
const ScorerOutput = z.object(Object.fromEntries(JUDGED.map((k) => [k, Scored])) as Record<(typeof JUDGED)[number], typeof Scored>);

const scoredJson = {
  type: "object",
  properties: {
    score: { type: "integer", description: "0 to 10" },
    evidence: { type: "array", items: { type: "string" }, description: "Evidence refs such as E3" },
    note: { type: "string", description: "One sentence citing what the evidence shows" },
  },
  required: ["score", "evidence", "note"],
  additionalProperties: false,
};
const SCORER_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(JUDGED.map((k) => [k, scoredJson])),
  required: [...JUDGED],
  additionalProperties: false,
};

const SCORER_SYSTEM = `You score one insurer's online quote journey against a fixed rubric.
Judge ONLY from the recorded evidence and metrics provided. Ignore anything you know about the brand.
Every score must cite at least one evidence ref (like "E3") from the list, and only refs that appear in it.
Scores are integers from 0 (worst) to 10 (best).

Criteria you score:
${CRITERIA.filter((c) => (JUDGED as readonly string[]).includes(c.key))
  .map((c) => `- ${c.key} (${c.label}): ${c.measures}. 10 = ${c.best}. 0 = ${c.worst}.`)
  .join("\n")}

Guidance:
- online_availability: 10 only if a price was shown online without talking to anyone. A callback-only or phone-only journey is 0-1. A price hidden behind an account or code is 2-4.
- data_lookups: reward lookups that prefilled many fields; 0-2 if everything was typed.
- clarity_errors: consider wording, help text and any validation errors (and whether their messages were helpful). Cryptic error codes cost points.
- mobile: use the phone-sized screen check.`;

export function evidenceIndex(rows: EvidenceRow[]): EvidenceIndex {
  const by = (kind: EvidenceRow["kind"]) => rows.filter((r) => r.kind === kind).map((r) => r.ref);
  return { pages: by("page"), nav: by("nav"), blockers: by("blocker"), price: by("price"), lookups: by("lookup"), errors: by("error"), mobile: by("mobile") };
}

export function evidenceDigest(rows: EvidenceRow[]): string {
  return rows
    .map((r) => {
      let line = `${r.ref} [${r.kind}, step ${r.step_no}] ${r.summary}`;
      if (r.kind === "page" && r.payload) {
        const fields = (JSON.parse(r.payload) as { fields: { label: string; kind: string; required: boolean }[] }).fields;
        line += `\n    fields: ${fields.map((f) => `${f.label}${f.required ? "*" : ""} (${f.kind})`).join("; ")}`;
      }
      return line;
    })
    .join("\n");
}

async function llmScores(audit: AuditRow, metrics: AuditMetrics, rows: EvidenceRow[], mode: LlmMode) {
  const refs = new Set(rows.map((r) => r.ref));
  const prompt = `Product line: ${audit.product_line_id}
Metrics (computed by code): ${JSON.stringify(metrics)}
Agent notes: ${audit.notes ?? "(none)"}

Evidence:
${evidenceDigest(rows)}`;

  let cost = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, cost: c } = await structured(
      mode,
      { role: "scorer", system: SCORER_SYSTEM, prompt, maxTokens: 4000, effort: "high" },
      ScorerOutput,
      SCORER_SCHEMA,
    );
    cost += c;
    const bad = JUDGED.some((k) => data[k].evidence.some((r) => !refs.has(r)) || (rows.length > 0 && data[k].evidence.length === 0));
    if (bad) continue;
    const out = {} as Record<(typeof JUDGED)[number], CriterionScore>;
    for (const k of JUDGED) out[k] = { score: Math.max(0, Math.min(10, Math.round(data[k].score))), evidence: data[k].evidence, note: data[k].note, source: "llm" };
    return { scores: out, cost };
  }
  return { scores: null, cost };
}

export async function scoreAudit(auditId: number, mode: LlmMode = "rules"): Promise<void> {
  const audit = get<AuditRow>(`SELECT * FROM audits WHERE id = ?`, auditId);
  if (!audit?.metrics) throw new Error(`Audit ${auditId} has no captured journey.`);
  const metrics = JSON.parse(audit.metrics) as AuditMetrics;
  const rows = all<EvidenceRow>(`SELECT * FROM evidence WHERE audit_id = ? ORDER BY id`, auditId);
  const idx = evidenceIndex(rows);

  let judged: Pick<AuditScores, (typeof JUDGED)[number]> = ruleScores(metrics, idx);
  let cost = 0;
  let promptVersion = "rules";
  if (usesAi(mode)) {
    const res = await llmScores(audit, metrics, rows, mode).catch((err) => {
      // A failed AI call falls back to the rule-based scores rather than losing the audit.
      console.error(`Scoring audit ${auditId} with ${mode} failed:`, err instanceof Error ? err.message : err);
      return { scores: null, cost: 0 };
    });
    cost = res.cost;
    if (res.scores) {
      judged = res.scores;
      promptVersion = SCORER_PROMPT_VERSION;
    }
  }
  const scores: AuditScores = { ...codeScores(metrics, idx), ...judged };
  run(
    `UPDATE audits SET status = 'scored', scores = ?, overall = ?, rubric_version = ?, prompt_version = ?, finished_at = ?, cost_usd = cost_usd + ? WHERE id = ?`,
    JSON.stringify(scores), overallScore(scores, metrics.outcome), RUBRIC_VERSION, promptVersion, now(), cost, auditId,
  );
}
