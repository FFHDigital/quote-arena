import Link from "next/link";
import { connection } from "next/server";
import ArenaPicker from "@/components/ArenaPicker";
import { LLM_LABELS, llmModes, usesAi } from "@/lib/llm";
import { countries } from "@/lib/queries";

const STEPS = [
  { title: "Walk the journey", body: "A browser agent goes through each insurer's online quote form as a made-up customer, and stops before anything is submitted." },
  { title: "Score it", body: "Eight criteria, from time to quote to entry barriers. Counts come from code; judgement calls must cite the recorded evidence." },
  { title: "Judge head to head", body: "The AI you pick (Claude or OpenAI) compares the two journeys twice, in both orders and with names hidden, then explains the winner." },
];

export default async function Home() {
  await connection();
  const list = countries();
  const modes = llmModes().map((m) => ({ id: m, label: LLM_LABELS[m].short }));
  return (
    <div className="grid gap-10">
      <section className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Which insurer makes getting a quote painless?</h1>
        <p className="mt-3 text-lg text-muted">Pick a country and two insurers. See who wins, and the evidence behind every score.</p>
      </section>

      {!llmModes().some(usesAi) && (
        <p className="rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          Running without AI: audits use the rule-based driver and verdicts come from the scores. Set <code>ARENA_LLMS</code> to use Claude or OpenAI.
        </p>
      )}

      {list.length ? (
        <ArenaPicker countries={list} modes={modes} />
      ) : (
        <p className="text-muted">No country has two insurers ready yet. An admin needs to clear insurers for audits.</p>
      )}

      <section aria-labelledby="how" className="grid gap-4">
        <h2 id="how" className="text-sm font-semibold uppercase tracking-wide text-muted">How a verdict is made</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-line bg-surface p-4">
              <span className="text-sm font-semibold text-accent">{i + 1}</span>
              <h3 className="mt-1 font-medium">{s.title}</h3>
              <p className="mt-1 text-sm text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm">
          <Link href="/leaderboard" className="text-accent hover:underline">See the leaderboard</Link> or read the{" "}
          <Link href="/methodology" className="text-accent hover:underline">full methodology</Link>.
        </p>
      </section>
    </div>
  );
}
