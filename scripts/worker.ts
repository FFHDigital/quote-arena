/**
 * Background worker: runs audits (browser + Claude) and pairwise verdicts.
 * Start with `npm run worker` next to `npm run dev`.
 */
import { runWorker } from "../src/lib/worker";

runWorker({ once: process.argv.includes("--once") }).catch((err) => {
  console.error(err);
  process.exit(1);
});
