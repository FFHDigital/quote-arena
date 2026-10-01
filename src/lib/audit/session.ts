import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { OBSERVE_SCRIPT, formFields, isQuoteForm, signature, type ObservedElement, type Observation } from "./observe";
import type { Barrier, Outcome } from "../types";

/** Buttons the agent must never press: they buy, apply or contact a real person. */
const FORBIDDEN_CLICK = /\b(buy|purchase|pay( now)?|place order|submit application|apply for (the )?policy|request (a )?call ?back|call me( back)?|confirm (and|&) pay|accept (and|&) (buy|pay)|create account|register now|sign up)\b/i;

export const MAX_ACTIONS = 80;
export const MAX_MS = 20 * 60 * 1000;

export class LimitReached extends Error {}

export interface RecordedEvidence {
  ref: string;
  step: number;
  kind: "nav" | "page" | "lookup" | "error" | "blocker" | "price" | "mobile" | "note";
  url: string | null;
  summary: string;
  screenshot: string | null;
  payload?: unknown;
}

interface FieldStat {
  label: string;
  kind: string;
  required: boolean;
  prefilled: boolean;
}

export class AuditSession {
  readonly evidence: RecordedEvidence[] = [];
  readonly navClicks: string[] = [];
  readonly barriers = new Set<Barrier>();
  outcome: Outcome | null = null;
  priceText: string | null = null;
  finishNotes = "";
  steps = 0;
  lookups = 0;
  errorsShown = 0;
  clicksToStart: number | null = null;
  pageLoadMs = 0;
  actions = 0;

  private clicks = 0;
  private currentSig = "";
  private lastUrl = "";
  private seenErrors = new Set<string>();
  private fields = new Map<string, FieldStat>();
  private agentFilled = new Set<string>();
  private shotNo = 0;
  private started = Date.now();
  last!: Observation;

  constructor(
    readonly page: Page,
    private readonly allowedHost: string,
    private readonly shotDir: string,
    private readonly actionDelayMs: number,
  ) {
    fs.mkdirSync(shotDir, { recursive: true });
  }

  async observe(): Promise<Observation> {
    this.last = (await this.page.evaluate(OBSERVE_SCRIPT)) as Observation;
    return this.last;
  }

  private add(e: Omit<RecordedEvidence, "ref">): string {
    const ref = `E${this.evidence.length + 1}`;
    this.evidence.push({ ref, ...e });
    return ref;
  }

  async screenshot(): Promise<string> {
    const file = `${String(++this.shotNo).padStart(3, "0")}.png`;
    await this.page.screenshot({ path: path.join(this.shotDir, file), fullPage: false });
    return file;
  }

  /** Call after every action: records new steps, lookups, errors and barriers. */
  async record(before?: Observation): Promise<Observation> {
    const obs = await this.observe();
    const fields = formFields(obs);
    const sig = signature(obs);
    const isForm = isQuoteForm(obs);
    const prev = new Set(this.currentSig.split("|").filter(Boolean));
    const next = new Set(sig.split("|").filter(Boolean));
    // Fields revealed by a lookup extend the current step instead of starting a new one.
    const extendsStep = prev.size > 0 && [...prev].every((k) => next.has(k));

    if (isForm && sig !== this.currentSig && extendsStep) {
      this.currentSig = sig;
      for (const f of fields) {
        const key = `${f.kind}:${f.label.toLowerCase()}`;
        if (!this.fields.has(key)) this.fields.set(key, { label: f.label, kind: f.kind, required: f.required, prefilled: false });
      }
      const page = this.evidence.findLast((e) => e.kind === "page");
      if (page) {
        page.summary = `Step ${this.steps}: ${fields.length} fields (${fields.filter((f) => f.required).length} required)`;
        page.payload = { fields: fields.map((f) => ({ label: f.label, kind: f.kind, required: f.required })) };
      }
    } else if (isForm && sig !== this.currentSig) {
      this.currentSig = sig;
      this.steps++;
      if (this.clicksToStart === null) this.clicksToStart = this.clicks;
      for (const f of fields) {
        const key = `${f.kind}:${f.label.toLowerCase()}`;
        if (!this.fields.has(key)) this.fields.set(key, { label: f.label, kind: f.kind, required: f.required, prefilled: false });
      }
      this.add({
        step: this.steps,
        kind: "page",
        url: obs.url,
        summary: `Step ${this.steps}: ${fields.length} fields (${fields.filter((f) => f.required).length} required)`,
        screenshot: await this.screenshot(),
        payload: { fields: fields.map((f) => ({ label: f.label, kind: f.kind, required: f.required })) },
      });
    } else if (isForm) {
      // Same step, but lookups can reveal extra fields.
      for (const f of fields) {
        const key = `${f.kind}:${f.label.toLowerCase()}`;
        if (!this.fields.has(key)) this.fields.set(key, { label: f.label, kind: f.kind, required: f.required, prefilled: false });
      }
    } else if (!isForm && obs.url !== this.lastUrl && this.steps === 0 && this.lastUrl) {
      this.add({ step: 0, kind: "nav", url: obs.url, summary: `Navigated to "${obs.title}" (${this.clicks} click${this.clicks === 1 ? "" : "s"} from start)`, screenshot: await this.screenshot() });
    }
    this.lastUrl = obs.url;

    if (before) this.detectLookups(before, obs);

    const fresh = obs.flags.errors.filter((e) => !this.seenErrors.has(e));
    if (fresh.length) {
      fresh.forEach((e) => this.seenErrors.add(e));
      this.errorsShown += fresh.length;
      this.add({ step: this.steps, kind: "error", url: obs.url, summary: `Error shown: ${fresh.join(" / ")}`, screenshot: await this.screenshot() });
    }
    return obs;
  }

