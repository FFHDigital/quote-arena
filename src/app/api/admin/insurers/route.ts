import { z } from "zod";
import { adminDenied } from "@/lib/admin";
import { all, get, run, tx } from "@/lib/db";
import { ensureSeeded } from "@/lib/seed";

export interface AdminInsurer {
  id: number;
  slug: string;
  name: string;
  country_code: string;
  home_url: string;
  active: number;
  audit_allowed: number;
  is_demo: number;
  products: string | null;
  last_audit: string | null;
}

export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  ensureSeeded();
  const insurers = all<AdminInsurer>(
    `SELECT i.id, i.slug, i.name, i.country_code, i.home_url, i.active, i.audit_allowed, i.is_demo,
            (SELECT GROUP_CONCAT(ip.product_line_id, ',') FROM insurer_products ip WHERE ip.insurer_id = i.id) AS products,
            (SELECT MAX(finished_at) FROM audits a WHERE a.insurer_id = i.id AND a.status = 'scored') AS last_audit
     FROM insurers i ORDER BY i.country_code = 'ZZ' DESC, i.country_code, i.name`,
  );
  return Response.json(insurers);
}

const Body = z.object({
  country: z.string().length(2),
  name: z.string().trim().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  homeUrl: z.url(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#64748b"),
  products: z.record(z.string(), z.url()),
});

export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const b = parsed.data;
  const country = b.country.toUpperCase();
  if (!get(`SELECT code FROM countries WHERE code = ?`, country)) return Response.json({ error: "Unknown country." }, { status: 400 });
  if (get(`SELECT id FROM insurers WHERE country_code = ? AND slug = ?`, country, b.slug)) {
    return Response.json({ error: "That slug already exists in this country." }, { status: 409 });
  }
  const id = tx(() => {
    const res = run(`INSERT INTO insurers (slug, name, country_code, home_url, logo_color) VALUES (?, ?, ?, ?, ?)`, b.slug, b.name, country, b.homeUrl, b.color);
    const insurerId = Number(res.lastInsertRowid);
    for (const [product, url] of Object.entries(b.products)) {
      run(`INSERT INTO insurer_products (insurer_id, product_line_id, quote_start_url) VALUES (?, ?, ?)`, insurerId, product, url);
    }
    return insurerId;
  });
  return Response.json({ id }, { status: 201 });
}
