import { verdictView } from "@/lib/views";

export async function GET(_req: Request, ctx: RouteContext<"/api/verdicts/[id]">) {
  const { id } = await ctx.params;
  const view = verdictView(Number(id));
  if (!view) return Response.json({ error: "Verdict not found." }, { status: 404 });
  return Response.json(view);
}
