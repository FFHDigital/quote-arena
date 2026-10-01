import { leaderboard } from "@/lib/views";

export async function GET(_req: Request, ctx: RouteContext<"/api/leaderboard/[cc]/[p]">) {
  const { cc, p } = await ctx.params;
  return Response.json(leaderboard(cc.toUpperCase(), p));
}
