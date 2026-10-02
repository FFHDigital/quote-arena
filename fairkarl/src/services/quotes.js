// Quoting: forgiving inputs -> one of 192 cells -> firm, itemised, bindable price for 30 days.
import { store } from '../db.js';
import { config } from '../config.js';
import { id, nowIso, now, addDays, today, daysBetween, roundMoney, ApiError, notFound, badRequest, unprocessable, clone } from '../util.js';
import { getMarket, toUsd, toLocal } from '../catalog/markets.js';
import { classifyVehicle, CATEGORY_BY_CODE } from '../catalog/categories.js';
import { TIERS, TIER_CODES, normaliseTier, localiseTier, ELIGIBILITY_RULES, PRODUCT } from '../catalog/products.js';
import { bandPolicy, priceFor, DRIVER_BANDS } from '../catalog/pricing.js';
import { audit } from './notify.js';

// ---------- vehicle pre-fill (plug a real registration lookup provider here) ----------
const SAMPLE_REGISTRATIONS = {
  'IE:241D12345': { make: 'Toyota', model: 'Corolla', year: 2024, body_type: 'hatchback', powertrain: 'hybrid', power_kw: 103, value: 28000, currency: 'EUR' },
  'IE:191D5555': { make: 'Volkswagen', model: 'Golf', year: 2019, body_type: 'hatchback', powertrain: 'petrol', power_kw: 85, value: 14500, currency: 'EUR' },
  'GB:AB12CDE': { make: 'Ford', model: 'Fiesta', year: 2012, body_type: 'hatchback', powertrain: 'petrol', power_kw: 60, value: 3500, currency: 'GBP' },
  'US:7ABC123': { make: 'Tesla', model: 'Model 3', year: 2023, body_type: 'saloon', powertrain: 'electric', power_kw: 208, value: 32000, currency: 'USD' },
};
export function lookupVehicle({ country, registration }) {
  const m = getMarket(country);
  const reg = String(registration || '').replace(/[\s-]/g, '').toUpperCase();
  const hit = m && SAMPLE_REGISTRATIONS[`${m.code}:${reg}`];
  if (!hit) return { found: false, registration: reg, country: m?.code, message: 'No record found. Ask the customer for make, model and year instead (that is all we need).' };
  return { found: true, registration: reg, country: m.code, vehicle: hit, source: 'sandbox registration lookup' };
}

const USES_DECLINED = { hire: 'hire', taxi: 'hire', rideshare: 'hire', ride_hailing: 'hire', uber: 'hire', delivery: 'delivery', courier: 'delivery', racing: 'racing', track: 'racing' };

