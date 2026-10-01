import type { Metadata } from "next";
import { driverLabel } from "@/lib/llmLabels";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Card, InsurerMark, OutcomePill, ScoreBar, formatDate, formatDuration } from "@/components/ui";
import { CRITERIA } from "@/lib/rubric";
import { auditView } from "@/lib/views";

export async function generateMetadata({ params }: PageProps<"/audits/[id]">): Promise<Metadata> {
  const a = auditView(Number((await params).id));
  return { title: a ? `${a.insurer.name} quote journey | Quote Arena` : "Quote Arena" };
}

const KIND_LABEL: Record<string, string> = { nav: "Navigation", page: "Form step", lookup: "Lookup", error: "Error", blocker: "Stopped", price: "Price", mobile: "Mobile", note: "Note" };

export default async function AuditPage({ params }: PageProps<"/audits/[id]">) {
  await connection();
  const a = auditView(Number((await params).id));
  if (!a) notFound();
  const m = a.metrics;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <InsurerMark name={a.insurer.name} color={a.insurer.color} size={44} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{a.insurer.name}: {a.product} quote journey</h1>
          <p className="text-sm text-muted">
            Audited {formatDate(a.finishedAt)} · persona &ldquo;{a.persona}&rdquo; · {driverLabel(a.driver)}
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-3xl font-semibold tabular-nums">{Math.round(a.overall)}</p>
          <OutcomePill outcome={a.outcome} />
        </div>
      </div>

      <Card>
        <h2 className="font-medium">Scores</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {CRITERIA.map((c) => {
            const s = a.scores[c.key];
            return (
              <li key={c.key}>
                <div className="flex justify-between text-sm">
                  <span>{c.label}</span>
                  <span className="font-semibold tabular-nums">{s.score}/10</span>
                </div>
                <ScoreBar score={s.score} />
                <p className="mt-1 text-xs text-muted">
                  {s.note}{" "}
                  {s.evidence.map((r) => (
                    <a key={r} href={`#${r}`} className="font-mono text-accent hover:underline">{r} </a>
                  ))}
                  <span className="opacity-70">({s.source === "llm" ? "judged by Claude" : s.source === "code" ? "counted" : "rule"})</span>
                </p>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-muted">
          Estimated time for a person: {formatDuration(m.estimatedHumanSeconds)} · page load {m.pageLoadSeconds} s · audit cost ${a.costUsd.toFixed(3)}
        </p>
      </Card>

      {a.notes && (
        <Card>
          <h2 className="font-medium">Agent notes</h2>
          <p className="mt-2 text-sm text-muted">{a.notes}</p>
        </Card>
      )}

      <section aria-labelledby="evidence" className="grid gap-3">
        <h2 id="evidence" className="font-medium">Evidence, in order</h2>
        <ol className="grid gap-3">
          {a.evidence.map((e) => (
            <li key={e.ref} id={e.ref} className="scroll-mt-6 rounded-xl border border-line bg-surface p-4 target:border-accent target:ring-2 target:ring-accent/30">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-xs text-muted">{e.ref}</span>
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{KIND_LABEL[e.kind]}</span>
                <span className="font-medium">{e.summary}</span>
              </div>
              {e.url && <p className="mt-1 break-all text-xs text-muted">{e.url}</p>}
              <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                {e.screenshot && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.screenshot} alt={`Screenshot: ${e.summary}`} loading="lazy" className="w-full rounded-lg border border-line" />
                )}
                {e.fields && (
                  <ul className="grid content-start gap-1 text-sm">
                    {e.fields.map((f) => (
                      <li key={f.label}>
                        {f.label.replace(/\s*\*$/, "")} <span className="text-muted">({f.kind}{f.required ? ", required" : ", optional"})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
