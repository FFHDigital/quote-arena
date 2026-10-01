import { z } from "zod";
import { adminDenied } from "@/lib/admin";
import { get, run } from "@/lib/db";

const Body = z.object({
  active: z.boolean().optional(),
  auditAllowed: z.boolean().optional(),
  homeUrl: z.url().optional(),
  quoteUrls: z.record(z.string(), z.url()).optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/insurers/[id]">) {
  const denied = adminDenied(req);
  if (denied) return denied;
  const id = Number((await ctx.params).id);
  if (!get(`SELECT id FROM insurers WHERE id = ?`, id)) return Response.json({ error: "Insurer not found." }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const b = parsed.data;
  if (b.active !== undefined) run(`UPDATE insurers SET active = ? WHERE id = ?`, b.active ? 1 : 0, id);
  if (b.auditAllowed !== undefined) run(`UPDATE insurers SET audit_allowed = ? WHERE id = ?`, b.auditAllowed ? 1 : 0, id);
  if (b.homeUrl) run(`UPDATE insurers SET home_url = ? WHERE id = ?`, b.homeUrl, id);
  for (const [product, url] of Object.entries(b.quoteUrls ?? {})) {
    run(
      `INSERT INTO insurer_products (insurer_id, product_line_id, quote_start_url) VALUES (?, ?, ?)
       ON CONFLICT(insurer_id, product_line_id) DO UPDATE SET quote_start_url = excluded.quote_start_url`,
      id, product, url,
    );
  }
  return Response.json({ ok: true });
}
