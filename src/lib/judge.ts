import { z } from "zod";
import { all, get, now, run, tx } from "./db";
import { MODELS } from "./claude";
import { structured, usesAi, type LlmMode } from "./llm";
import { CRITERIA, CRITERION_BY_KEY, marginFor } from "./rubric";
import { evidenceDigest } from "./score";
import type { AuditMetrics, AuditRow, AuditScores, CriterionKey, EvidenceRow, InsurerRow, VerdictCriterion, VerdictRow } from "./types";

export const JUDGE_PROMPT_VERSION = "judge-v1";
const ELO_K = 32;

const KEYS = CRITERIA.map((c) => c.key) as [CriterionKey, ...CriterionKey[]];

const JudgeOutput = z.object({
  winner: z.enum(["insurer_1", "insurer_2", "tie"]),
  reason: z.string(),
  criteria: z.array(z.object({ criterion: z.enum(KEYS), insurer_1_evidence: z.array(z.string()), insurer_2_evidence: z.array(z.string()), note: z.string() })),
  caveats: z.array(z.string()),
});
type JudgeOutput = z.infer<typeof JudgeOutput>;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    winner: { type: "string", enum: ["insurer_1", "insurer_2", "tie"] },
    reason: { type: "string", description: "One or two plain sentences, at most 280 characters, naming the decisive differences." },
    criteria: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string", enum: KEYS },
          insurer_1_evidence: { type: "array", items: { type: "string" } },
          insurer_2_evidence: { type: "array", items: { type: "string" } },
          note: { type: "string", description: "One short sentence comparing the two on this criterion." },
        },
        required: ["criterion", "insurer_1_evidence", "insurer_2_evidence", "note"],
        additionalProperties: false,
      },
    },
    caveats: { type: "array", items: { type: "string" } },
  },
  required: ["winner", "reason", "criteria", "caveats"],
  additionalProperties: false,
};

const JUDGE_SYSTEM = `You are an impartial auditor comparing two insurers' online quote journeys.
Decide which insurer makes it EASIER for an ordinary customer to get a quote. Price, cover and claims do not matter here.
Judge ONLY from the evidence, metrics and rubric scores provided. The insurers are anonymised; ignore any brand knowledge.

Rubric (weights):
${CRITERIA.map((c) => `- ${c.key} (${Math.round(c.weight * 100)}%): ${c.measures}`).join("\n")}
A journey that never shows a price online is capped at 30/100 overall.

Rules:
- Give one entry in "criteria" per rubric criterion, in rubric order, citing evidence refs exactly as written (like "1:E3" or "2:E5").
- Say "tie" only when the journeys are genuinely about as easy.
- Refer to the insurers only as "Insurer 1" and "Insurer 2".
- Caveats: anything the evidence could not show (for example, the journey stopped early).`;

interface Side {
  audit: AuditRow;
  insurer: InsurerRow;
  metrics: AuditMetrics;
  scores: AuditScores;
  evidence: EvidenceRow[];
}

function loadSide(auditId: number): Side {
  const audit = get<AuditRow>(`SELECT * FROM audits WHERE id = ?`, auditId);
  if (!audit || audit.status !== "scored") throw new Error(`Audit ${auditId} is not scored yet.`);
  return {
    audit,
    insurer: get<InsurerRow>(`SELECT * FROM insurers WHERE id = ?`, audit.insurer_id)!,
    metrics: JSON.parse(audit.metrics!) as AuditMetrics,
    scores: JSON.parse(audit.scores!) as AuditScores,
    evidence: all<EvidenceRow>(`SELECT * FROM evidence WHERE audit_id = ? ORDER BY id`, auditId),
  };
}

function sideBlock(n: 1 | 2, s: Side): string {
  const digest = evidenceDigest(s.evidence).replace(/^E(\d+)/gm, `${n}:E$1`);
  const scoreLines = CRITERIA.map((c) => `  ${c.key}: ${s.scores[c.key].score}/10 - ${s.scores[c.key].note} [${s.scores[c.key].evidence.map((r) => `${n}:${r}`).join(", ")}]`).join("\n");
  return `## Insurer ${n}
Overall: ${s.audit.overall}/100. Outcome: ${s.metrics.outcome}.
Metrics: ${JSON.stringify(s.metrics)}
Rubric scores:
${scoreLines}
Evidence:
${digest}`;
}

