import { z } from "zod";
import { get, now, run } from "@/lib/db";

const Body = z.object({ reason: z.string().trim().min(5).max(2000) });

export async function POST(req: Request, ctx: RouteContext<"/api/verdicts/[id]/flags">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Tell us what looks wrong (at least 5 characters)." }, { status: 400 });
  if (!get(`SELECT id FROM verdicts WHERE id = ?`, Number(id))) return Response.json({ error: "Verdict not found." }, { status: 404 });
  run(`INSERT INTO flags (verdict_id, reason, created_at) VALUES (?, ?, ?)`, Number(id), parsed.data.reason, now());
  return Response.json({ ok: true }, { status: 201 });
}
