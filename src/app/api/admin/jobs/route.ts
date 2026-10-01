import { adminDenied } from "@/lib/admin";
import { all } from "@/lib/db";

export async function GET(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  const jobs = all<{ id: number; type: string; payload: string; status: string; progress: string; error: string | null; created_at: string; updated_at: string }>(
    `SELECT id, type, payload, status, progress, error, created_at, updated_at FROM jobs ORDER BY id DESC LIMIT 50`,
  );
  return Response.json(
    jobs.map(({ progress, ...j }) => ({
      ...j,
      payload: JSON.parse(j.payload),
      lastMessage: (JSON.parse(progress) as { msg: string }[]).at(-1)?.msg ?? null,
    })),
  );
}
