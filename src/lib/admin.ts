import { timingSafeEqual } from "node:crypto";

/**
 * Admin routes need the `x-admin-token` header to match ADMIN_TOKEN.
 * Without ADMIN_TOKEN, admin is open in development and closed in production.
 */
export function adminDenied(req: Request): Response | null {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return process.env.NODE_ENV === "production" ? Response.json({ error: "Admin is disabled: set ADMIN_TOKEN." }, { status: 403 }) : null;
  }
  const given = Buffer.from(req.headers.get("x-admin-token") ?? "");
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Wrong admin token." }, { status: 401 });
  return null;
}
