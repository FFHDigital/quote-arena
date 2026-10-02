// Fair pricing. No actuarial model: a published 192-cell table.
//   12 vehicle categories x 4 driver bands x 4 cover tiers = 192 prices (USD reference)
// A market converts the table with ONE price index + FX, then adds local premium tax.
// Staff can override any single cell; the table is public so agents can see every price.
import { CATEGORIES, CATEGORY_BY_CODE } from './categories.js';
import { TIERS, TIER_CODES } from './products.js';
import { nicePrice, roundMoney, ageOn, now } from '../util.js';

export const DRIVER_BANDS = {
  A: { code: 'A', name: 'Seasoned', multiplier: 0.8, description: 'Experienced driver with a clean record (0 points).' },
  B: { code: 'B', name: 'Standard', multiplier: 1.0, description: 'Most drivers (1-2 points).' },
  C: { code: 'C', name: 'Developing', multiplier: 1.45, description: 'Newer or younger drivers, or a recent claim (3-4 points).' },
  D: { code: 'D', name: 'Higher risk', multiplier: 2.1, description: 'Several risk factors (5-7 points).' },
};
export const BAND_CODES = Object.keys(DRIVER_BANDS);

// Simple, published points. Every point has a plain-language reason the agent can relay verbatim.
export const BANDING_RULES = [
  { factor: 'age', rule: 'Under 21: 3 points; 21-24: 2; 25-29: 1; 30-69: 0; 70-79: 1; 80+: 2' },
  { factor: 'years_licensed', rule: 'Under 1 year: 2 points; 1-2 years: 1; 3+ years: 0' },
  { factor: 'claims_last_5y', rule: '1 point per at-fault claim in the last 5 years (more than 3: we cannot offer cover)' },
  { factor: 'major_convictions_5y', rule: '3 points for a major conviction (more than 1: we cannot offer cover)' },
  { factor: 'minor_convictions_5y', rule: '1 point per minor conviction such as speeding (max 2 points)' },
  { factor: 'band', rule: '0 points: A, 1-2: B, 3-4: C, 5-7: D, 8+: we cannot offer cover' },
  { factor: 'multiple_drivers', rule: 'The policy uses the highest band of any named driver' },
];

/** Normalise one driver's details and work out their points and band. */
export function bandDriver(d, { asOf = now(), minAge = 17 } = {}) {
  const reasons = [];
  const declines = [];
  let age = d.age != null ? Number(d.age) : d.date_of_birth ? ageOn(d.date_of_birth, asOf) : null;
  const yl = Number(d.years_licensed ?? d.licence_years ?? 0);
  const claims = Number(d.claims_last_5y ?? d.claims ?? 0);
  const major = Number(d.major_convictions_5y ?? 0);
  const minor = Number(d.minor_convictions_5y ?? d.convictions_last_5y ?? 0);
  let pts = 0;
  const add = (p, why) => { if (p) { pts += p; reasons.push(`+${p}: ${why}`); } };
  if (age < minAge) declines.push({ rule: 'EL01', reason: `Driver is ${age}; the minimum age in this country is ${minAge}.` });
  if (age > 90) declines.push({ rule: 'EL01', reason: `Driver is ${age}; our maximum age is 90.` });
  if (age < 21) add(3, `aged ${age} (under 21)`); else if (age < 25) add(2, `aged ${age} (21-24)`); else if (age < 30) add(1, `aged ${age} (25-29)`);
  else if (age >= 80) add(2, `aged ${age} (80+)`); else if (age >= 70) add(1, `aged ${age} (70-79)`);
  if (yl < 1) add(2, 'licensed under 1 year'); else if (yl < 3) add(1, `licensed ${yl} year(s)`);
  if (claims > 3) declines.push({ rule: 'EL03', reason: `${claims} at-fault claims in 5 years (maximum 3).` });
  add(Math.min(claims, 3), `${claims} at-fault claim(s) in the last 5 years`);
  if (major > 1) declines.push({ rule: 'EL04', reason: `${major} major convictions in 5 years (maximum 1).` });
  add(major ? 3 : 0, 'major motoring conviction in the last 5 years');
  add(Math.min(minor, 2), `${minor} minor conviction(s) in the last 5 years`);
  if (d.licence_valid === false) declines.push({ rule: 'EL02', reason: 'Driver does not hold a valid licence.' });
  let band = pts === 0 ? 'A' : pts <= 2 ? 'B' : pts <= 4 ? 'C' : pts <= 7 ? 'D' : null;
  if (!band) declines.push({ rule: 'EL', reason: `${pts} points is above our maximum of 7 for instant cover.` });
  if (!reasons.length) reasons.push('0 points: experienced driver with a clean record');
  return { name: d.name || null, age, years_licensed: yl, claims_last_5y: claims, major_convictions_5y: major, minor_convictions_5y: minor, points: pts, band, band_name: band ? DRIVER_BANDS[band].name : null, reasons, declines };
}

