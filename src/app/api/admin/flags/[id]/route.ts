import { z } from "zod";
import { adminDenied } from "@/lib/admin";
import { get, run, tx } from "@/lib/db";

const Body = z.object({ status: z.enum(["confirmed", "overturned", "dismissed"]), resolution: z.string().trim().max(2000).default("") });

/**
 * Resolves a flag. "confirmed" keeps the verdict and clears its review mark;
 * "overturned" deletes the verdict so the next comparison of the pair is judged again.
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/flags/[id]">) {
  const denied = adminDenied(req);
  if (denied) return denied;
  const id = Number((await ctx.params).id);
  const flag = get<{ verdict_id: number }>(`SELECT verdict_id FROM flags WHERE id = ?`, id);
  if (!flag) return Response.json({ error: "Flag not found." }, { status: 404 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Expected { status, resolution }." }, { status: 400 });
  const { status, resolution } = parsed.data;

  tx(() => {
    run(`UPDATE flags SET status = ?, resolution = ? WHERE id = ?`, status, resolution, id);
    if (status === "confirmed") run(`UPDATE verdicts SET needs_review = 0 WHERE id = ?`, flag.verdict_id);
    if (status === "overturned") {
      // Ratings keep the old result; the re-judged match adds a new one.
      run(`DELETE FROM feedback WHERE verdict_id = ?`, flag.verdict_id);
      run(`DELETE FROM flags WHERE verdict_id = ?`, flag.verdict_id);
      run(`DELETE FROM verdicts WHERE id = ?`, flag.verdict_id);
    }
  });
  return Response.json({ ok: true });
}
