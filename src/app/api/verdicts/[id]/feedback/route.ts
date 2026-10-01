import { z } from "zod";
import { get, now, run } from "@/lib/db";

const Body = z.object({ helpful: z.boolean() });

export async function POST(req: Request, ctx: RouteContext<"/api/verdicts/[id]/feedback">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Expected { helpful: boolean }." }, { status: 400 });
  if (!get(`SELECT id FROM verdicts WHERE id = ?`, Number(id))) return Response.json({ error: "Verdict not found." }, { status: 404 });
  run(`INSERT INTO feedback (verdict_id, helpful, created_at) VALUES (?, ?, ?)`, Number(id), parsed.data.helpful ? 1 : 0, now());
  return Response.json({ ok: true }, { status: 201 });
}
