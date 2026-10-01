import { z } from "zod";
import { adminDenied } from "@/lib/admin";
import { get } from "@/lib/db";
import { enqueue } from "@/lib/jobs";

const Body = z.object({ insurerId: z.number().int(), product: z.string().min(1) });

export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Expected { insurerId, product }." }, { status: 400 });
  const i = get<{ audit_allowed: number }>(`SELECT audit_allowed FROM insurers WHERE id = ?`, parsed.data.insurerId);
  if (!i) return Response.json({ error: "Insurer not found." }, { status: 404 });
  if (!i.audit_allowed) return Response.json({ error: "Clear this insurer for audits first (check its site terms)." }, { status: 409 });
  const jobId = enqueue("audit", parsed.data);
  return Response.json({ jobId }, { status: 202 });
}
