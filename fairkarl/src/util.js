import crypto from 'node:crypto';
import { config } from './config.js';

// ---------- ids & secrets ----------
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export function id(prefix, len = 16) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 32];
  return `${prefix}_${s}`;
}
export const token = (prefix) => `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const hmac = (s, key = config.secret) => crypto.createHmac('sha256', key).update(String(s)).digest('hex');
export const code6 = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
export function humanRef(prefix) {
  return `${prefix}-${now().getUTCFullYear()}-${String(crypto.randomInt(0, 1e7)).padStart(7, '0')}`;
}
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- clock (sandbox can move time forward to test renewals) ----------
let clockOffsetMs = 0;
export const now = () => new Date(Date.now() + clockOffsetMs);
export const nowIso = () => now().toISOString();
export const setClockOffset = (ms) => { clockOffsetMs = ms; };
export const getClockOffset = () => clockOffsetMs;

// ---------- dates ----------
export const DAY = 86_400_000;
export const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
export const today = () => isoDate(now());
export const addDays = (d, n) => isoDate(new Date(new Date(d).getTime() + n * DAY));
export const addHours = (d, n) => new Date(new Date(d).getTime() + n * 3_600_000).toISOString();
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);
export function addBusinessDays(d, n) {
  const x = new Date(d);
  while (n > 0) { x.setUTCDate(x.getUTCDate() + 1); const w = x.getUTCDay(); if (w !== 0 && w !== 6) n--; }
  return x.toISOString();
}
export function ageOn(dob, onDate = now()) {
  const b = new Date(dob), o = new Date(onDate);
  let a = o.getUTCFullYear() - b.getUTCFullYear();
  const m = o.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && o.getUTCDate() < b.getUTCDate())) a--;
  return a;
}

// ---------- money ----------
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK', 'UGX', 'PYG', 'XOF', 'XAF']);
export const decimals = (ccy) => (ZERO_DECIMAL.has(ccy) ? 0 : 2);
export const roundMoney = (x, ccy) => { const f = 10 ** decimals(ccy); return Math.round(x * f) / f; };
/** Round a price to a "nice" number for its size (645.3 -> 645, 64530 -> 64500). */
export function nicePrice(x, ccy) {
  if (x <= 0) return 0;
  const step = Math.max(5 * 10 ** (Math.floor(Math.log10(x)) - 2), decimals(ccy) ? 0.5 : 1);
  return roundMoney(Math.round(x / step) * step, ccy);
}
export const money = (amount, currency) => ({ amount: roundMoney(amount, currency), currency });
export function fmtMoney(m) {
  if (!m) return '';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: m.currency, maximumFractionDigits: decimals(m.currency) }).format(m.amount);
  } catch { return `${m.currency} ${m.amount}`; }
}

// ---------- misc ----------
export const maskEmail = (e) => String(e || '').replace(/^(.)(.*)(.@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.min(b.length, 6)) + c);
export const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
export const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- errors (RFC 9457 problem details, written so an agent can fix the request itself) ----------
export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra; // { errors:[{field, code, message, fix}], fix, retryable, next_actions, ... }
  }
  toJSON() {
    return {
      type: `https://fairkarl.example/errors/${this.code}`,
      title: this.code.replace(/_/g, ' '),
      status: this.status,
      code: this.code,
      detail: this.message,
      retryable: this.extra.retryable ?? this.status >= 500,
      ...this.extra,
    };
  }
}
export const badRequest = (message, errors, extra) => new ApiError(400, 'invalid_request', message, { errors, ...extra });
export const notFound = (what, idv) => new ApiError(404, 'not_found', `${what} ${idv ?? ''} was not found.`.replace('  ', ' '), {
  fix: `Check the ${what.toLowerCase()} id. Ids are returned by the call that created the object.`,
});
export const unauthorized = (msg = 'Authentication required.') => new ApiError(401, 'unauthenticated', msg, {
  fix: 'Send "Authorization: Bearer <key>". Get a free sandbox agent key instantly with POST /v1/agents (MCP tool: register_agent).',
});
export const forbidden = (msg, extra) => new ApiError(403, 'forbidden', msg, extra);
export const conflict = (msg, extra) => new ApiError(409, 'conflict', msg, extra);
export const unprocessable = (code, msg, extra) => new ApiError(422, code, msg, extra);
export function addMonths(d, n) {
  const x = new Date(d);
  const day = x.getUTCDate();
  x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n);
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(day, last));
  return isoDate(x);
}
/** Tamper-evident receipt for any transaction (scorecard 4.6). */
export function receipt(kind, reference, body) {
  const r = { kind, reference, status: body.status, at: nowIso(), amount: body.amount ?? null, currency: body.currency ?? null };
  return { ...r, signature: `hmac-sha256:${hmac(JSON.stringify(r))}`, verify: 'POST /v1/receipts/verify with this object' };
}
