/**
 * Page observation, run inside the browser. Kept as a plain JS string so the
 * TS toolchain can't inject helpers that don't exist in the page context.
 */

export interface ObservedElement {
  id: string;
  kind: "text" | "email" | "tel" | "date" | "number" | "password" | "textarea" | "select" | "radio" | "checkbox" | "button" | "link";
  label: string;
  required: boolean;
  value: string;
  checked?: boolean;
  options?: string[];
  disabled?: boolean;
  invalid?: boolean;
}

export interface Observation {
  url: string;
  title: string;
  text: string;
  elements: ObservedElement[];
  flags: {
    password: boolean;
    captcha: boolean;
    otp: boolean;
    callback: boolean;
    priceText: string | null;
    errors: string[];
  };
  overflow: boolean;
  smallTapTargets: number;
}

export const FILLABLE = new Set(["text", "email", "tel", "date", "number", "password", "textarea", "select", "radio", "checkbox"]);

export function formFields(obs: Observation): ObservedElement[] {
  return obs.elements.filter((e) => FILLABLE.has(e.kind) && !/search/i.test(e.label));
}

const CONTINUE = /continue|next|quote|price|calculate|submit|find|look ?up|request|create/i;

/** A quote form step: two or more inputs, or one input with a button to act on it (e.g. a registration lookup). */
const LOGIN = /password|user ?name|log ?in|sign ?in/i;

/** Sign-in boxes (often on home pages) are not quote forms. */
export function isQuoteForm(obs: Observation): boolean {
  const all = formFields(obs);
  const login = all.some((f) => f.kind === "password");
  const inputs = all.filter((f) => f.kind !== "checkbox" && f.kind !== "password" && !LOGIN.test(f.label) && !(login && /e-?mail/i.test(f.label)));
  if (inputs.length >= 2) return true;
  return inputs.length === 1 && obs.elements.some((e) => e.kind === "button" && CONTINUE.test(e.label));
}

export function signature(obs: Observation): string {
  return formFields(obs).map((f) => `${f.kind}:${f.label.toLowerCase()}`).sort().join("|");
}

