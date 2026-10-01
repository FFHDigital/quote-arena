import Link from "next/link";
import type { AuditView, VerdictView } from "@/lib/views";
import EvidenceChip from "./EvidenceChip";
import FeedbackBar from "./FeedbackBar";
import { Card, InsurerMark, OutcomePill, ScoreBar, formatDate, formatDuration } from "./ui";

const MARGIN_LABEL = { clear: "Clear win", narrow: "Narrow win", tie: "Tie" } as const;

function Chips({ refs, audit }: { refs: string[]; audit: AuditView }) {
  const items = refs.map((r) => audit.evidence.find((e) => e.ref === r)).filter((e) => !!e);
  if (!items.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {items.map((e) => (
        <EvidenceChip key={e.ref} item={e} insurer={audit.insurer.name} auditId={audit.id} />
      ))}
    </span>
  );
}

function Journey({ audit }: { audit: AuditView }) {
  const m = audit.metrics;
  const shots = audit.evidence.filter((e) => e.screenshot && e.kind !== "mobile");
  const facts = [
    ["Steps", m.steps],
    ["Required fields", `${m.fieldsRequired} of ${m.fieldsTotal}`],
    ["Prefilled by lookups", m.fieldsPrefilled],
    ["Clicks to the form", m.clicksToStart ?? "not found"],
    ["Time for a person", formatDuration(m.estimatedHumanSeconds)],
  ] as const;
  return (
    <Card className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-medium">
          <InsurerMark name={audit.insurer.name} color={audit.insurer.color} size={24} />
          {audit.insurer.name}
        </h3>
        <OutcomePill outcome={audit.outcome} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
        {m.priceText && (
          <div>
            <dt className="text-xs text-muted">Price shown</dt>
            <dd className="font-medium">{m.priceText}</dd>
          </div>
        )}
      </dl>
      {shots.length > 0 && (
        <ol className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-2" aria-label={`${audit.insurer.name} journey screenshots`}>
          {shots.map((e) => (
            <li key={e.ref} className="w-36 shrink-0">
              <a href={`/audits/${audit.id}#${e.ref}`} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={e.screenshot!} alt={e.summary} loading="lazy" className="aspect-[4/3] w-full rounded-md border border-line object-cover object-top" />
                <span className="mt-1 block text-[11px] leading-tight text-muted">
                  <span className="font-mono">{e.ref}</span> {e.summary}
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
      {audit.notes && <p className="mt-2 text-sm text-muted">&ldquo;{audit.notes}&rdquo;</p>}
      <Link href={`/audits/${audit.id}`} className="mt-3 inline-block text-sm text-accent hover:underline">
        Full journey and evidence
      </Link>
    </Card>
  );
}

export default function VerdictResult({ v, countryName, productName }: { v: VerdictView; countryName: string; productName: string }) {
  const winner = v.winner === "a" ? v.a : v.winner === "b" ? v.b : null;
  return (
    <div className="grid gap-6">
      <div>
        <p className="text-sm text-muted">
          {countryName} · {productName} insurance
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          {v.a.insurer.name} <span className="text-muted">vs</span> {v.b.insurer.name}
        </h1>
      </div>

      <section aria-label="Verdict" className={`rounded-2xl border p-5 sm:p-6 ${winner ? "border-win/30 bg-win-soft" : "border-line bg-surface"}`}>
        <div className="flex flex-wrap items-center gap-3">
          {winner && <InsurerMark name={winner.insurer.name} color={winner.insurer.color} size={40} />}
          <div>
            <p className="text-lg font-semibold sm:text-xl">
              {winner ? `${winner.insurer.name} is easier to get a quote from` : "It's a tie"}
            </p>
            <p className="text-sm text-muted">{MARGIN_LABEL[v.margin]}</p>
          </div>
          <div className="ml-auto flex items-baseline gap-3 font-semibold tabular-nums">
            <span className={v.winner === "a" ? "text-win" : ""}>
              <span className="text-3xl">{Math.round(v.a.overall)}</span>
              <span className="ml-1 text-xs font-normal text-muted">{v.a.insurer.name}</span>
            </span>
            <span className="text-muted">·</span>
            <span className={v.winner === "b" ? "text-win" : ""}>
              <span className="text-3xl">{Math.round(v.b.overall)}</span>
              <span className="ml-1 text-xs font-normal text-muted">{v.b.insurer.name}</span>
            </span>
          </div>
        </div>
        <p className="mt-4 max-w-3xl">{v.reason}</p>
        {v.needsReview && <p className="mt-3 text-sm text-warn">This verdict is waiting for a human review.</p>}
      </section>

      <Card className="sm:hidden">
        <h2 className="font-medium">Scorecard</h2>
        <p className="text-xs text-muted">0 to 10 per criterion, out of 100 overall</p>
        <ul className="mt-3 grid gap-4">
          {v.criteria.map((c) => {
            const lead = c.a.score === c.b.score ? null : c.a.score > c.b.score ? "a" : "b";
            return (
              <li key={c.criterion} className="border-t border-line pt-3">
                <p className="font-medium">
                  {c.label} <span className="text-xs font-normal text-muted">{Math.round(c.weight * 100)}%</span>
                </p>
                {(["a", "b"] as const).map((side) => (
                  <div key={side} className="mt-2">
                    <div className="flex justify-between text-sm">
                      <span className="truncate">{(side === "a" ? v.a : v.b).insurer.name}</span>
                      <span className={`font-semibold tabular-nums ${lead === side ? "text-win" : ""}`}>{c[side].score}/10</span>
                    </div>
                    <ScoreBar score={c[side].score} tone={lead === side ? "win" : lead ? "lose" : "neutral"} />
                    <Chips refs={c[side].evidence} audit={side === "a" ? v.a : v.b} />
                  </div>
                ))}
                <p className="mt-2 text-sm text-muted">{c.note}</p>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="hidden overflow-x-auto p-0 sm:block">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="px-5 pt-5 text-left font-medium">Scorecard (0 to 10 per criterion, out of 100 overall)</caption>
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="px-5 py-3 font-medium">Criterion</th>
              <th scope="col" className="w-44 px-3 py-3 font-medium">{v.a.insurer.name}</th>
              <th scope="col" className="w-44 px-3 py-3 font-medium">{v.b.insurer.name}</th>
              <th scope="col" className="px-5 py-3 font-medium">Why</th>
            </tr>
          </thead>
          <tbody>
            {v.criteria.map((c) => {
              const lead = c.a.score === c.b.score ? null : c.a.score > c.b.score ? "a" : "b";
              return (
                <tr key={c.criterion} className="border-t border-line align-top">
                  <th scope="row" className="px-5 py-3 text-left font-medium">
                    {c.label}
                    <span className="block text-xs font-normal text-muted">{Math.round(c.weight * 100)}% weight</span>
                  </th>
                  {(["a", "b"] as const).map((side) => (
                    <td key={side} className="px-3 py-3">
                      <span className={`font-semibold tabular-nums ${lead === side ? "text-win" : ""}`}>{c[side].score}</span>
                      <span className="text-xs text-muted">/10</span>
                      <div className="mt-1">
                        <ScoreBar score={c[side].score} tone={lead === side ? "win" : lead ? "lose" : "neutral"} />
                      </div>
                      <Chips refs={c[side].evidence} audit={side === "a" ? v.a : v.b} />
                    </td>
                  ))}
                  <td className="px-5 py-3 text-muted">{c.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <section aria-label="Journeys" className="grid gap-4 md:grid-cols-2">
        <Journey audit={v.a} />
        <Journey audit={v.b} />
      </section>

      <Card>
        <h2 className="font-medium">Caveats</h2>
        <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-muted">
          {v.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
          <li>
            Audited {formatDate(v.a.finishedAt)} and {formatDate(v.b.finishedAt)} with the persona &ldquo;{v.a.persona}&rdquo;.
          </li>
          <li>
            Journeys driven by {v.a.driver === "claude" ? "the Claude browser agent" : "the rule-based driver"}; verdict by{" "}
            {v.judge === "rules" ? "the rule-based judge (scores only)" : `${v.judge}, run in both orders${v.orderAgreement ? " with the same result" : ""}`}.
          </li>
          <li>Measures how easy it is to get a quote online. Not a rating of price, cover or claims.</li>
        </ul>
      </Card>

      <FeedbackBar verdictId={v.id} />
    </div>
  );
}
