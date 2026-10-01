import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import PendingCompare from "@/components/PendingCompare";
import VerdictResult from "@/components/VerdictResult";
import { get } from "@/lib/db";
import { findVerdict } from "@/lib/judge";
import Link from "next/link";
import { Card } from "@/components/ui";
import { LLM_LABELS, pickLlm } from "@/lib/llm";
import { auditBlocker, insurerBySlug, isFresh, latestScoredAudit } from "@/lib/queries";
import { verdictView } from "@/lib/views";

function parse(matchup: string) {
  const [a, b, ...rest] = decodeURIComponent(matchup).split("-vs-");
  return rest.length || !a || !b ? null : { a, b };
}

export async function generateMetadata({ params }: PageProps<"/c/[cc]/[p]/[matchup]">): Promise<Metadata> {
  const { cc, matchup } = await params;
  const m = parse(matchup);
  const a = m && insurerBySlug(cc.toUpperCase(), m.a);
  const b = m && insurerBySlug(cc.toUpperCase(), m.b);
  return { title: a && b ? `${a.name} vs ${b.name} | Quote Arena` : "Quote Arena" };
}

export default async function ComparePage({ params, searchParams }: PageProps<"/c/[cc]/[p]/[matchup]">) {
  await connection();
  const { cc, p, matchup } = await params;
  const llm = pickLlm((await searchParams).ai);
  const country = cc.toUpperCase();
  const m = parse(matchup);
  if (!m || m.a === m.b) notFound();
  const a = insurerBySlug(country, m.a);
  const b = insurerBySlug(country, m.b);
  const product = get<{ name: string }>(`SELECT name FROM product_lines WHERE id = ?`, p);
  const countryRow = get<{ name: string }>(`SELECT name FROM countries WHERE code = ?`, country);
  if (!a || !b || !product || !countryRow) notFound();

  const auditA = latestScoredAudit(a.id, p, llm);
  const auditB = latestScoredAudit(b.id, p, llm);
  const verdict = auditA && auditB && isFresh(auditA) && isFresh(auditB) ? findVerdict(auditA.id, auditB.id) : undefined;
  const view = verdict ? verdictView(verdict.id, a.id) : null;

  if (!view) {
    const blocked = [
      { name: a.name, why: auditBlocker(a, p, auditA) },
      { name: b.name, why: auditBlocker(b, p, auditB) },
    ].filter((x) => x.why);
    return (
      <div className="grid gap-6">
        <div>
          <p className="text-sm text-muted">
            {countryRow.name} · {product.name} insurance · judged by {LLM_LABELS[llm].short}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {a.name} <span className="text-muted">vs</span> {b.name}
          </h1>
        </div>
        {blocked.length ? (
          <Card>
            <h2 className="font-medium">This matchup can&rsquo;t be audited</h2>
            <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm">
              {blocked.map((x) => (
                <li key={x.name}>
                  {x.name} is {x.why}.
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">
              An admin has switched audits off for this insurer. You can still compare insurers in the{" "}
              <Link href="/" className="text-accent hover:underline">
                demo market
              </Link>
              .
            </p>
          </Card>
        ) : (
          <PendingCompare country={country} product={p} a={m.a} b={m.b} llm={llm} names={[a.name, b.name]} />
        )}
      </div>
    );
  }
  return <VerdictResult v={view} countryName={countryRow.name} productName={product.name} />;
}