/** Accepts many shapes so any model can call it. Returns {input, assumptions, errors}. */
export function normaliseQuoteInput(raw) {
  const r = clone(raw || {});
  const errors = [];
  const assumptions = [];
  const market = getMarket(r.country || r.country_code || r.vehicle?.country);
  if (!market) errors.push({ field: 'country', code: 'required', message: 'Country of registration is missing or not recognised.', fix: 'Send an ISO country code like "IE", "US", "IN" or a country name like "Ireland".' });

  let v = r.vehicle || {};
  for (const k of ['make', 'model', 'year', 'value', 'body_type', 'powertrain', 'power_kw', 'registration']) if (r[k] != null && v[k] == null) v[k] = r[k];
  if (v.registration && (!v.make || !v.model) && market) {
    const l = lookupVehicle({ country: market.code, registration: v.registration });
    if (l.found) { v = { ...l.vehicle, ...v }; assumptions.push(`Vehicle details pre-filled from registration ${l.registration}.`); }
  }
  if (!v.make) errors.push({ field: 'vehicle.make', code: 'required', message: 'Vehicle make is required.', fix: 'e.g. "Toyota". Or send vehicle.registration to pre-fill.' });
  if (!v.model) errors.push({ field: 'vehicle.model', code: 'required', message: 'Vehicle model is required.', fix: 'e.g. "Corolla".' });
  const y = Number(v.year);
  if (!y || y < 1900 || y > now().getUTCFullYear() + 1) errors.push({ field: 'vehicle.year', code: 'invalid', message: 'Vehicle year is required (first registration year).', fix: `A 4-digit year between 1900 and ${now().getUTCFullYear() + 1}.` });
  v.year = y;
  v.use = String(v.use || r.use || 'personal').toLowerCase();
  if (v.value != null && (isNaN(Number(v.value)) || Number(v.value) < 0)) errors.push({ field: 'vehicle.value', code: 'invalid', message: 'Vehicle value must be a number.', fix: 'Approximate market value in local currency, e.g. 15000.' });
  if (v.value == null && v.value_usd == null) assumptions.push('No vehicle value given: limits use market value at the time of a claim. Add vehicle.value for a sharper category.');

  let drivers = r.drivers || (r.driver ? [r.driver] : null);
  if (!drivers) {
    const d = {};
    for (const k of ['age', 'date_of_birth', 'years_licensed', 'claims_last_5y', 'major_convictions_5y', 'minor_convictions_5y', 'name']) if (r[k] != null) d[k] = r[k];
    drivers = Object.keys(d).length ? [d] : [];
  }
  if (!Array.isArray(drivers) || !drivers.length) errors.push({ field: 'drivers', code: 'required', message: 'At least one driver is required.', fix: 'Send drivers: [{ "age": 35, "years_licensed": 10 }] (date_of_birth works instead of age).' });
  if (drivers.length > 5) errors.push({ field: 'drivers', code: 'too_many', message: 'Up to 5 drivers per policy (EL08).', fix: 'Remove drivers or split into two policies.' });
  drivers = (drivers || []).map((d, i) => {
    const x = { ...d };
    if (x.age == null && !x.date_of_birth) errors.push({ field: `drivers[${i}].age`, code: 'required', message: 'Driver age or date_of_birth is required.', fix: 'Send "age": 35 or "date_of_birth": "1990-04-21".' });
    if (x.date_of_birth && isNaN(new Date(x.date_of_birth))) errors.push({ field: `drivers[${i}].date_of_birth`, code: 'invalid', message: 'Not a date.', fix: 'Use YYYY-MM-DD.' });
    if (x.years_licensed == null) {
      const age = x.age ?? (x.date_of_birth ? Math.floor((now() - new Date(x.date_of_birth)) / 3.15576e10) : null);
      x.years_licensed = age != null ? Math.max(0, Math.min(age - 18, 10)) : 0;
      assumptions.push(`Driver ${i + 1}: years_licensed not given, assumed ${x.years_licensed}. Correct it if wrong - the price may change.`);
    }
    if (x.claims_last_5y == null && x.claims == null) { x.claims_last_5y = 0; assumptions.push(`Driver ${i + 1}: assumed no at-fault claims in the last 5 years.`); }
    if (x.major_convictions_5y == null) x.major_convictions_5y = 0;
    if (x.minor_convictions_5y == null) x.minor_convictions_5y = 0;
    return x;
  });
  if (r.drivers == null && !r.driver && drivers.length) assumptions.push('Assumed no major or minor motoring convictions in the last 5 years.');

  const tier = r.cover_tier ? normaliseTier(r.cover_tier) : 'comprehensive';
  if (r.cover_tier && !tier) errors.push({ field: 'cover_tier', code: 'invalid', message: `Unknown cover tier "${r.cover_tier}".`, fix: `Use one of: ${TIER_CODES.join(', ')}.` });
  if (!r.cover_tier) assumptions.push('No cover tier chosen: priced Comprehensive (our most popular). All four tiers are priced in alternatives.');
  const start = r.start_date || today();
  if (isNaN(new Date(start)) || daysBetween(today(), start) < 0 || daysBetween(today(), start) > 90) errors.push({ field: 'start_date', code: 'invalid', message: 'Start date must be today or within the next 90 days.', fix: `Use a date between ${today()} and ${addDays(today(), 90)} (YYYY-MM-DD).` });
  const plan = ['monthly', 'annual'].includes(r.payment_plan) ? r.payment_plan : 'annual';
  return { market, vehicle: v, drivers, tier, start_date: start, payment_plan: plan, needs: r.needs || null, vulnerability: r.vulnerability || null, errors, assumptions };
}