async function askJudge(first: Side, second: Side, mode: LlmMode): Promise<{ out: JudgeOutput; cost: number; valid: boolean }> {
  const refs = new Set([...first.evidence.map((e) => `1:${e.ref}`), ...second.evidence.map((e) => `2:${e.ref}`)]);
  const content = `Product line: ${first.audit.product_line_id}\n\n${sideBlock(1, first)}\n\n${sideBlock(2, second)}\n\nWhich insurer makes it easier to get a quote?`;
  let cost = 0;
  let last: JudgeOutput | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, cost: c } = await structured(
      mode,
      { role: "judge", system: JUDGE_SYSTEM, prompt: content, maxTokens: 6000, effort: "high" },
      JudgeOutput,
      JUDGE_SCHEMA,
    );
    cost += c;
    last = data;
    const cited = data.criteria.flatMap((c) => [...c.insurer_1_evidence, ...c.insurer_2_evidence]);
    if (cited.every((r) => refs.has(r))) return { out: data, cost, valid: true };
  }
  return { out: last!, cost, valid: false };
}

function withNames(text: string, one: string, two: string) {
  return text.replace(/Insurer 1/g, one).replace(/Insurer 2/g, two);
}

function strip(refs: string[], n: 1 | 2) {
  return refs.filter((r) => r.startsWith(`${n}:`)).map((r) => r.slice(2));
}

