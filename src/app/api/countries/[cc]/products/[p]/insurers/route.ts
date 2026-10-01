import { pickLlm } from "@/lib/llm";
import { insurers } from "@/lib/queries";

export async function GET(req: Request, ctx: RouteContext<"/api/countries/[cc]/products/[p]/insurers">) {
  const { cc, p } = await ctx.params;
  const ai = pickLlm(new URL(req.url).searchParams.get("ai"));
  return Response.json(insurers(cc.toUpperCase(), p, ai));
}
