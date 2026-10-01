import { all, get } from "./db";
import { CRITERIA } from "./rubric";
import { ensureSeeded } from "./seed";
import type { AuditMetrics, AuditRow, AuditScores, CriterionKey, EvidenceRow, InsurerRow, Persona, VerdictCriterion, VerdictRow } from "./types";

export interface EvidenceItem {
  id: number;
  ref: string;
  kind: EvidenceRow["kind"];
  step: number;
  url: string | null;
  summary: string;
  screenshot: string | null;
  fields: { label: string; kind: string; required: boolean }[] | null;
}

export interface AuditView {
  id: number;
  insurer: { id: number; name: string; slug: string; color: string; country: string; homeUrl: string; isDemo: boolean };
  product: string;
  persona: string;
  driver: string | null;
  finishedAt: string | null;
  outcome: AuditMetrics["outcome"];
  overall: number;
  metrics: AuditMetrics;
  scores: AuditScores;
  notes: string | null;
  scoredBy: string | null;
  costUsd: number;
  evidence: EvidenceItem[];
}

function toItem(e: EvidenceRow): EvidenceItem {
  const payload = e.payload ? (JSON.parse(e.payload) as { fields?: EvidenceItem["fields"] }) : null;
  return {
    id: e.id,
    ref: e.ref,
    kind: e.kind,
    step: e.step_no,
    url: e.url,
    summary: e.summary,
    screenshot: e.screenshot ? `/api/evidence/${e.id}/screenshot` : null,
    fields: payload?.fields ?? null,
  };
}

export function auditView(id: number): AuditView | null {
  const a = get<AuditRow>(`SELECT * FROM audits WHERE id = ?`, id);
  if (!a || a.status !== "scored") return null;
  const i = get<InsurerRow>(`SELECT * FROM insurers WHERE id = ?`, a.insurer_id)!;
  const persona = get<{ data: string }>(`SELECT data FROM personas WHERE id = ?`, a.persona_id);
  return {
    id: a.id,
    insurer: { id: i.id, name: i.name, slug: i.slug, color: i.logo_color, country: i.country_code, homeUrl: i.home_url, isDemo: !!i.is_demo },
    product: a.product_line_id,
    persona: persona ? (JSON.parse(persona.data) as Persona).label : a.persona_id,
    driver: a.driver,
    finishedAt: a.finished_at,
    outcome: a.outcome!,
    overall: a.overall ?? 0,
    metrics: JSON.parse(a.metrics!) as AuditMetrics,
    scores: JSON.parse(a.scores!) as AuditScores,
    notes: a.notes,
    scoredBy: a.prompt_version,
    costUsd: a.cost_usd,
    evidence: all<EvidenceRow>(`SELECT * FROM evidence WHERE audit_id = ? ORDER BY id`, id).map(toItem),
  };
}

export interface VerdictView {
  id: number;
  createdAt: string;
  judge: string;
  orderAgreement: boolean;
  needsReview: boolean;
  winner: "a" | "b" | "tie";
  margin: VerdictRow["margin"];
  reason: string;
  caveats: string[];
  a: AuditView;
  b: AuditView;
  criteria: (VerdictCriterion & { label: string; weight: number })[];
}

/**
 * A verdict seen from the order the user asked for: `firstInsurerId` becomes side A,
 * even if the stored verdict was judged the other way round.
 */
export function verdictView(id: number, firstInsurerId?: number): VerdictView | null {
  const v = get<VerdictRow>(`SELECT * FROM verdicts WHERE id = ?`, id);
  if (!v) return null;
  let a = auditView(v.audit_a_id);
  let b = auditView(v.audit_b_id);
  if (!a || !b) return null;
  let criteria = JSON.parse(v.criteria) as VerdictCriterion[];
  let winner = v.winner;
  if (firstInsurerId !== undefined && b.insurer.id === firstInsurerId) {
    [a, b] = [b, a];
    criteria = criteria.map((c) => ({ ...c, a: c.b, b: c.a }));
    winner = winner === "a" ? "b" : winner === "b" ? "a" : "tie";
  }
  const meta = Object.fromEntries(CRITERIA.map((c) => [c.key, c])) as Record<CriterionKey, (typeof CRITERIA)[number]>;
  return {
    id: v.id,
    createdAt: v.created_at,
    judge: v.judge,
    orderAgreement: !!v.order_agreement,
    needsReview: !!v.needs_review,
    winner,
    margin: v.margin,
    reason: v.reason,
    caveats: JSON.parse(v.caveats) as string[],
    a,
    b,
    criteria: criteria.map((c) => ({ ...c, label: meta[c.criterion].label, weight: meta[c.criterion].weight })),
  };
}

export interface LeaderboardRow {
  rank: number;
  insurerId: number;
  name: string;
  slug: string;
  color: string;
  elo: number;
  matches: number;
  wins: number;
  ties: number;
  overall: number | null;
  auditId: number | null;
  weakest: string | null;
}

export function leaderboard(country: string, product: string): LeaderboardRow[] {
  ensureSeeded();
  const rows = all<{ id: number; name: string; slug: string; logo_color: string; elo: number; matches: number; wins: number; ties: number }>(
    `SELECT i.id, i.name, i.slug, i.logo_color, r.elo, r.matches, r.wins, r.ties
     FROM ratings r JOIN insurers i ON i.id = r.insurer_id
     WHERE i.country_code = ? AND r.product_line_id = ? AND i.active = 1
     ORDER BY r.elo DESC`,
    country, product,
  );
  return rows.map((r, n) => {
    const audit = get<AuditRow>(
      `SELECT * FROM audits WHERE insurer_id = ? AND product_line_id = ? AND status = 'scored' ORDER BY finished_at DESC LIMIT 1`,
      r.id, product,
    );
    let weakest: string | null = null;
    if (audit?.scores) {
      const s = JSON.parse(audit.scores) as AuditScores;
      const worst = [...CRITERIA].sort((x, y) => s[x.key].score - s[y.key].score)[0];
      if (s[worst.key].score < 8) weakest = worst.label;
    }
    return {
      rank: n + 1,
      insurerId: r.id,
      name: r.name,
      slug: r.slug,
      color: r.logo_color,
      elo: Math.round(r.elo),
      matches: r.matches,
      wins: r.wins,
      ties: r.ties,
      overall: audit?.overall ?? null,
      auditId: audit?.id ?? null,
      weakest,
    };
  });
}
