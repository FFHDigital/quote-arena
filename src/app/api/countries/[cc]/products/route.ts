import { products } from "@/lib/queries";

export async function GET(_req: Request, ctx: RouteContext<"/api/countries/[cc]/products">) {
  const { cc } = await ctx.params;
  return Response.json(products(cc.toUpperCase()));
}
