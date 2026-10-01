import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { AUDIT_TTL_DAYS, CRITERIA, HARD_BLOCKER_CAP, RUBRIC_VERSION } from "@/lib/rubric";

export const metadata: Metadata = { title: "Methodology | Quote Arena" };

export default function Methodology() {
  return (
    <article className="grid max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Methodology</h1>
        <p className="mt-2 text-muted">
          &ldquo;Easier to get a quote&rdquo; means the fewest obstacles between landing on an insurer&apos;s website and seeing a price. Every score is tied to recorded evidence you can open.
        </p>
      </div>

      <Card>
        <h2 className="font-medium">1. Audit: walk the real journey</h2>
        <p className="mt-2 text-sm text-muted">
          A browser agent starts on the insurer&apos;s home page and goes through the quote form using a fixed, made-up customer (the same persona for every insurer in a market). It records every step, field,
          lookup, error and blocker, with screenshots, then repeats the start of the journey on a 390&nbsp;px phone screen. Audits are reused for {AUDIT_TTL_DAYS} days.
        </p>
        <ul className="mt-3 grid list-disc gap-1 pl-5 text-sm text-muted">
          <li>It never buys, applies, requests a callback, creates an account, enters a verification code or solves a CAPTCHA. Each of those is recorded as a barrier instead.</li>
          <li>It identifies itself in its user agent and waits 5 seconds between actions on real sites.</li>
          <li>Insurers are only audited after an admin has checked their site terms.</li>
        </ul>
      </Card>

      <Card className="overflow-x-auto">
        <h2 className="font-medium">2. Score: eight criteria ({RUBRIC_VERSION})</h2>
        <table className="mt-3 w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">Criterion</th>
              <th scope="col" className="py-2 pr-3 font-medium">Weight</th>
              <th scope="col" className="py-2 pr-3 font-medium">10 looks like</th>
              <th scope="col" className="py-2 pr-3 font-medium">0 looks like</th>
              <th scope="col" className="py-2 font-medium">Scored by</th>
            </tr>
          </thead>
          <tbody>
            {CRITERIA.map((c) => (
              <tr key={c.key} className="border-t border-line align-top">
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  {c.label}
                  <span className="block text-xs font-normal text-muted">{c.measures}</span>
                </th>
                <td className="py-2 pr-3 tabular-nums">{Math.round(c.weight * 100)}%</td>
                <td className="py-2 pr-3">{c.best}</td>
                <td className="py-2 pr-3">{c.worst}</td>
                <td className="py-2">{c.scoredBy === "code" ? "Counted by code" : "Claude, citing evidence"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-muted">
          Overall score is the weighted sum, out of 100. If no price can be reached online, the overall score is capped at {HARD_BLOCKER_CAP}. &ldquo;Time for a person&rdquo; is an estimate from the recorded
          journey (about 7 seconds per typed field, 3 per choice, 4 per page), not the agent&apos;s own speed.
        </p>
      </Card>

      <Card>
        <h2 className="font-medium">3. Judge: head to head</h2>
        <p className="mt-2 text-sm text-muted">
          Claude compares the two audits with the insurers&apos; names hidden, twice, with the order swapped. If the two runs disagree, the result is a tie. Every claim must cite evidence from the audits; a
          verdict that cites evidence that doesn&apos;t exist is retried and then sent for human review, as is one that contradicts a clear score gap. A gap of 10 or more points is a clear win, 3 to 9 is
          narrow, under 3 is a tie. Each verdict updates the insurers&apos; Elo ratings on the leaderboard.
        </p>
      </Card>

      <Card>
        <h2 className="font-medium">What this is not</h2>
        <p className="mt-2 text-sm text-muted">
          Quote Arena compares the online quoting experience only. It does not compare prices, cover, claims handling or financial strength, and it is not financial advice. Insurers can report an error from
          any verdict page; corrections are made within 5 working days.
        </p>
      </Card>
    </article>
  );
}
