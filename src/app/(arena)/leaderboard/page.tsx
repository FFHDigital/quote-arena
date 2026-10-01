import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Card, InsurerMark } from "@/components/ui";
import { all } from "@/lib/db";
import { countries, products } from "@/lib/queries";
import { leaderboard } from "@/lib/views";

export const metadata: Metadata = { title: "Leaderboard | Quote Arena" };

export default async function LeaderboardPage({ searchParams }: PageProps<"/leaderboard">) {
  await connection();
  const sp = await searchParams;
  const list = countries();
  const country = typeof sp.country === "string" ? sp.country.toUpperCase() : (list[0]?.code ?? "ZZ");
  const prods = products(country).filter((p) => p.available);
  const product = typeof sp.product === "string" ? sp.product : (prods[0]?.id ?? "car");
  const rows = leaderboard(country, product);
  const recent = all<{ id: number; a: string; b: string; sa: string; sb: string; winner: string }>(
    `SELECT v.id, ia.name AS a, ib.name AS b, ia.slug AS sa, ib.slug AS sb, v.winner
     FROM verdicts v JOIN audits aa ON aa.id = v.audit_a_id JOIN insurers ia ON ia.id = aa.insurer_id
     JOIN audits ab ON ab.id = v.audit_b_id JOIN insurers ib ON ib.id = ab.insurer_id
     WHERE ia.country_code = ? AND aa.product_line_id = ? ORDER BY v.id DESC LIMIT 8`,
    country, product,
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Leaderboard</h1>
        <p className="mt-1 text-muted">Elo ratings from head-to-head verdicts. A win against a strong insurer moves a rating more than a win against a weak one.</p>
      </div>

      <form className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          Country
          <select name="country" defaultValue={country} className="rounded-lg border border-line bg-surface px-3 py-2">
            {list.map((c) => (
              <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Product
          <select name="product" defaultValue={product} className="rounded-lg border border-line bg-surface px-3 py-2">
            {prods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <button className="rounded-lg border border-line bg-surface px-4 py-2 text-sm hover:bg-surface-2">Show</button>
      </form>

      {rows.length === 0 ? (
        <Card>
          <p className="text-muted">No verdicts yet for this market. <Link href="/" className="text-accent hover:underline">Run a comparison</Link> to start the table.</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="px-5 py-3 font-medium">#</th>
                <th scope="col" className="px-3 py-3 font-medium">Insurer</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Rating</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Won / played</th>
                <th scope="col" className="px-3 py-3 text-right font-medium">Audit score</th>
                <th scope="col" className="px-5 py-3 font-medium">Weakest area</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.insurerId} className="border-t border-line">
                  <td className="px-5 py-3 tabular-nums text-muted">{r.rank}</td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2 font-medium">
                      <InsurerMark name={r.name} color={r.color} size={24} />
                      {r.auditId ? <Link href={`/audits/${r.auditId}`} className="hover:underline">{r.name}</Link> : r.name}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{r.elo}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {r.wins} / {r.matches}
                    {r.ties ? <span className="text-muted"> ({r.ties} tied)</span> : null}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.overall ?? "–"}</td>
                  <td className="px-5 py-3 text-muted">{r.weakest ?? "None below 8/10"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {recent.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Recent matchups</h2>
          <ul className="grid gap-1 text-sm">
            {recent.map((v) => (
              <li key={v.id}>
                <Link href={`/c/${country.toLowerCase()}/${product}/${v.sa}-vs-${v.sb}`} className="hover:underline">
                  <span className={v.winner === "a" ? "font-semibold" : ""}>{v.a}</span> vs <span className={v.winner === "b" ? "font-semibold" : ""}>{v.b}</span>
                </Link>
                <span className="text-muted"> · {v.winner === "tie" ? "tie" : `${v.winner === "a" ? v.a : v.b} won`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