/** Demands-and-needs statement (IDD): what the customer needs, and whether this cover fits. */
export function demandsAndNeeds({ market, vehicle, tier, valueUsd, needs, category }) {
  const wants = (needs?.wants || []).map(String);
  const plusOnly = ['breakdown', 'key_replacement', 'new_for_old', 'ncd_protection'];
  let recommended = 'comprehensive', why = 'Comprehensive protects your own car as well as other people, which suits most cars.';
  if (wants.some((w) => plusOnly.includes(w))) { recommended = 'comprehensive_plus'; why = `You asked for ${wants.filter((w) => plusOnly.includes(w)).join(', ')}, which only Comprehensive Plus includes.`; }
  else if (valueUsd && valueUsd < 3000) { recommended = 'third_party_fire_theft'; why = 'Your car is worth under USD 3,000, so paying extra to cover accidental damage to it may not be good value.'; }
  const chosen = TIERS[tier];
  const missing = wants.filter((w) => !chosen.sections[w]);
  const budget = needs?.max_annual_budget;
  return {
    demands: [`Insure a private ${vehicle.year} ${vehicle.make} ${vehicle.model} (${CATEGORY_BY_CODE[category].name}) registered in ${market.name}.`, 'Meet the legal requirement for third-party liability.', ...wants.map((w) => `Requested: ${w.replace(/_/g, ' ')}.`), ...(budget ? [`Budget: up to ${budget} ${market.currency} a year.`] : [])],
    recommended_tier: recommended, recommendation_reason: why,
    chosen_tier: tier, suitable: missing.length === 0,
    statement: `Based on what you told us, you need annual motor insurance for a ${vehicle.year} ${vehicle.make} ${vehicle.model} in ${market.name}, covering at least your legal liability to others. ${chosen.name} meets that need${missing.length ? `, but it does NOT include: ${missing.join(', ')}` : ''}. We recommend ${TIERS[recommended].name}: ${why} This is a non-advised sale: we give you the information to decide, and you (or your agent, under your instructions) choose.`,
    generated_at: nowIso(),
  };
}

function eligibility(n, valueUsd) {
  const declines = [];
  const refer = [];
  if (n.market.status === 'unavailable') declines.push({ rule: 'EL07', reason: n.market.reason });
  const useKey = Object.keys(USES_DECLINED).find((k) => n.vehicle.use.includes(k));
  if (useKey) declines.push({ rule: 'EL06', reason: `We do not cover ${USES_DECLINED[useKey]} use.` });
  if (valueUsd > config.maxVehicleValueUsd) refer.push({ rule: 'EL05', reason: `Car value (about USD ${Math.round(valueUsd).toLocaleString('en')}) is above USD 500,000 instant-cover limit; a human underwriter will price it within 1 business day.` });
  return { declines, refer };
}

/** Core pricing pipeline, shared by quotes, requotes, adjustments and renewals. */
export function priceRisk(n, { asOf } = {}) {
  const valueUsd = n.vehicle.value_usd != null ? Number(n.vehicle.value_usd) : n.vehicle.value != null ? toUsd(Number(n.vehicle.value), n.market) : null;
  const cls = classifyVehicle(n.vehicle, { valueUsd, currentYear: now().getUTCFullYear() });
  const bands = bandPolicy(n.drivers, { asOf: asOf || n.start_date, minAge: n.market.min_driver_age });
  const elig = eligibility(n, valueUsd || 0);
  const declines = [...elig.declines, ...bands.declines];
  if (declines.length || elig.refer.length || n.market.status !== 'live') return { cls, bands, valueUsd, declines, refer: elig.refer };
  const price = priceFor(n.market, cls.category, bands.band, n.tier);
  const alternatives = TIER_CODES.map((t) => {
    const p = priceFor(n.market, cls.category, bands.band, t);
    return { cover_tier: t, name: TIERS[t].name, total_annual: p.total_annual, monthly: p.monthly_option.amount, currency: p.currency, summary: TIERS[t].summary, selected: t === n.tier };
  });
  return { cls, bands, valueUsd, declines, refer: [], price, alternatives };
}

