import { all, get } from "./db";
import { AUDIT_TTL_DAYS } from "./rubric";
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
}

/** Insurers the public can pick: active, and either already audited or cleared for audits. */
const ELIGIBLE = `
  i.active = 1 AND (i.audit_allowed = 1 OR EXISTS (
    SELECT 1 FROM audits a WHERE a.insurer_id = i.id AND a.product_line_id = ip.product_line_id AND a.status = 'scored'))`;

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

export function latestScoredAudit(insurerId: number, product: string): AuditRow | undefined {
  return get<AuditRow>(
    `SELECT * FROM audits WHERE insurer_id = ? AND product_line_id = ? AND status = 'scored' ORDER BY finished_at DESC, id DESC LIMIT 1`,
    insurerId, product,
  );
}

export function isFresh(audit: AuditRow | undefined): boolean {
  if (!audit?.finished_at) return false;
  return Date.now() - Date.parse(audit.finished_at) < AUDIT_TTL_DAYS * 86_400_000;
}

export function insurers(countryCode: string, product: string): InsurerOption[] {
  ensureSeeded();
  const rows = all<InsurerRow>(
    `SELECT i.* FROM insurers i JOIN insurer_products ip ON ip.insurer_id = i.id
     WHERE i.country_code = ? AND ip.product_line_id = ? AND ${ELIGIBLE} ORDER BY i.name`,
    countryCode, product,
  );
  return rows.map((i) => {
    const a = latestScoredAudit(i.id, product);
    return { id: i.id, slug: i.slug, name: i.name, color: i.logo_color, isDemo: !!i.is_demo, auditedAt: a?.finished_at ?? null, fresh: isFresh(a), overall: a?.overall ?? null };
  });
}

export function insurerBySlug(countryCode: string, slug: string): InsurerRow | undefined {
  ensureSeeded();
  return get<InsurerRow>(`SELECT * FROM insurers WHERE country_code = ? AND slug = ?`, countryCode, slug);
}

export function personaFor(countryCode: string, product: string): string | undefined {
  return get<{ id: string }>(`SELECT id FROM personas WHERE country_code = ? AND product_line_id = ? ORDER BY version DESC, id DESC LIMIT 1`, countryCode, product)?.id;
}
