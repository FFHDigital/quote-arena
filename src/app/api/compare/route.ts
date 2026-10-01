import { z } from "zod";
import { enqueue } from "@/lib/jobs";
import { findVerdict } from "@/lib/judge";
import { insurerBySlug, isFresh, latestScoredAudit } from "@/lib/queries";
import { rateLimited } from "@/lib/rateLimit";

const Body = z.object({ country: z.string().length(2), product: z.string().min(1), insurerA: z.string().min(1), insurerB: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Expected country, product, insurerA and insurerB." }, { status: 400 });
  const { country, product, insurerA, insurerB } = parsed.data;
  if (insurerA === insurerB) return Response.json({ error: "Pick two different insurers." }, { status: 400 });

  const a = insurerBySlug(country.toUpperCase(), insurerA);
  const b = insurerBySlug(country.toUpperCase(), insurerB);
  if (!a || !b) return Response.json({ error: "Unknown insurer." }, { status: 404 });

  const auditA = latestScoredAudit(a.id, product);
  const auditB = latestScoredAudit(b.id, product);
  if (auditA && auditB && isFresh(auditA) && isFresh(auditB)) {
    const verdict = findVerdict(auditA.id, auditB.id);
    if (verdict) return Response.json({ status: "ready", verdictId: verdict.id });
  }

  const needsAudit = [a, b].some((i, n) => !isFresh(n === 0 ? auditA : auditB) && !i.audit_allowed);
  if (needsAudit) return Response.json({ error: "One of these insurers has no recent audit and is not cleared for automated audits yet." }, { status: 409 });

  // Fresh audits only cost a judge call; new audits run a browser, so they are rate-limited.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) return Response.json({ error: "Too many new comparisons from this address. Try again in an hour." }, { status: 429 });

  const jobId = enqueue("compare", { insurerA: a.id, insurerB: b.id, product });
  return Response.json({ status: "queued", jobId }, { status: 202 });
}