const quoteLinks = (q, base) => ({ self: `${base}/v1/quotes/${q.id}`, bind: `${base}/v1/policies`, ipid: `${base}/documents/ipid/${q.cover_tier}?country=${q.country}`, wording: `${base}/documents/wording?country=${q.country}` });

export function createQuote(raw, ctx, extra = {}) {
  const n = normaliseQuoteInput(raw);
  if (n.errors.length) throw badRequest(`${n.errors.length} problem(s) with the quote request. Fix the fields listed and try again.`, n.errors, { example: QUOTE_EXAMPLE });
  const r = priceRisk(n);
  const base = {
    id: id('qte'), created_at: nowIso(), country: n.market.code, market: { code: n.market.code, name: n.market.name, currency: n.market.currency },
    vehicle: { ...n.vehicle, category: r.cls.category, category_name: r.cls.name, category_reasons: r.cls.reasons, value_usd: r.valueUsd ? Math.round(r.valueUsd) : null },
    drivers: r.bands.drivers, driver_band: r.bands.band, driver_band_name: r.bands.band ? DRIVER_BANDS[r.bands.band].name : null,
    cover_tier: n.tier, start_date: n.start_date, payment_plan: n.payment_plan, needs: n.needs, vulnerability: n.vulnerability, assumptions: n.assumptions,
    raw_input: { country: n.market.code, vehicle: n.vehicle, drivers: n.drivers, cover_tier: n.tier, start_date: n.start_date, payment_plan: n.payment_plan, needs: n.needs, vulnerability: n.vulnerability }, created_by: { type: ctx.actor.type, id: ctx.actor.id || null }, customer_id: ctx.actor.customer_id || null, ...extra,
  };
  if (r.declines.length || r.refer.length) {
    const q = store.quotes.insert({
      ...base, status: r.refer.length && !r.declines.length ? 'referred' : 'declined', declines: r.declines, referrals: r.refer,
      explanation: [...r.declines, ...r.refer].map((d) => d.reason).join(' '),
    });
    audit(ctx, `quote.${q.status}`, { entity: 'quote', entity_id: q.id, detail: { reasons: q.explanation } });
    return {
      ...publicQuote(q, ctx),
      next_actions: q.status === 'referred'
        ? [{ tool: 'request_human', why: 'a human underwriter will price this car', args: { reason: 'underwriting_referral', quote_id: q.id } }]
        : [{ tool: 'check_eligibility', why: 'see all published rules' }, { tool: 'request_human', why: 'if you think this is wrong, a person will review it' }],
    };
  }
  const local = localiseTier(n.tier, n.market, n.vehicle.value != null ? Number(n.vehicle.value) : r.valueUsd ? toLocal(r.valueUsd, n.market) : null);
  const dn = demandsAndNeeds({ market: n.market, vehicle: n.vehicle, tier: n.tier, valueUsd: r.valueUsd, needs: n.needs, category: r.cls.category });
  const q = store.quotes.insert({
    ...base, status: 'quoted', valid_until: addDays(today(), config.quoteValidityDays), firm: true, price: r.price, alternatives: r.alternatives,
    cover: { tier: local.name, summary: local.summary, sections: local.sections, not_included: local.not_included, key_exclusions: local.exclusions.map((e) => ({ id: e.id, title: e.title })) },
    demands_and_needs: dn, product_version: PRODUCT.version,
    price_conditions: [
      `This price is guaranteed until ${addDays(today(), config.quoteValidityDays)} if the details given are accurate.`,
      'It only changes if the details change (car, drivers, claims, convictions, cover tier, country). Use requote to see the effect of any change instantly.',
      'No fees, no add-on drip pricing, no interest on monthly payments.',
      ...(n.assumptions.length ? ['It relies on the assumptions listed in "assumptions" - correct any that are wrong.'] : []),
    ],
  });
  audit(ctx, 'quote.created', { entity: 'quote', entity_id: q.id, detail: { cell: r.price.price_cell, total: r.price.total_annual, currency: r.price.currency } });
  return {
    ...publicQuote(q, ctx),
    next_actions: [
      { tool: 'bind_policy', why: 'buy this policy (the customer confirms on their own device)', args: { quote_id: q.id, policyholder: { name: '...', email: '...' } } },
      { tool: 'requote', why: 'try a different tier, driver or car instantly', args: { quote_id: q.id, changes: { cover_tier: 'third_party_fire_theft' } } },
      { tool: 'check_coverage', why: 'answer a specific "am I covered if...?" question' },
    ],
  };
}

