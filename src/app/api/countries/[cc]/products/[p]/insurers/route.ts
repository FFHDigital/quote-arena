import { insurers } from "@/lib/queries";

export async function GET(_req: Request, ctx: RouteContext<"/api/countries/[cc]/products/[p]/insurers">) {
  const { cc, p } = await ctx.params;
  return Response.json(insurers(cc.toUpperCase(), p));
}