  private detectLookups(before: Observation, after: Observation) {
    const prev = new Map(before.elements.map((e) => [e.id, e.value]));
    const filled: ObservedElement[] = [];
    for (const e of formFields(after)) {
      if (!e.value || this.agentFilled.has(e.id)) continue;
      if (prev.get(e.id) === e.value) continue;
      if (e.kind === "select" && /please select/i.test(e.value)) continue;
      filled.push(e);
    }
    if (!filled.length) return;
    this.lookups++;
    for (const f of filled) {
      const stat = this.fields.get(`${f.kind}:${f.label.toLowerCase()}`);
      if (stat) stat.prefilled = true;
    }
    this.add({ step: this.steps, kind: "lookup", url: after.url, summary: `Lookup prefilled ${filled.length} field${filled.length === 1 ? "" : "s"}: ${filled.map((f) => f.label).join(", ")}`, screenshot: null });
  }

  private guard() {
    if (this.outcome) throw new LimitReached("Journey already finished.");
    if (++this.actions > MAX_ACTIONS) throw new LimitReached(`Stopped after ${MAX_ACTIONS} actions.`);
    if (Date.now() - this.started > MAX_MS) throw new LimitReached("Stopped after 20 minutes.");
  }

  private locate(id: string) {
    return this.page.locator(`[data-arena-id="${id}"]`).first();
  }

  private element(id: string): ObservedElement | undefined {
    return this.last?.elements.find((e) => e.id === id);
  }

  private async settle() {
    const t = Date.now();
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    await this.page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
    await this.page.waitForTimeout(300);
    this.pageLoadMs += Date.now() - t;
    if (this.actionDelayMs) await this.page.waitForTimeout(this.actionDelayMs);
  }

  async fill(id: string, value: string): Promise<string> {
    this.guard();
    const el = this.element(id);
    if (!el) return `No element [${id}] on the current page.`;
    if (el.kind === "password") {
      this.barriers.add("account");
      return "Refused: the agent does not create accounts or type passwords. Record this as an account barrier and finish.";
    }
    const before = this.last;
    await this.locate(id).fill(value, { timeout: 5000 });
    this.agentFilled.add(id);
    await this.page.keyboard.press("Tab").catch(() => {});
    await this.settle();
    await this.record(before);
    return `Filled [${id}] "${el.label}".`;
  }