export function bandPolicy(drivers, opts) {
  const banded = drivers.map((d) => bandDriver(d, opts));
  const declines = banded.flatMap((b, i) => b.declines.map((x) => ({ ...x, driver: i })));
  const worst = banded.reduce((w, b) => (b.band && BAND_CODES.indexOf(b.band) > BAND_CODES.indexOf(w) ? b.band : w), 'A');
  return { band: declines.length ? null : worst, drivers: banded, declines };
}

// ---------- the 192-cell table ----------
let overrides = {}; // cell -> annual_usd
export const setOverrides = (o) => { overrides = { ...o }; cache.clear(); };
export const getOverrides = () => ({ ...overrides });

export const cellKey = (category, band, tier) => `${category}:${band}:${tier}`;

export function referenceTable() {
  const rows = [];
  for (const c of CATEGORIES) for (const b of BAND_CODES) for (const t of TIER_CODES) {
    const key = cellKey(c.code, b, t);
    const formula = Math.round((c.base_usd * DRIVER_BANDS[b].multiplier * TIERS[t].multiplier) / 5) * 5;
    rows.push({ cell: key, category: c.code, band: b, tier: t, annual_usd: overrides[key] ?? formula, overridden: key in overrides });
  }
  return rows; // always 192
}

const cache = new Map(); // market code -> Map(cell -> price)

/** The full local price table for a market. Computed once, then O(1) lookups. */
export function marketTable(market) {
  if (cache.has(market.code)) return cache.get(market.code);
  const t = new Map();
  for (const r of referenceTable()) {
    // Round the price the customer actually pays (tax included) to a clean number, then show the tax inside it.
    const total = nicePrice(r.annual_usd * market.price_index * market.fx * (1 + market.tax.rate), market.currency);
    const tax = roundMoney(total - total / (1 + market.tax.rate), market.currency);
    t.set(r.cell, { ...r, base: roundMoney(total - tax, market.currency), tax, total, currency: market.currency });
  }
  cache.set(market.code, t);
  return t;
}

/** Itemised price for one cell. Monthly = 12 equal instalments at 0% APR; no fees anywhere. */
export function priceFor(market, category, band, tier) {
  const cell = marketTable(market).get(cellKey(category, band, tier));
  const ccy = market.currency;
  const monthly = roundMoney(cell.total / 12, ccy);
  const last = roundMoney(cell.total - monthly * 11, ccy);
  return {
    currency: ccy,
    base_premium: cell.base,
    taxes: [{ name: market.tax.name, rate: market.tax.rate, amount: cell.tax }],
    tax_total: cell.tax,
    fees: [],
    fee_total: 0,
    add_ons_total: 0,
    total_annual: cell.total,
    monthly_option: { instalments: 12, amount: monthly, final_instalment: last, apr: 0, interest: 0, total: cell.total },
    price_cell: cell.cell,
    reference_annual_usd: cell.annual_usd,
    sums_check: `${cell.base} + ${cell.tax} tax + 0 fees = ${cell.total} ${ccy}`,
  };
}

export const categoryInfo = (code) => CATEGORY_BY_CODE[code];
