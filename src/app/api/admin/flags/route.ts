import { adminDenied } from "@/lib/admin";
import { all } from "@/lib/db";

const PAIR = `JOIN audits aa ON aa.id = v.audit_a_id JOIN insurers ia ON ia.id = aa.insurer_id
              JOIN audits ab ON ab.id = v.audit_b_id JOIN insurers ib ON ib.id = ab.insurer_id`;

export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  const flags = all(
    `SELECT f.id, f.verdict_id, f.reason, f.status, f.resolution, f.created_at, v.reason AS verdict_reason, ia.name AS insurer_a, ib.name AS insurer_b
     FROM flags f JOIN verdicts v ON v.id = f.verdict_id ${PAIR}
     ORDER BY f.status = 'open' DESC, f.id DESC LIMIT 100`,
  );
  const review = all(
    `SELECT v.id, v.reason, v.created_at, ia.name AS insurer_a, ib.name AS insurer_b
     FROM verdicts v ${PAIR} WHERE v.needs_review = 1 ORDER BY v.id DESC LIMIT 50`,
  );
  return Response.json({ flags, review });
}