  async choose(id: string, option: string): Promise<string> {
    this.guard();
    const el = this.element(id);
    if (!el) return `No element [${id}] on the current page.`;
    const before = this.last;
    const opts = el.options ?? [];
    const pick = opts.find((o) => o.toLowerCase() === option.toLowerCase()) ?? opts.find((o) => o.toLowerCase().includes(option.toLowerCase()));
    if (!pick) return `Option "${option}" not found. Options: ${JSON.stringify(opts)}`;
    if (el.kind === "select") {
      await this.locate(id).selectOption({ label: pick }, { timeout: 5000 });
    } else if (el.kind === "radio") {
      const name = await this.locate(id).getAttribute("name");
      const radios = this.page.locator(`input[type=radio][name="${name}"]`);
      const count = await radios.count();
      let clicked = false;
      for (let i = 0; i < count && !clicked; i++) {
        const r = radios.nth(i);
        const lbl = (await r.evaluate((n) => {
          const input = n as HTMLInputElement;
          const l = input.id ? document.querySelector(`label[for="${input.id}"]`) : input.closest("label");
          return (l as HTMLElement | null)?.innerText ?? input.value;
        })).trim();
        if (lbl.toLowerCase() === pick.toLowerCase()) {
          await r.check({ timeout: 5000, force: true });
          clicked = true;
        }
      }
      if (!clicked) return `Could not select "${pick}".`;
    } else {
      return `[${id}] is a ${el.kind}, not a select or radio group.`;
    }
    this.agentFilled.add(id);
    await this.settle();
    await this.record(before);
    return `Chose "${pick}" for [${id}] "${el.label}".`;
  }

  async setChecked(id: string, checked: boolean): Promise<string> {
    this.guard();
    const el = this.element(id);
    if (!el || el.kind !== "checkbox") return `[${id}] is not a checkbox on the current page.`;
    if (/robot|captcha/i.test(el.label)) {
      this.barriers.add("captcha");
      return "Refused: the agent does not solve CAPTCHAs. Record this as a CAPTCHA barrier and finish.";
    }
    const before = this.last;
    await this.locate(id).setChecked(checked, { timeout: 5000, force: true });
    this.agentFilled.add(id);
    await this.settle();
    await this.record(before);
    return `${checked ? "Checked" : "Unchecked"} [${id}] "${el.label}".`;
  }

  async click(id: string): Promise<string> {
    this.guard();
    const el = this.element(id);
    if (!el) return `No element [${id}] on the current page.`;
    if (FORBIDDEN_CLICK.test(el.label)) {
      if (/call/i.test(el.label)) this.barriers.add("callback");
      if (/account|register|sign up/i.test(el.label)) this.barriers.add("account");
      return `Refused: "${el.label}" would buy, apply, create an account or contact a real person. Do not press it; finish with the matching outcome instead.`;
    }
    const before = this.last;
    const urlBefore = this.page.url();
    const beforeForm = this.steps === 0;
    await this.locate(id).click({ timeout: 8000 });
    this.clicks++;
    await this.settle();
    const host = new URL(this.page.url()).host;
    if (host !== this.allowedHost && !host.endsWith(`.${this.allowedHost.replace(/^www\./, "")}`)) {
      await this.page.goto(urlBefore);
      await this.settle();
      await this.record();
      return `Refused: that link left the insurer's site (${host}); went back.`;
    }
    const obs = await this.record(before);
    // Remembered so the mobile check can replay the route to the form.
    if (beforeForm) this.navClicks.push(el.label);
    return `Clicked [${id}] "${el.label}". Now on: ${obs.title || obs.url}`;
  }

  async finish(outcome: Outcome, notes: string): Promise<void> {
    if (this.outcome) return;
    this.outcome = outcome;
    this.finishNotes = notes;
    const obs = await this.observe();
    const shot = await this.screenshot();
    if (outcome === "price_shown") {
      this.priceText = obs.flags.priceText;
      this.add({ step: this.steps, kind: "price", url: obs.url, summary: `Price shown${this.priceText ? `: ${this.priceText}` : ""}`, screenshot: shot });
    } else {
      const barrier: Partial<Record<Outcome, Barrier>> = { blocked_account: "account", blocked_otp: "otp", blocked_captcha: "captcha", callback_only: "callback" };
      if (barrier[outcome]) this.barriers.add(barrier[outcome]!);
      if (obs.flags.password) this.barriers.add("account");
      if (obs.flags.otp) this.barriers.add("otp");
      if (obs.flags.captcha) this.barriers.add("captcha");
      this.add({ step: this.steps, kind: "blocker", url: obs.url, summary: `Journey stopped: ${outcome.replace(/_/g, " ")}. ${notes}`.trim(), screenshot: shot });
    }
  }

  note(summary: string) {
    this.add({ step: this.steps, kind: "note", url: null, summary, screenshot: null });
  }

  addMobile(summary: string, screenshot: string | null, payload: unknown) {
    this.add({ step: 0, kind: "mobile", url: null, summary, screenshot, payload });
  }

  fieldStats(): FieldStat[] {
    return [...this.fields.values()];
  }
}
