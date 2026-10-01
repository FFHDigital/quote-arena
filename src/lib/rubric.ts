import type { AuditMetrics, AuditScores, CriterionKey, CriterionScore } from "./types";

export const RUBRIC_VERSION = "rubric-v1";
export const AUDIT_TTL_DAYS = 30;

export interface Criterion {
  key: CriterionKey;
  label: string;
  weight: number;
  measures: string;
  best: string;
  worst: string;
  /** "code" criteria are computed from the journey log; "llm" ones are judged from evidence. */
  scoredBy: "code" | "llm";
}

export const CRITERIA: Criterion[] = [
  { key: "online_availability", label: "Online availability", weight: 0.2, measures: "Can a price be seen online at all?", best: "Instant online price", worst: "Phone or branch only", scoredBy: "llm" },
  { key: "time_to_quote", label: "Time to quote", weight: 0.15, measures: "Estimated time for a person to go from the quote start to a price", best: "Under 3 minutes", worst: "Over 20 minutes, or no price", scoredBy: "code" },
  { key: "form_burden", label: "Form burden", weight: 0.15, measures: "Required fields and steps", best: "10 fields or fewer", worst: "Over 60 fields", scoredBy: "code" },
  { key: "entry_barriers", label: "Entry barriers", weight: 0.15, measures: "Account creation, email/SMS codes or CAPTCHA before a price", best: "None", worst: "Account and code before any price", scoredBy: "code" },
  { key: "data_lookups", label: "Data lookups", weight: 0.1, measures: "Auto-fill from registration, postcode or address lookups", best: "Most fields prefilled", worst: "Everything typed by hand", scoredBy: "llm" },
  { key: "findability", label: "Findability", weight: 0.1, measures: "Clicks from the home page to the quote form", best: "1 click", worst: "More than 4 clicks, or hidden", scoredBy: "code" },
  { key: "clarity_errors", label: "Clarity and errors", weight: 0.1, measures: "Plain wording, inline validation, help text, error recovery", best: "Clear and forgiving", worst: "Jargon, data lost on error", scoredBy: "llm" },
  { key: "mobile", label: "Mobile experience", weight: 0.05, measures: "The same journey on a 390 px wide screen", best: "Works fully", worst: "Broken or desktop only", scoredBy: "llm" },
];

export const CRITERION_BY_KEY = Object.fromEntries(CRITERIA.map((c) => [c.key, c])) as Record<CriterionKey, Criterion>;

/** Overall score is capped here when no price could be reached online (hard blocker). */
export const HARD_BLOCKER_CAP = 30;

function band(value: number, bands: [number, number][], fallback: number): number {
  for (const [max, score] of bands) if (value <= max) return score;
  return fallback;
}

type EvidenceIndex = { pages: string[]; nav: string[]; blockers: string[]; price: string[]; lookups: string[]; errors: string[]; mobile: string[] };

/** Scores for the criteria that are counted, not judged. */
export function codeScores(m: AuditMetrics, ev: EvidenceIndex): Pick<AuditScores, "time_to_quote" | "form_burden" | "entry_barriers" | "findability"> {
  const priced = m.outcome === "price_shown";

  const time: CriterionScore = priced && m.estimatedHumanSeconds !== null
    ? {
        score: band(m.estimatedHumanSeconds, [[180, 10], [300, 8], [480, 6], [720, 4], [1200, 2]], 1),
        evidence: [...ev.pages, ...ev.price].slice(0, 6),
        note: `About ${Math.round(m.estimatedHumanSeconds / 60)} min for a person (${m.fieldsTotal} fields, ${m.steps} steps).`,
        source: "code",
      }
    : { score: 0, evidence: [...ev.blockers].slice(0, 3), note: "No price was reached, so there is no time to quote.", source: "code" };

  let burden = band(m.fieldsRequired, [[10, 10], [20, 8], [30, 6], [45, 4], [60, 2]], 0);
  if (m.steps > 6) burden = Math.max(0, burden - 1);
  if (!priced) burden = Math.min(burden, 5);
  const form: CriterionScore = {
    score: burden,
    evidence: ev.pages.slice(0, 6),
    note: `${m.fieldsRequired} required of ${m.fieldsTotal} fields over ${m.steps} step${m.steps === 1 ? "" : "s"}${priced ? "" : " before the journey stopped"}.`,
    source: "code",
  };

  const penalties: Record<string, number> = { account: 4, otp: 4, captcha: 3, callback: 6 };
  const barrierScore = Math.max(0, 10 - m.barriers.reduce((s, b) => s + (penalties[b] ?? 0), 0));
  const barriers: CriterionScore = {
    score: barrierScore,
    evidence: ev.blockers.slice(0, 4),
    note: m.barriers.length ? `Barriers before a price: ${m.barriers.join(", ")}.` : "No account, code or CAPTCHA was needed before the price.",
    source: "code",
  };

  const find: CriterionScore = m.clicksToStart === null
    ? { score: 0, evidence: ev.nav.slice(0, 4), note: "The quote form was never found.", source: "code" }
    : {
        score: band(m.clicksToStart, [[1, 10], [2, 8], [3, 6], [4, 4]], 2),
        evidence: ev.nav.slice(0, 4),
        note: `${m.clicksToStart} click${m.clicksToStart === 1 ? "" : "s"} from the home page to the quote form.`,
        source: "code",
      };

  return { time_to_quote: time, form_burden: form, entry_barriers: barriers, findability: find };
}

