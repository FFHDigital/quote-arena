export type CriterionKey =
  | "online_availability"
  | "time_to_quote"
  | "form_burden"
  | "entry_barriers"
  | "data_lookups"
  | "findability"
  | "clarity_errors"
  | "mobile";

export type Outcome =
  | "price_shown"
  | "blocked_account"
  | "blocked_otp"
  | "blocked_captcha"
  | "callback_only"
  | "no_online_quote"
  | "gave_up"
  | "error";

export type Barrier = "account" | "otp" | "captcha" | "callback";

/** Everything code can count from a recorded journey. */
export interface AuditMetrics {
  outcome: Outcome;
  priceText: string | null;
  steps: number;
  clicksToStart: number | null;
  fieldsTotal: number;
  fieldsRequired: number;
  fieldsPrefilled: number;
  lookupsUsed: number;
  errorsShown: number;
  barriers: Barrier[];
  estimatedHumanSeconds: number | null;
  pageLoadSeconds: number;
  mobile: { checked: boolean; horizontalOverflow: boolean; smallTapTargets: number; formReachable: boolean };
}

export interface CriterionScore {
  score: number;
  evidence: string[];
  note: string;
  source: "code" | "llm" | "rules";
}

export type AuditScores = Record<CriterionKey, CriterionScore>;

export interface Persona {
  label: string;
  fields: Record<string, string>;
}

export interface EvidenceRow {
  id: number;
  audit_id: number;
  ref: string;
  step_no: number;
  kind: "nav" | "page" | "lookup" | "error" | "blocker" | "price" | "mobile" | "note";
  url: string | null;
  summary: string;
  screenshot: string | null;
  payload: string | null;
}

export interface AuditRow {
  id: number;
  insurer_id: number;
  product_line_id: string;
  persona_id: string;
  status: "queued" | "running" | "captured" | "scored" | "failed";
  driver: string | null;
  started_at: string | null;
  finished_at: string | null;
  outcome: Outcome | null;
  metrics: string | null;
  scores: string | null;
  overall: number | null;
  notes: string | null;
  error: string | null;
  rubric_version: string | null;
  prompt_version: string | null;
  cost_usd: number;
}

export interface InsurerRow {
  id: number;
  slug: string;
  name: string;
  country_code: string;
  home_url: string;
  licence_ref: string | null;
  logo_color: string;
  active: number;
  audit_allowed: number;
  is_demo: number;
}

export interface VerdictCriterion {
  criterion: CriterionKey;
  a: { score: number; evidence: string[] };
  b: { score: number; evidence: string[] };
  note: string;
}

export interface VerdictRow {
  id: number;
  audit_a_id: number;
  audit_b_id: number;
  winner: "a" | "b" | "tie";
  margin: "clear" | "narrow" | "tie";
  reason: string;
  criteria: string;
  caveats: string;
  judge: string;
  prompt_version: string;
  order_agreement: number;
  needs_review: number;
  created_at: string;
}

export interface JobRow {
  id: number;
  type: "audit" | "compare";
  payload: string;
  status: "queued" | "running" | "done" | "failed";
  progress: string;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
