import fs from "node:fs/promises";
import path from "node:path";
import { SCREENSHOT_DIR, get } from "@/lib/db";

export async function GET(_req: Request, ctx: RouteContext<"/api/evidence/[id]/screenshot">) {
  const { id } = await ctx.params;
  const row = get<{ audit_id: number; screenshot: string | null }>(`SELECT audit_id, screenshot FROM evidence WHERE id = ?`, Number(id));
  if (!row?.screenshot) return new Response("Not found", { status: 404 });
  const file = path.join(SCREENSHOT_DIR, String(row.audit_id), path.basename(row.screenshot));
  try {
    const bytes = await fs.readFile(file);
    return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
