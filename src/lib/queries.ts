import { all, get } from "./db";
import { AUDIT_TTL_DAYS } from "./rubric";
import { driverName, type LlmMode } from "./llm";
import { ensureSeeded } from "./seed";
import type { AuditRow, InsurerRow } from "./types";

export interface CountryOption {
  code: string;
  name: string;
  flag: string;
}

export interface InsurerOption {
  id: number;
  slug: string;
  name: string;
  color: string;
  isDemo: boolean;
  auditedAt: string | null;
  fresh: boolean;
  overall: number | null;
  /** Parent group, e.g. "Fairfax". */
  group: string | null;
  /** Why a new audit can't run yet; null when the insurer can be compared now. */
  blocker: string | null;
}

/** Insurers the public can pick. Ones with audits switched off are listed but can only be compared on existing audits. */
const ELIGIBLE = `i.active = 1`;

export function countries(): CountryOption[] {
  ensureSeeded();
  return all<CountryOption>(
    `SELECT c.code, c.name, c.flag FROM countries c
     WHERE c.enabled = 1 AND EXISTS (
       SELECT 1 FROM insurer_products ip JOIN insurers i ON i.id = ip.insurer_id
       WHERE i.country_code = c.code AND ${ELIGIBLE}
       GROUP BY ip.product_line_id HAVING COUNT(*) >= 2)
     ORDER BY c.code = 'ZZ' DESC, c.name`,
  );
}

export function products(countryCode: string): { id: string; name: string; available: boolean }[] {
  ensureSeeded();
  return all<{ id: string; name: string; n: number }>(
    `SELECT p.id, p.name, (
       SELECT COUNT(*) FROM insurer_products ip JOIN insurers i ON i.id = ip.insurer_id
       WHERE ip.product_line_id = p.id AND i.country_code = ? AND ${ELIGIBLE}) AS n
     FROM product_lines p ORDER BY p.sort`,
    countryCode,
  ).map((p) => ({ id: p.id, name: p.name, available: p.n >= 2 }));
}

/** Latest scored audit, optionally only those run by a given AI mode (each AI keeps its own results). */
export function latestScoredAudit(insurerId: number, product: string, mode?: LlmMode): AuditRow | undefined {
  if (!mode) {
    return get<AuditRow>(
      `SELECT * FROM audits WHERE insurer_id = ? AND product_line_id = ? AND status = 'scored' ORDER BY finished_at DESC, id DESC LIMIT 1`,
      insurerId, product,
    );
  }
  return get<AuditRow>(
    `SELECT * FROM audits WHERE insurer_id = ? AND product_line_id = ? AND status = 'scored' AND driver = ? ORDER BY finished_at DESC, id DESC LIMIT 1`,
    insurerId, product, driverName(mode),
  );
}

export function isFresh(audit: AuditRow | undefined): boolean {
  if (!audit?.finished_at) return false;
  return Date.now() - Date.parse(audit.finished_at) < AUDIT_TTL_DAYS * 86_400_000;
}

export function insurers(countryCode: string, product: string, mode?: LlmMode): InsurerOption[] {
  ensureSeeded();
  const rows = all<InsurerRow>(
    `SELECT i.* FROM insurers i JOIN insurer_products ip ON ip.insurer_id = i.id
     WHERE i.country_code = ? AND ip.product_line_id = ? AND ${ELIGIBLE} ORDER BY i.name`,
    countryCode, product,
  );
  return rows.map((i) => {
    const a = latestScoredAudit(i.id, product, mode);
    return {
      id: i.id,
      slug: i.slug,
      name: i.name,
      color: i.logo_color,
      isDemo: !!i.is_demo,
      auditedAt: a?.finished_at ?? null,
      fresh: isFresh(a),
      overall: a?.overall ?? null,
      group: i.parent_group,
      blocker: auditBlocker(i, product, a),
    };
  });
}

export function insurerBySlug(countryCode: string, slug: string): InsurerRow | undefined {
  ensureSeeded();
  return get<InsurerRow>(`SELECT * FROM insurers WHERE country_code = ? AND slug = ?`, countryCode, slug);
}

export function personaFor(countryCode: string, product: string): string | undefined {
  return get<{ id: string }>(`SELECT id FROM personas WHERE country_code = ? AND product_line_id = ? ORDER BY version DESC, id DESC LIMIT 1`, countryCode, product)?.id;
}

/** Why a comparison involving this insurer can't start, or null if it can. */
export function auditBlocker(insurer: InsurerRow, product: string, audit = latestScoredAudit(insurer.id, product)): string | null {
  if (isFresh(audit)) return null;
  if (!insurer.audit_allowed) return "switched off for audits";
  if (!personaFor(insurer.country_code, product)) return "no test persona for this market yet";
  return null;
}