function ruleVerdict(a: Side, b: Side) {
  const gap = (a.audit.overall ?? 0) - (b.audit.overall ?? 0);
  const margin = marginFor(gap);
  const winner: VerdictRow["winner"] = margin === "tie" ? "tie" : gap > 0 ? "a" : "b";
  const diffs = CRITERIA.map((c) => ({ c, d: (a.scores[c.key].score - b.scores[c.key].score) * c.weight })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const [w, l] = winner === "b" ? [b, a] : [a, b];
  const top = diffs.filter((x) => (winner === "b" ? x.d < 0 : x.d > 0)).slice(0, 2).map((x) => x.c.label.toLowerCase());
  const reason =
    winner === "tie"
      ? `${a.insurer.name} and ${b.insurer.name} are about as easy to get a quote from (${a.audit.overall} vs ${b.audit.overall}).`
      : `${w.insurer.name} is easier to get a quote from than ${l.insurer.name}${top.length ? `, mainly on ${top.join(" and ")}` : ""} (${w.audit.overall} vs ${l.audit.overall}).`;
  const criteria: VerdictCriterion[] = CRITERIA.map((c) => ({
    criterion: c.key,
    a: { score: a.scores[c.key].score, evidence: a.scores[c.key].evidence },
    b: { score: b.scores[c.key].score, evidence: b.scores[c.key].evidence },
    note: `${a.insurer.name}: ${a.scores[c.key].note} ${b.insurer.name}: ${b.scores[c.key].note}`,
  }));
  return { winner, margin, reason, criteria, caveats: [] as string[], orderAgreement: true, needsReview: false };
}

async function llmVerdict(a: Side, b: Side, mode: LlmMode) {
  const [ab, ba] = await Promise.all([askJudge(a, b, mode), askJudge(b, a, mode)]);
  const map1 = { insurer_1: "a", insurer_2: "b", tie: "tie" } as const;
  const map2 = { insurer_1: "b", insurer_2: "a", tie: "tie" } as const;
  const w1 = map1[ab.out.winner];
  const w2 = map2[ba.out.winner];
  const orderAgreement = w1 === w2;
  const winner: VerdictRow["winner"] = orderAgreement ? w1 : "tie";

  const gap = (a.audit.overall ?? 0) - (b.audit.overall ?? 0);
  const scoreLeader = marginFor(gap) === "tie" ? "tie" : gap > 0 ? "a" : "b";
  const margin = winner === "tie" ? "tie" : marginFor(gap) === "tie" ? "narrow" : marginFor(gap);
  // A clear score gap that the judge contradicts goes to a human.
  const needsReview = !ab.valid || !ba.valid || (marginFor(gap) === "clear" && winner !== scoreLeader);

  const byKey = new Map(ab.out.criteria.map((c) => [c.criterion, c]));
  const criteria: VerdictCriterion[] = CRITERIA.map((c) => {
    const j = byKey.get(c.key);
    return {
      criterion: c.key,
      a: { score: a.scores[c.key].score, evidence: j ? strip(j.insurer_1_evidence, 1) : a.scores[c.key].evidence },
      b: { score: b.scores[c.key].score, evidence: j ? strip(j.insurer_2_evidence, 2) : b.scores[c.key].evidence },
      note: j ? withNames(j.note, a.insurer.name, b.insurer.name) : CRITERION_BY_KEY[c.key].measures,
    };
  });
  const caveats = ab.out.caveats.map((c) => withNames(c, a.insurer.name, b.insurer.name));
  if (!orderAgreement) caveats.push("The judge's pick changed when the insurers were presented in the other order, so this is scored as a tie.");
  const reason = withNames(ab.out.reason, a.insurer.name, b.insurer.name);
  return { winner, margin, reason, criteria, caveats, orderAgreement, needsReview, cost: ab.cost + ba.cost };
}

function expected(ra: number, rb: number) {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

function updateElo(a: Side, b: Side, winner: VerdictRow["winner"]) {
  const product = a.audit.product_line_id;
  const rating = (insurerId: number) => {
    run(`INSERT OR IGNORE INTO ratings (insurer_id, product_line_id, updated_at) VALUES (?, ?, ?)`, insurerId, product, now());
    return get<{ elo: number }>(`SELECT elo FROM ratings WHERE insurer_id = ? AND product_line_id = ?`, insurerId, product)!.elo;
  };
  const ra = rating(a.insurer.id);
  const rb = rating(b.insurer.id);
  const sa = winner === "a" ? 1 : winner === "b" ? 0 : 0.5;
  const ea = expected(ra, rb);
  const upd = `UPDATE ratings SET elo = ?, matches = matches + 1, wins = wins + ?, ties = ties + ?, updated_at = ? WHERE insurer_id = ? AND product_line_id = ?`;
  run(upd, ra + ELO_K * (sa - ea), sa === 1 ? 1 : 0, sa === 0.5 ? 1 : 0, now(), a.insurer.id, product);
  run(upd, rb + ELO_K * (1 - sa - (1 - ea)), sa === 0 ? 1 : 0, sa === 0.5 ? 1 : 0, now(), b.insurer.id, product);
}

export function findVerdict(auditA: number, auditB: number): VerdictRow | undefined {
  return get<VerdictRow>(
    `SELECT * FROM verdicts WHERE ((audit_a_id = ? AND audit_b_id = ?) OR (audit_a_id = ? AND audit_b_id = ?)) ORDER BY id DESC LIMIT 1`,
    auditA, auditB, auditB, auditA,
  );
}

export async function judgePair(auditA: number, auditB: number, mode: LlmMode = "rules"): Promise<number> {
  const existing = findVerdict(auditA, auditB);
  if (existing) return existing.id;
  const a = loadSide(auditA);
  const b = loadSide(auditB);

  let v: ReturnType<typeof ruleVerdict> & { cost?: number };
  let judge = "rules";
  v = ruleVerdict(a, b);
  if (usesAi(mode)) {
    try {
      v = await llmVerdict(a, b, mode);
      judge = mode === "api" ? MODELS.judge : mode;
    } catch (err) {
      console.error(`Judging audits ${auditA} and ${auditB} with ${mode} failed; using the rule-based verdict:`, err instanceof Error ? err.message : err);
    }
  }

  return tx(() => {
    const res = run(
      `INSERT INTO verdicts (audit_a_id, audit_b_id, winner, margin, reason, criteria, caveats, judge, prompt_version, order_agreement, needs_review, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      auditA, auditB, v.winner, v.margin, v.reason, JSON.stringify(v.criteria), JSON.stringify(v.caveats), judge,
      judge === "rules" ? "rules" : JUDGE_PROMPT_VERSION, v.orderAgreement ? 1 : 0, v.needsReview ? 1 : 0, now(),
    );
    updateElo(a, b, v.winner);
    return Number(res.lastInsertRowid);
  });
}
