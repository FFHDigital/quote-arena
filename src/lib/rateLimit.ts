const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = Number(process.env.ARENA_COMPARE_LIMIT_PER_HOUR ?? 20);
const hits = new Map<string, number[]>();

/** In-memory limiter for new (un-cached) comparisons: 20 per address per hour by default. */
export function rateLimited(key: string): boolean {
  const cutoff = Date.now() - WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
  recent.push(Date.now());
  hits.set(key, recent);
  return recent.length > LIMIT;
}