export const OBSERVE_SCRIPT = String.raw`(() => {
  const w = window;
  if (!w.__arenaNext) w.__arenaNext = 1;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const idOf = (el) => {
    if (!el.dataset.arenaId) el.dataset.arenaId = String(w.__arenaNext++);
    return el.dataset.arenaId;
  };
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const labelOf = (el) => {
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(' ').map((i) => document.getElementById(i)?.innerText || '').join(' ');
      if (t.trim()) return clean(t);
    }
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return clean(l.innerText);
    }
    const wrap = el.closest('label');
    if (wrap) return clean(wrap.innerText);
    if (el.placeholder) return clean(el.placeholder);
    if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') return clean(el.innerText || el.value || el.title);
    if (el.type === 'submit' || el.type === 'button') return clean(el.value);
    return clean(el.name || el.id);
  };
  const isRequired = (el, label) => el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(label);

  const elements = [];
  const seenRadio = new Set();
  const nodes = document.querySelectorAll('input, select, textarea, button, a[href], [role=button]');
  for (const el of nodes) {
    if (!visible(el) && !(el.type === 'radio' || el.type === 'checkbox')) continue;
    const tag = el.tagName;
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'INPUT' && (type === 'hidden')) continue;
    if (tag === 'INPUT' && (type === 'submit' || type === 'button')) {
      elements.push({ id: idOf(el), kind: 'button', label: labelOf(el), required: false, value: '', disabled: el.disabled });
      continue;
    }
    if (tag === 'INPUT' && type === 'radio') {
      if (!el.name || seenRadio.has(el.name)) continue;
      seenRadio.add(el.name);
      const group = Array.from(document.querySelectorAll('input[type=radio][name="' + CSS.escape(el.name) + '"]'));
      if (!group.some((g) => visible(g) || visible(g.closest('label') || g))) continue;
      const fs = el.closest('fieldset');
      const legend = fs && fs.querySelector('legend');
      const label = clean(legend ? legend.innerText : el.name);
      const checked = group.find((g) => g.checked);
      elements.push({ id: idOf(el), kind: 'radio', label, required: group.some((g) => g.required), value: checked ? labelOf(checked) : '', options: group.map((g) => labelOf(g)) });
      continue;
    }
    if (tag === 'INPUT' && type === 'checkbox') {
      if (!visible(el) && !visible(el.closest('label') || el)) continue;
      const label = labelOf(el);
      elements.push({ id: idOf(el), kind: 'checkbox', label, required: isRequired(el, label), value: '', checked: el.checked });
      continue;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const kind = tag === 'TEXTAREA' ? 'textarea' : (['email', 'tel', 'date', 'number', 'password'].includes(type) ? type : 'text');
      const label = labelOf(el);
      elements.push({ id: idOf(el), kind, label, required: isRequired(el, label), value: el.value || '', disabled: el.disabled || el.readOnly, invalid: el.getAttribute('aria-invalid') === 'true' });
      continue;
    }
    if (tag === 'SELECT') {
      const label = labelOf(el);
      const opt = el.options[el.selectedIndex];
      elements.push({ id: idOf(el), kind: 'select', label, required: isRequired(el, label), value: opt && el.value ? clean(opt.text) : '', options: Array.from(el.options).map((o) => clean(o.text)).slice(0, 40), invalid: el.getAttribute('aria-invalid') === 'true' });
      continue;
    }
    const label = labelOf(el);
    if (!label) continue;
    elements.push({ id: idOf(el), kind: tag === 'A' ? 'link' : 'button', label, required: false, value: '', disabled: el.disabled });
  }

  const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
  const lower = text.toLowerCase();
  const price = text.match(/((?:£|€|A\$|\$)\s?\d[\d,]*(?:\.\d{2})?)\s*(?:per|\/|a)\s*(?:year|month|annum|yr|mo)\b/i);
  const errors = Array.from(document.querySelectorAll('[role=alert], .error, .field-error, .invalid-feedback'))
    .filter(visible).map((e) => clean(e.innerText)).filter(Boolean).slice(0, 10);
  const captchaFrame = Array.from(document.querySelectorAll('iframe')).some((f) => /captcha|turnstile/i.test(f.src || ''));

  let small = 0;
  for (const el of document.querySelectorAll('a[href], button, input, select')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 24 || r.width < 24) small++;
  }

  return {
    url: location.href,
    title: document.title,
    text: text.slice(0, 2500),
    elements: elements.slice(0, 120),
    flags: {
      password: elements.some((e) => e.kind === 'password'),
      captcha: captchaFrame || /i'm not a robot|captcha/i.test(lower),
      otp: /verification code|one[- ]time (?:pass)?code|enter the code|we(?:'ve| have) (?:sent|emailed|texted)/i.test(lower),
      callback: /call(?:ing)? you back|request a call ?back|adviser will call|we(?:'ll| will) call you/i.test(lower),
      priceText: price ? price[0] : null,
      errors,
    },
    overflow: document.documentElement.scrollWidth > Math.min(window.innerWidth, screen.width) + 2,
    smallTapTargets: small,
  };
})()`;

/** Compact text form of an observation for the LLM driver. */
export function describe(obs: Observation, maxText = 1500): string {
  const lines = obs.elements.map((e) => {
    const bits = [`[${e.id}] ${e.kind} "${e.label}"`];
    if (e.required) bits.push("(required)");
    if (e.disabled) bits.push("(disabled)");
    if (e.invalid) bits.push("(invalid)");
    if (e.options) bits.push(`options=${JSON.stringify(e.options)}`);
    if (e.kind === "checkbox") bits.push(e.checked ? "checked" : "unchecked");
    else if (e.value) bits.push(`value=${JSON.stringify(e.value)}`);
    return bits.join(" ");
  });
  const f = obs.flags;
  const flags = [
    f.priceText && `price-like text: "${f.priceText}"`,
    f.password && "password field present",
    f.captcha && "CAPTCHA detected",
    f.otp && "verification-code wording detected",
    f.callback && "callback wording detected",
    f.errors.length && `errors: ${JSON.stringify(f.errors)}`,
  ].filter(Boolean);
  return [
    `URL: ${obs.url}`,
    `Title: ${obs.title}`,
    flags.length ? `Signals: ${flags.join("; ")}` : "Signals: none",
    "Interactive elements:",
    ...(lines.length ? lines : ["(none)"]),
    "Visible text (truncated):",
    obs.text.slice(0, maxText),
  ].join("\n");
}