export function publicQuote(q, ctx) {
  const expired = q.status === 'quoted' && q.valid_until < today();
  const out = { ...q, status: expired ? 'expired' : q.status, links: quoteLinks(q, ctx.baseUrl) };
  delete out.raw_input;
  return out;
}

export function getQuote(qid, ctx) {
  const q = store.quotes.get(qid);
  if (!q) throw notFound('Quote', qid);
  if (q.customer_id && ctx.actor.type !== 'staff' && ctx.actor.customer_id !== q.customer_id && q.created_by.id !== ctx.actor.id) {
    throw new ApiError(403, 'forbidden', 'This quote belongs to another customer.');
  }
  return publicQuote(q, ctx);
}

const deepMerge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : v;
  return out;
};

/** What-if: change anything and get a new firm quote in milliseconds, with the price difference. */
export function requote(qid, changes = {}, ctx) {
  const prev = store.quotes.get(qid);
  if (!prev) throw notFound('Quote', qid);
  const raw = deepMerge(prev.raw_input, changes);
  if (changes.drivers) raw.drivers = changes.drivers;
  if (changes.cover_tier) raw.cover_tier = changes.cover_tier;
  const next = createQuote(raw, ctx, { previous_quote_id: prev.id });
  if (prev.price && next.price) {
    const d = roundMoney(next.price.total_annual - prev.price.total_annual, next.price.currency);
    next.price_change = { previous_total: prev.price.total_annual, new_total: next.price.total_annual, difference: d, currency: next.price.currency, direction: d > 0 ? 'up' : d < 0 ? 'down' : 'same' };
  }
  return next;
}

export function checkEligibility(raw) {
  const n = normaliseQuoteInput(raw);
  if (!n.market) return { eligible: false, errors: n.errors, rules: ELIGIBILITY_RULES };
  const partial = n.errors.length ? null : priceRisk(n);
  const declines = partial ? partial.declines : [];
  const refer = partial ? partial.refer : [];
  return {
    eligible: partial ? declines.length === 0 && refer.length === 0 : null,
    outcome: !partial ? 'need_more_information' : declines.length ? 'decline' : refer.length ? 'refer_to_human' : 'instant_quote_available',
    reasons: [...declines, ...refer], missing_information: n.errors, assumptions: n.assumptions,
    category: partial?.cls?.category || null, driver_band: partial?.bands?.band || null, market: { code: n.market.code, name: n.market.name, status: n.market.status }, rules: ELIGIBILITY_RULES,
  };
}

export const QUOTE_EXAMPLE = {
  country: 'IE',
  vehicle: { make: 'Toyota', model: 'Corolla', year: 2021, value: 22000, body_type: 'hatchback' },
  drivers: [{ age: 38, years_licensed: 15, claims_last_5y: 0 }],
  cover_tier: 'comprehensive',
};
