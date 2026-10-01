/** Queues comparisons between demo insurers: `npm run audit:demo` (all pairs in a chain) or `npm run audit:demo -- swiftly steady`. */
import { all } from "../src/lib/db";
import { enqueue } from "../src/lib/jobs";
import { ensureSeeded } from "../src/lib/seed";

ensureSeeded();
const demo = all<{ id: number; slug: string }>(`SELECT id, slug FROM insurers WHERE country_code = 'ZZ' ORDER BY id`);
const pick = process.argv.slice(2);
const chosen = pick.length ? pick.map((s) => demo.find((d) => d.slug === s)!) : demo;
for (let i = 0; i < chosen.length - 1; i++) {
  const job = enqueue("compare", { insurerA: chosen[i].id, insurerB: chosen[i + 1].id, product: "car" });
  console.log(`Queued compare job ${job}: ${chosen[i].slug} vs ${chosen[i + 1].slug}`);
}
console.log("Run `npm run worker` to process the queue.");
