import path from "node:path";
import { chromium, type Browser } from "playwright";
import { SCREENSHOT_DIR, get, now, run, tx } from "../db";
import { claudeAvailable } from "../claude";
import type { AuditMetrics, AuditRow, InsurerRow, Persona } from "../types";
import { claudeDriver, ruleDriver } from "./drivers";
import { AuditSession } from "./session";
import { isQuoteForm, OBSERVE_SCRIPT, type Observation } from "./observe";
import { scoreAudit } from "../score";

export const BASE_URL = process.env.ARENA_BASE_URL ?? "http://localhost:3000";
const USER_AGENT = `Mozilla/5.0 (compatible; QuoteArenaAuditBot/0.1; +${BASE_URL}/methodology)`;

export function resolveUrl(url: string): string {
  return url.startsWith("/") ? new URL(url, BASE_URL).toString() : url;
}

/** Seconds a person would need: typing, choosing, page changes and load time. */
function estimateHumanSeconds(session: AuditSession): number {
  let s = 0;
  for (const f of session.fieldStats()) {
    if (f.prefilled) s += 1;
    else if (!f.required) continue;
    else if (f.kind === "select" || f.kind === "radio") s += 3;
    else if (f.kind === "checkbox") s += 2;
    else s += 7;
  }
  s += session.steps * 4 + (session.clicksToStart ?? 0) * 3 + session.pageLoadMs / 1000;
  return Math.round(s);
}

async function mobileCheck(browser: Browser, startUrl: string, navClicks: string[], session: AuditSession, shotDir: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: USER_AGENT });
  const page = await ctx.newPage();
  try {
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    for (const label of navClicks) {
      const target = page.getByRole("link", { name: label, exact: true }).or(page.getByRole("button", { name: label, exact: true })).first();
      if (!(await target.count())) break;
      await target.click({ timeout: 8000 });
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(400);
    }
    const obs = (await page.evaluate(OBSERVE_SCRIPT)) as Observation;
    const formReachable = isQuoteForm(obs);
    const file = "mobile.png";
    await page.screenshot({ path: path.join(shotDir, file) });
    const summary = `Phone-sized screen (390 px): ${formReachable ? "quote form reached" : "quote form not reached"}${obs.overflow ? ", page scrolls sideways" : ""}${obs.smallTapTargets ? `, ${obs.smallTapTargets} small tap targets` : ""}.`;
    session.addMobile(summary, file, { overflow: obs.overflow, smallTapTargets: obs.smallTapTargets, formReachable });
    return { checked: true, horizontalOverflow: obs.overflow, smallTapTargets: obs.smallTapTargets, formReachable };
  } catch (err) {
    session.addMobile(`Mobile check failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`, null, null);
    return { checked: false, horizontalOverflow: false, smallTapTargets: 0, formReachable: false };
  } finally {
    await ctx.close();
  }
}

export async function runAudit(auditId: number, log: (msg: string) => void = () => {}): Promise<void> {
  const audit = get<AuditRow>(`SELECT * FROM audits WHERE id = ?`, auditId);
  if (!audit) throw new Error(`Audit ${auditId} not found`);
  const insurer = get<InsurerRow>(`SELECT * FROM insurers WHERE id = ?`, audit.insurer_id)!;
  if (!insurer.audit_allowed) throw new Error(`${insurer.name} has not been cleared for automated audits.`);
  const product = get<{ quote_start_url: string }>(`SELECT quote_start_url FROM insurer_products WHERE insurer_id = ? AND product_line_id = ?`, insurer.id, audit.product_line_id);
  if (!product) throw new Error(`${insurer.name} has no ${audit.product_line_id} product.`);
  const personaRow = get<{ data: string }>(`SELECT data FROM personas WHERE id = ?`, audit.persona_id);
  if (!personaRow) throw new Error(`Persona ${audit.persona_id} not found.`);
  const persona = JSON.parse(personaRow.data) as Persona;

  const driver = claudeAvailable() ? claudeDriver : ruleDriver;
  run(`UPDATE audits SET status = 'running', started_at = ?, driver = ? WHERE id = ?`, now(), driver.name, auditId);

  const startUrl = resolveUrl(product.quote_start_url);
  const shotDir = path.join(SCREENSHOT_DIR, String(auditId));
  const browser = await chromium.launch();
  let agentCost = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: USER_AGENT, locale: "en-GB" });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    // Real sites get a polite 5 s between actions; the local demo sites don't need it.
    const delay = insurer.is_demo ? 0 : Number(process.env.ARENA_ACTION_DELAY_MS ?? 5000);
    const session = new AuditSession(page, new URL(page.url()).host, shotDir, delay);
    session.pageLoadMs += Date.now() - t0;
    await session.record();
    log(`Opened ${startUrl} with the ${driver.name} driver`);

    try {
      agentCost = (await driver.run({ session, persona, insurerName: insurer.name, productLine: audit.product_line_id })).cost;
    } catch (err) {
      await session.finish("error", err instanceof Error ? err.message.split("\n")[0] : String(err));
    }
    log(`Journey finished: ${session.outcome}`);

    const mobile = await mobileCheck(browser, startUrl, session.navClicks, session, shotDir);
    log("Mobile check done");

    const stats = session.fieldStats();
    const metrics: AuditMetrics = {
      outcome: session.outcome ?? "gave_up",
      priceText: session.priceText,
      steps: session.steps,
      clicksToStart: session.clicksToStart,
      fieldsTotal: stats.length,
      fieldsRequired: stats.filter((f) => f.required).length,
      fieldsPrefilled: stats.filter((f) => f.prefilled).length,
      lookupsUsed: session.lookups,
      errorsShown: session.errorsShown,
      barriers: [...session.barriers],
      estimatedHumanSeconds: session.outcome === "price_shown" ? estimateHumanSeconds(session) : null,
      pageLoadSeconds: Math.round(session.pageLoadMs / 100) / 10,
      mobile,
    };

    tx(() => {
      run(`DELETE FROM evidence WHERE audit_id = ?`, auditId);
      for (const e of session.evidence) {
        run(
          `INSERT INTO evidence (audit_id, ref, step_no, kind, url, summary, screenshot, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          auditId, e.ref, e.step, e.kind, e.url, e.summary, e.screenshot, e.payload === undefined ? null : JSON.stringify(e.payload),
        );
      }
      run(
        `UPDATE audits SET status = 'captured', outcome = ?, metrics = ?, notes = ?, cost_usd = cost_usd + ? WHERE id = ?`,
        metrics.outcome, JSON.stringify(metrics), session.finishNotes, agentCost, auditId,
      );
    });
  } finally {
    await browser.close();
  }

  log("Scoring the journey");
  await scoreAudit(auditId);
  log("Audit scored");
}
