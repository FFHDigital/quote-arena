import { get } from "@/lib/db";
import { job } from "@/lib/jobs";

export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  const { id } = await ctx.params;
  const row = job(Number(id));
  if (!row) return Response.json({ error: "Job not found." }, { status: 404 });
  const queuedAhead = row.status === "queued" ? get<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued','running') AND id < ?`, row.id)?.n ?? 0 : 0;
  return Response.json({
    id: row.id,
    status: row.status,
    queuedAhead,
    progress: JSON.parse(row.progress),
    result: row.result ? JSON.parse(row.result) : null,
    error: row.error,
  });
}