/** Rule-based stand-ins for the judged criteria, used when Claude is unavailable. */
export function ruleScores(m: AuditMetrics, ev: EvidenceIndex): Pick<AuditScores, "online_availability" | "data_lookups" | "clarity_errors" | "mobile"> {
  const availability: Record<string, number> = {
    price_shown: 10, blocked_captcha: 4, blocked_account: 3, blocked_otp: 3, gave_up: 2, error: 2, callback_only: 1, no_online_quote: 0,
  };
  const lookupShare = m.fieldsTotal ? m.fieldsPrefilled / m.fieldsTotal : 0;
  return {
    online_availability: {
      score: availability[m.outcome] ?? 0,
      evidence: [...ev.price, ...ev.blockers].slice(0, 3),
      note: m.outcome === "price_shown" ? `A price was shown online${m.priceText ? `: ${m.priceText}` : ""}.` : `No online price (${m.outcome.replace(/_/g, " ")}).`,
      source: "rules",
    },
    data_lookups: {
      score: m.lookupsUsed === 0 ? 1 : Math.min(10, Math.round(3 + lookupShare * 14)),
      evidence: ev.lookups.slice(0, 4),
      note: m.lookupsUsed ? `${m.lookupsUsed} lookup${m.lookupsUsed === 1 ? "" : "s"} prefilled ${m.fieldsPrefilled} fields.` : "Every field had to be typed by hand.",
      source: "rules",
    },
    clarity_errors: {
      score: Math.max(2, 9 - m.errorsShown * 2),
      evidence: ev.errors.slice(0, 4),
      note: m.errorsShown ? `${m.errorsShown} validation error${m.errorsShown === 1 ? "" : "s"} shown along the way.` : "No validation errors were hit.",
      source: "rules",
    },
    mobile: {
      score: !m.mobile.checked ? 5 : !m.mobile.formReachable ? 2 : m.mobile.horizontalOverflow ? 4 : m.mobile.smallTapTargets > 3 ? 7 : 10,
      evidence: ev.mobile.slice(0, 2),
      note: !m.mobile.checked ? "Mobile check did not run." : m.mobile.horizontalOverflow ? "The page scrolls sideways on a phone-sized screen." : "Works on a phone-sized screen.",
      source: "rules",
    },
  };
}

export function overallScore(scores: AuditScores, outcome: AuditMetrics["outcome"]): number {
  const raw = CRITERIA.reduce((sum, c) => sum + scores[c.key].score * c.weight * 10, 0);
  const capped = outcome === "price_shown" ? raw : Math.min(raw, HARD_BLOCKER_CAP);
  return Math.round(capped * 10) / 10;
}

export function marginFor(gap: number): "clear" | "narrow" | "tie" {
  const g = Math.abs(gap);
  if (g >= 10) return "clear";
  if (g >= 3) return "narrow";
  return "tie";
}

export type { EvidenceIndex };
