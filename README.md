# Quote Arena

Pick a country, a product line and two insurers. A browser agent walks each insurer's online quote journey, the journey is scored on eight criteria, and Claude judges which insurer makes it easier to get a quote, citing recorded evidence.

## Run it

Requires Node 24 (uses the built-in `node:sqlite`).

```bash
npm install
npx playwright install chromium
cp .env.example .env.local        # add ANTHROPIC_API_KEY to use Claude
npm run dev                       # terminal 1: the website on http://localhost:3000
npm run worker                    # terminal 2: runs audits and verdicts
```

Open http://localhost:3000, choose **Demo market → Car**, and compare two insurers. The first comparison audits both insurers (a few seconds each for the demo sites), then shows the verdict. `npm run audit:demo` queues a chain of comparisons across all five demo insurers so the leaderboard fills up.

Without `ANTHROPIC_API_KEY` everything still runs: a rule-based driver fills the forms, and verdicts are decided from the scores. With a key, the Claude agent drives the browser, Claude scores the judged criteria, and the pairwise judge runs in both orders.

## How it fits together

| Part | Where | What it does |
| --- | --- | --- |
| Web app | `src/app/(arena)` | Arena picker, verdict pages (`/c/<country>/<product>/<a>-vs-<b>`), audit pages, leaderboard, methodology, admin |
| API | `src/app/api` | Public API plus token-gated `/api/admin/*` |
| Worker | `scripts/worker.ts` | Polls the `jobs` table; runs audits and verdicts |
| Audit engine | `src/lib/audit` | Playwright session with safety rules, page observer, Claude and rule-based drivers, mobile check |
| Scoring | `src/lib/rubric.ts`, `src/lib/score.ts` | Four counted criteria (code) and four judged criteria (Claude, must cite evidence) |
| Judge | `src/lib/judge.ts` | Anonymised pairwise verdict, both orders, evidence-ref validation, Elo update |
| Demo insurers | `src/mock`, `src/app/mock` | Five fictional insurer sites of known difficulty, served at `/mock/<slug>` |
| Data | `data/arena.db`, `data/screenshots` | SQLite (WAL) and PNG evidence |

## Safety rules in the agent

The session (`src/lib/audit/session.ts`) enforces these in code, not only in the prompt:

- Refuses to click buy, pay, apply, request-a-callback, create-account and sign-up buttons.
- Refuses to type into password fields or tick CAPTCHA boxes; records them as barriers.
- Stays on the insurer's domain; stops after 80 actions or 20 minutes.
- Waits 5 s between actions on real sites and identifies itself in its user agent.

## Real insurers

UK, Irish and Australian insurers are seeded with **audits switched off**. Before ticking "Cleared for audits" in `/admin`:

1. Check the insurer's website terms allow automated access.
2. Confirm the quote start URL for each product.
3. Review the market's persona in `src/lib/seed.ts`. The Irish personas have a placeholder phone number (`REVIEW-BEFORE-USE`) that must be replaced with a reserved test number.

Legal sign-off per country is still an open question in the PRD.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Website |
| `npm run worker` | Background worker (`-- --once` to drain the queue and exit) |
| `npm run audit:demo` | Queue demo comparisons (`-- swiftly nimble` for one pair) |
| `npm run seed` | Re-seed countries, insurers and personas (keeps admin changes) |
| `npm run typecheck`, `npm run lint` | Checks |
