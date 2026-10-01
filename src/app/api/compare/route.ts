import { z } from "zod";
import { enqueue } from "@/lib/jobs";
import { findVerdict } from "@/lib/judge";
import { auditBlocker, insurerBySlug, isFresh, latestScoredAudit } from "@/lib/queries";
import { pickLlm } from "@/lib/llm";
import { rateLimited } from "@/lib/rateLimit";

const Body = z.object({ country: z.string().length(2), product: z.string().min(1), insurerA: z.string().min(1), insurerB: z.string().min(1), llm: z.string().optional() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Expected country, product, insurerA and insurerB." }, { status: 400 });
  const { country, product, insurerA, insurerB } = parsed.data;
  const llm = pickLlm(parsed.data.llm);
  if (insurerA === insurerB) return Response.json({ error: "Pick two different insurers." }, { status: 400 });

  const a = insurerBySlug(country.toUpperCase(), insurerA);
  const b = insurerBySlug(country.toUpperCase(), insurerB);
  if (!a || !b) return Response.json({ error: "Unknown insurer." }, { status: 404 });

  const auditA = latestScoredAudit(a.id, product, llm);
  const auditB = latestScoredAudit(b.id, product, llm);
  if (auditA && auditB && isFresh(auditA) && isFresh(auditB)) {
    const verdict = findVerdict(auditA.id, auditB.id);
    if (verdict) return Response.json({ status: "ready", verdictId: verdict.id });
  }

  const blocked = [a, b].map((i, n) => ({ i, why: auditBlocker(i, product, n === 0 ? auditA : auditB) })).find((x) => x.why);
  if (blocked) return Response.json({ error: `${blocked.i.name} has no recent audit and is ${blocked.why}.` }, { status: 409 });

  // Fresh audits only cost a judge call; new audits run a browser, so they are rate-limited.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) return Response.json({ error: "Too many new comparisons from this address. Try again in an hour." }, { status: 429 });

  const jobId = enqueue("compare", { insurerA: a.id, insurerB: b.id, product, llm });
  return Response.json({ status: "queued", jobId }, { status: 202 });
}
