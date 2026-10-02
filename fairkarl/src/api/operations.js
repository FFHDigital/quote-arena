// THE single source of truth for every capability. REST routes, the OpenAPI spec, MCP tools,
// A2A skills and the docs are all generated from this list, so every channel gives the same answer.
import { store } from '../db.js';
import { config, isSandbox } from '../config.js';
import { ApiError, forbidden, unauthorized, badRequest, notFound, hmac, nowIso, setClockOffset, getClockOffset, DAY, today, safeEqual } from '../util.js';
import { CATEGORIES } from '../catalog/categories.js';
import { classifyVehicle } from '../catalog/categories.js';
import { getMarket, listMarkets, toUsd, BLOCKED } from '../catalog/markets.js';
import { TIERS, TIER_CODES, PRODUCT, SECTIONS, EXCLUSIONS, ELIGIBILITY_RULES, INCIDENT_TYPES, localiseTier, checkCoverage, normaliseTier, normaliseIncident, ipidText, wordingText } from '../catalog/products.js';
import { DRIVER_BANDS, BANDING_RULES, referenceTable, marketTable, setOverrides, getOverrides, cellKey } from '../catalog/pricing.js';
import { createQuote, getQuote, requote, checkEligibility, lookupVehicle, QUOTE_EXAMPLE } from '../services/quotes.js';
import { registerAgent, publicAgent, startLogin, verifyLogin, publicCustomer, revokeMandate, publicMandate, SCOPES, assertCustomerAccess } from '../services/auth.js';
import { requestMandate, getConfirmation, respondConfirmation } from '../services/confirmations.js';
import { bindPolicy, getPolicy, listPolicies, getDocuments, quoteAdjustment, applyAdjustment, cancellationQuote, cancelPolicy, getRenewalOffer, acceptRenewal, setAutoRenew, getPolicyOr404 } from '../services/policies.js';
import { createClaim, getClaim, listClaims, addEvidence, respondSettlement, staffDecideClaim, CLAIM_GUIDE } from '../services/claims.js';
import { lodgeComplaint, getComplaint, listComplaints, staffRespondComplaint } from '../services/complaints.js';
import { openCase, getCase, postCaseMessage } from '../services/cases.js';
import { companyInfo, transparencyMetrics, legalStatements, sandboxPersonas } from '../services/company.js';
import { runScheduler } from '../services/scheduler.js';
import { PAYMENT_METHODS } from '../services/payments.js';
import { audit } from '../services/notify.js';
import { validate } from './validate.js';

// ---------- schema helpers ----------
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const bool = (description) => ({ type: 'boolean', description });
const obj = (properties, required = [], description) => ({ type: 'object', properties, ...(required.length ? { required } : {}), ...(description ? { description } : {}) });
const arr = (items, description) => ({ type: 'array', items, description });
const idemp = { idempotency_key: str('Optional. Any unique string; repeating a call with the same key returns the original result instead of doing it twice. (REST: or send the Idempotency-Key header.)') };

const VEHICLE = obj({
  make: str('Manufacturer.', { examples: ['Toyota'] }), model: str('Model.', { examples: ['Corolla'] }), year: int('Year of first registration.', { examples: [2021] }),
  value: num('Approximate current market value in LOCAL currency of the country. Optional but recommended.', { examples: [22000] }),
  body_type: str('Optional. hatchback, saloon, estate, suv, mpv, van, pickup, coupe, convertible.', { enum: ['hatchback', 'saloon', 'sedan', 'estate', 'wagon', 'suv', 'crossover', 'mpv', 'van', 'pickup', 'coupe', 'convertible', 'roadster', 'other'], 'x-lenient': true }),
  powertrain: str('Optional. petrol, diesel, hybrid, phev, electric.', { enum: ['petrol', 'diesel', 'hybrid', 'phev', 'electric', 'lpg', 'hydrogen', 'other'], 'x-lenient': true }),
  power_kw: num('Optional engine power in kW (or send power_hp).'), seats: int('Optional number of seats.'), annual_km: num('Optional annual distance in km (classic cars: under 8,000 km qualifies for the Classic category).'),
  registration: str('Optional number plate. If we can look it up, make/model/year are pre-filled.'), use: str('personal (default) or commuting. Hire, ride-hailing, delivery and racing are not covered.', { examples: ['personal'] }),
}, [], 'The car. Only make, model and year are required.');
const DRIVER = obj({
  name: str('Optional driver name.'), age: int('Age in years (or send date_of_birth).', { examples: [38] }), date_of_birth: str('YYYY-MM-DD (alternative to age).'),
  years_licensed: int('Years holding a full licence. Assumed age-18 (max 10) if omitted.', { examples: [15] }), claims_last_5y: int('At-fault claims in the last 5 years. Default 0.'),
  major_convictions_5y: int('Major convictions (drink/drug driving, dangerous driving) in 5 years. Default 0.'), minor_convictions_5y: int('Minor convictions (e.g. speeding) in 5 years. Default 0.'),
});
const QUOTE_INPUT = {
  country: str('Country where the car is registered: ISO code or name.', { examples: ['IE', 'United States', 'IN'] }),
  vehicle: VEHICLE, drivers: arr(DRIVER, 'Everyone who will drive the car (1-5). The first is the main driver.'),
  cover_tier: str(`Optional. One of ${TIER_CODES.join(', ')} (default comprehensive). All four are priced in "alternatives" anyway.`, { enum: TIER_CODES, 'x-lenient': true }),
  start_date: str('Optional YYYY-MM-DD, today to +90 days. Default today.'), payment_plan: str('annual (default) or monthly (12 x, 0% APR).', { enum: ['annual', 'monthly'] }),
  needs: obj({ wants: arr(str('Section code'), `Optional sections the customer wants: ${Object.keys(SECTIONS).join(', ')}.`), max_annual_budget: num('Optional budget in local currency.') }, [], 'Optional: what the customer needs. Used for the demands-and-needs statement and recommendation.'),
  vulnerability: obj({ flag: bool('true if the customer is in vulnerable circumstances'), needs: str('What extra support helps.') }, [], 'Optional: tell us if the customer needs extra support.'),
};
const PAYMENT = obj({ type: str(`One of: ${Object.keys(PAYMENT_METHODS).join(', ')}.`, { enum: Object.keys(PAYMENT_METHODS) }), token: str('Payment token / mandate id (sandbox: "tok_visa" succeeds, "tok_card_fail" fails).') }, [], 'Optional. Omit and the customer pays on the confirmation page.');
const CIRCUMSTANCES = obj(Object.fromEntries(EXCLUSIONS.map((e) => [e.circumstance, bool(`${e.id}: ${e.title}`)])), [], 'Optional flags. Set true only if it applies.');

// ---------- operations ----------
// auth: public (no key), agent (agent key or mandate), user (any authenticated caller), staff
export const OPERATIONS = [
  // ===== Start here =====
  { name: 'get_started', method: 'GET', path: '/v1/start', tag: 'Start', auth: 'public', readOnly: true,
    summary: 'How to use FairKarl in 5 steps (read this first)',
    description: 'Returns who we are, how pricing works, the 5-step flow for agents (quote -> requote -> bind -> confirm -> service), an example quote request and the authentication options. Call this first if unsure.',
    input: obj({}), handler: (_, ctx) => ({ ...companyInfo(ctx.baseUrl), example_quote_request: QUOTE_EXAMPLE }) },
  { name: 'get_company_info', method: 'GET', path: '/v1/meta', tag: 'Start', auth: 'public', readOnly: true,
    summary: 'Company facts, commitments, interfaces and versioning policy', description: 'Insurer identity, regulator, commitments (no fees, firm prices, no loyalty penalty), links to every interface and the API versioning/deprecation policy.',
    input: obj({}), handler: (_, ctx) => companyInfo(ctx.baseUrl) },

  // ===== Catalogue =====
  { name: 'list_products', method: 'GET', path: '/v1/products', tag: 'Products', auth: 'public', readOnly: true,
    summary: 'All cover tiers with typed limits, excesses and exclusions',
    description: 'The 4 cover tiers with every section, limit, excess (in the country\'s currency), what is not included, and structured exclusions with ids. Pass country for local currency (default IE).',
    input: obj({ country: str('Optional country (local currency for limits and excesses). Default IE.') }),
    handler: ({ country }) => { const m = mkt(country || 'IE'); return { product: PRODUCT, market: { code: m.code, currency: m.currency }, tiers: TIER_CODES.map((t) => localiseTier(t, m)), sections: SECTIONS, exclusions: EXCLUSIONS, eligibility_rules: ELIGIBILITY_RULES }; } },
  { name: 'get_product', method: 'GET', path: '/v1/products/{cover_tier}', tag: 'Products', auth: 'public', readOnly: true,
    summary: 'One cover tier in full, plus its IPID text', description: 'Limits, excesses, exclusions and the full IPID (Insurance Product Information Document) as plain text for one tier.',
    input: obj({ cover_tier: str(`One of ${TIER_CODES.join(', ')}.`, { enum: TIER_CODES, 'x-lenient': true }), country: str('Optional country. Default IE.') }, ['cover_tier']),
    handler: ({ cover_tier, country }) => { const t = tierOr400(cover_tier); const m = mkt(country || 'IE'); return { product: PRODUCT, tier: localiseTier(t, m), ipid_text: ipidText(t, m) }; } },
  { name: 'get_policy_wording', method: 'GET', path: '/v1/products/wording', tag: 'Products', auth: 'public', readOnly: true,
    summary: 'Full policy wording as text, versioned', description: 'The complete policy wording as plain text with version, effective date and change log.',
    input: obj({ country: str('Optional country (for the ombudsman named). Default IE.') }), handler: ({ country }) => ({ version: PRODUCT.version, effective_from: PRODUCT.effective_from, changelog: PRODUCT.changelog, text: wordingText(mkt(country || 'IE')) }) },
  { name: 'check_coverage', method: 'POST', path: '/v1/coverage-check', tag: 'Products', auth: 'public', readOnly: true,
    summary: 'Is this situation covered? Answer with clause references',
    description: 'Answers "am I covered if...?" for a tier (or an existing policy) and an incident type, with excess, limit, triggered exclusions and the wording reference. Use before buying or before claiming.',
    input: obj({ incident_type: str(`One of: ${Object.keys(INCIDENT_TYPES).join(', ')}.`, { enum: Object.keys(INCIDENT_TYPES), 'x-lenient': true }), cover_tier: str('Tier to test (or send policy_id).', { enum: TIER_CODES, 'x-lenient': true }), policy_id: str('Optional: test an existing policy.'), country: str('Optional country (default IE, or the policy country).'), circumstances: CIRCUMSTANCES, driver_named: bool('Was the driver named on the policy? Default true.'), driver_age: int('Driver age, if not named.') }, ['incident_type']),
    handler: (i, ctx) => {
      const type = normaliseIncident(i.incident_type);
      if (!type) throw badRequest('Unknown incident_type.', [{ field: 'incident_type', code: 'invalid', message: i.incident_type, fix: `Use one of: ${Object.keys(INCIDENT_TYPES).join(', ')}.` }]);
      let tier = i.cover_tier && tierOr400(i.cover_tier), market = mkt(i.country || 'IE'), value = null;
      if (i.policy_id) { const p = getPolicyOr404(i.policy_id); assertCustomerAccess(ctx, p.customer_id, 'read', { policyId: p.id }); tier = p.cover_tier; market = mkt(p.country); value = p.vehicle.value ?? null; }
      if (!tier) throw badRequest('Send cover_tier or policy_id.', [{ field: 'cover_tier', code: 'required', message: 'Which cover?', fix: `One of ${TIER_CODES.join(', ')}, or policy_id.` }]);
      return checkCoverage({ tier, incident_type: type, circumstances: i.circumstances || {}, market, vehicleValueLocal: value, driver_named: i.driver_named !== false, driver_age: i.driver_age });
    } },
  { name: 'list_vehicle_categories', method: 'GET', path: '/v1/vehicle-categories', tag: 'Pricing', auth: 'public', readOnly: true,
    summary: 'The 12 vehicle categories', description: 'All 12 categories every car is placed in, with examples and the reference price (USD, comprehensive, band B, price index 1.0).',
    input: obj({}), handler: () => ({ categories: CATEGORIES }) },
  { name: 'classify_vehicle', method: 'POST', path: '/v1/vehicles/classify', tag: 'Pricing', auth: 'public', readOnly: true,
    summary: 'Which of the 12 categories is this car in, and why', description: 'Deterministic, explained classification of any car. Only make, model and year are needed.',
    input: obj({ country: str('Optional country (to convert value). Default US.'), vehicle: VEHICLE }, ['vehicle']),
    handler: ({ country, vehicle }) => { const m = mkt(country || 'US'); return classifyVehicle(vehicle, { valueUsd: vehicle.value_usd ?? (vehicle.value != null ? toUsd(Number(vehicle.value), m) : null) }); } },
  { name: 'lookup_vehicle', method: 'GET', path: '/v1/vehicles/lookup', tag: 'Pricing', auth: 'public', readOnly: true,
    summary: 'Pre-fill car details from a number plate', description: 'Looks up make, model, year and value from a registration so the customer answers fewer questions. Falls back gracefully if not found.',
    input: obj({ country: str('Country of registration.'), registration: str('Number plate.') }, ['country', 'registration']), handler: (i) => lookupVehicle(i) },
  { name: 'get_driver_bands', method: 'GET', path: '/v1/driver-bands', tag: 'Pricing', auth: 'public', readOnly: true,
    summary: 'The 4 driver bands and the published points rules', description: 'How a driver is placed in band A-D, every rule in plain language.',
    input: obj({}), handler: () => ({ bands: DRIVER_BANDS, rules: BANDING_RULES }) },
  { name: 'get_price_table', method: 'GET', path: '/v1/pricing/table', tag: 'Pricing', auth: 'public', readOnly: true,
    summary: 'The complete price table for a country (all 192 prices)',
    description: 'Every price we charge in a country: 12 categories x 4 driver bands x 4 tiers = 192 rows, itemised (base, tax, total). Filter by category, band or tier. This is the whole pricing model - there is nothing hidden.',
    input: obj({ country: str('Country. Default IE.'), category: str('Optional category filter.'), band: str('Optional band filter (A-D).'), cover_tier: str('Optional tier filter.') }),
    handler: (i) => {
      const m = mkt(i.country || 'IE');
      const rows = [...marketTable(m).values()].filter((r) => (!i.category || r.category === String(i.category).toUpperCase()) && (!i.band || r.band === String(i.band).toUpperCase()) && (!i.cover_tier || r.tier === normaliseTier(i.cover_tier)));
      return { market: { code: m.code, name: m.name, currency: m.currency, price_index: m.price_index, fx_per_usd: m.fx, tax: m.tax }, count: rows.length, total_cells: 192, rows: rows.map((r) => ({ cell: r.cell, category: r.category, band: r.band, cover_tier: r.tier, base: r.base, tax: r.tax, total_annual: r.total, monthly: Math.round((r.total / 12) * 100) / 100, currency: r.currency })) };
    } },
  { name: 'list_markets', method: 'GET', path: '/v1/markets', tag: 'Pricing', auth: 'public', readOnly: true,
    summary: 'Countries, currencies, price levels and taxes', description: 'Markets with local configuration. Any other country is also insurable (priced in USD), except sanctioned countries.',
    input: obj({}), handler: () => ({ markets: listMarkets(), other_countries: 'Every other country is live, priced in USD with a 0.7 price index.', unavailable: BLOCKED }) },
  { name: 'check_eligibility', method: 'POST', path: '/v1/eligibility', tag: 'Quotes', auth: 'public', readOnly: true,
    summary: 'Pre-screen a risk against our published rules', description: 'Says whether we can give an instant quote, must refer to a human, or must decline - and why - before a full quote. Accepts the same input as create_quote.',
    input: obj(QUOTE_INPUT), handler: (i) => checkEligibility(i) },

  // ===== Quotes =====
  { name: 'create_quote', method: 'POST', path: '/v1/quotes', tag: 'Quotes', auth: 'public', status: 201,
    summary: 'Get a firm, bindable car insurance price (all 4 tiers at once)',
    description: 'Prices any car in any country in milliseconds. REQUIRED: country, vehicle.make, vehicle.model, vehicle.year, and drivers[].age (or date_of_birth). Everything else is optional and has sensible defaults (listed back in "assumptions"). Returns: the firm price for the chosen tier (valid 30 days, itemised: base + tax, no fees, monthly at 0% APR), prices for all 4 tiers in "alternatives", the cover with limits/excesses, a demands-and-needs statement and next_actions.',
    input: obj({ ...QUOTE_INPUT, ...idemp }, ['country']), examples: [QUOTE_EXAMPLE], handler: (i, ctx) => createQuote(stripIdem(i), ctx) },
  { name: 'get_quote', method: 'GET', path: '/v1/quotes/{quote_id}', tag: 'Quotes', auth: 'public', readOnly: true,
    summary: 'Retrieve a quote', description: 'Returns a quote by id with its status (quoted, bound, expired, declined, referred).',
    input: obj({ quote_id: str('Quote id (qte_...).') }, ['quote_id']), handler: ({ quote_id }, ctx) => getQuote(quote_id, ctx) },
  { name: 'requote', method: 'POST', path: '/v1/quotes/{quote_id}/requote', tag: 'Quotes', auth: 'public', status: 201,
    summary: 'What-if: change anything and re-price instantly',
    description: 'Creates a new firm quote from an existing one with your changes merged in (e.g. {"cover_tier":"third_party"}, {"drivers":[...]}, {"vehicle":{"year":2019}}). Returns price_change vs the previous quote. No need to resend everything.',
    input: obj({ quote_id: str('Quote to start from.'), changes: obj(QUOTE_INPUT, [], 'Only the fields that change.'), ...idemp }, ['quote_id']),
    handler: ({ quote_id, changes }, ctx) => requote(quote_id, changes || {}, ctx) },

  // ===== Buying =====
  { name: 'bind_policy', method: 'POST', path: '/v1/policies', tag: 'Policies', auth: 'public', status: 201, destructive: false,
    summary: 'Buy the policy from a quote (customer confirms on their own device)',
    description: 'Starts the purchase. Required: quote_id, policyholder.name, policyholder.email. Unless your mandate pre-authorises buying (within its premium cap), the customer gets a confirmation link + 6-digit code with the IPID and demands-and-needs statement, and this returns a pending confirmation: poll get_confirmation (or wait for the confirmation.decided webhook). When approved you receive the policy, documents, receipt, and - if the customer allowed it - a mandate token to service the policy. Safe to retry with idempotency_key.',
    input: obj({ quote_id: str('Quote id.'), policyholder: obj({ name: str('Full name.'), email: str('Their own email: confirmation and legal documents go here.'), phone: str('Optional phone.'), address: str('Optional address.') }, [], 'The person buying.'), payment_method: PAYMENT, payment_plan: str('annual or monthly.', { enum: ['annual', 'monthly'] }), start_date: str('Optional YYYY-MM-DD.'), auto_renew: bool('Default false. We never auto-renew unless opted in.'), ...idemp }, ['quote_id']),
    handler: (i, ctx) => bindPolicy(i, ctx) },

  // ===== Confirmations =====
  { name: 'get_confirmation', method: 'GET', path: '/v1/confirmations/{confirmation_id}', tag: 'Confirmations', auth: 'public', readOnly: true,
    summary: 'Status of a customer confirmation (bind, cancel, settlement, access)', description: 'pending, approved, rejected or expired. When approved, "result" holds what happened (e.g. the policy) and, once, any mandate_token granted to you.',
    input: obj({ confirmation_id: str('cnf_...'), code: str('Optional: the code, if you are the customer.') }, ['confirmation_id']),
    handler: ({ confirmation_id, code }, ctx) => getConfirmation(confirmation_id, ctx, code) },
  { name: 'respond_confirmation', method: 'POST', path: '/v1/confirmations/{confirmation_id}', tag: 'Confirmations', auth: 'public',
    summary: 'Approve or reject with the customer\'s 6-digit code', description: 'Use ONLY with the code the customer gave you (or that they enter themselves). decision: approve | reject. grant_agent_access: let the requesting agent service what it set up. payment_method: if the purchase needs one.',
    input: obj({ confirmation_id: str('cnf_...'), code: str('6-digit code from the customer.'), decision: str('approve or reject.', { enum: ['approve', 'reject'] }), grant_agent_access: bool('Let the agent keep servicing the policy (view, claim, change with confirmation).'), payment_method: PAYMENT, reason: str('Optional reason if rejecting.') }, ['confirmation_id']),
    handler: ({ confirmation_id, ...rest }, ctx) => respondConfirmation(confirmation_id, rest, ctx) },

  // ===== Policies & servicing =====
  { name: 'list_policies', method: 'GET', path: '/v1/policies', tag: 'Policies', auth: 'user', readOnly: true, scope: 'read',
    summary: 'Policies of the customer you act for', description: 'Lists the customer\'s policies (needs a mandate token or customer login).',
    input: obj({ status: str('Optional filter: active, scheduled, cancelled, expired, lapsed, renewed.') }), handler: (i, ctx) => listPolicies(ctx, i) },
  { name: 'get_policy', method: 'GET', path: '/v1/policies/{policy_id}', tag: 'Policies', auth: 'user', readOnly: true, scope: 'read',
    summary: 'Live policy: cover, limits, excesses, dates, premium, renewal', description: 'Answers servicing questions from the live record: what am I covered for, when do I renew, what did I pay, which documents. Accepts the policy id or policy number.',
    input: obj({ policy_id: str('pol_... or policy number FK-...') }, ['policy_id']), handler: ({ policy_id }, ctx) => getPolicy(policy_id, ctx) },
  { name: 'get_policy_documents', method: 'GET', path: '/v1/policies/{policy_id}/documents', tag: 'Policies', auth: 'user', readOnly: true, scope: 'read',
    summary: 'Schedule, certificate, IPID, wording, demands-and-needs, receipts', description: 'Every policy document as structured data plus a printable HTML link (print to PDF).',
    input: obj({ policy_id: str('Policy id.'), doc: str('Optional single document: schedule, certificate, ipid, wording, demands_and_needs, receipts.') }, ['policy_id']),
    handler: ({ policy_id, doc }, ctx) => getDocuments(policy_id, ctx, { doc }) },
  { name: 'quote_adjustment', method: 'POST', path: '/v1/policies/{policy_id}/adjustments/quote', tag: 'Policies', auth: 'user', scope: 'quote',
    summary: 'Price a mid-term change before committing', description: 'Change car, drivers or cover tier: returns the new annual price and the exact pro-rata amount to pay or be refunded (no fees). Nothing changes until apply_adjustment.',
    input: obj({ policy_id: str('Policy id.'), changes: obj({ vehicle: VEHICLE, drivers: arr(DRIVER, 'Full new driver list.'), add_driver: DRIVER, remove_driver_index: int('Index of driver to remove.'), cover_tier: str('New tier.') }, [], 'What changes.'), ...idemp }, ['policy_id', 'changes']),
    handler: ({ policy_id, changes }, ctx) => quoteAdjustment(policy_id, changes, ctx) },
  { name: 'apply_adjustment', method: 'POST', path: '/v1/policies/{policy_id}/adjustments', tag: 'Policies', auth: 'user', scope: 'adjust',
    summary: 'Apply a priced change', description: 'Applies an adjustment from quote_adjustment. If it costs more and your mandate does not pre-authorise changes, the customer confirms first.',
    input: obj({ policy_id: str('Policy id.'), adjustment_id: str('adj_... from quote_adjustment.'), ...idemp }, ['policy_id', 'adjustment_id']),
    handler: ({ policy_id, adjustment_id }, ctx) => applyAdjustment(policy_id, adjustment_id, ctx) },
  { name: 'quote_cancellation', method: 'GET', path: '/v1/policies/{policy_id}/cancellation-quote', tag: 'Policies', auth: 'user', readOnly: true, scope: 'read',
    summary: 'Exact refund if the policy is cancelled', description: 'Pro-rata refund calculation with no fees, and whether the cooling-off period applies.',
    input: obj({ policy_id: str('Policy id.'), effective_date: str('Optional YYYY-MM-DD, default today.') }, ['policy_id']),
    handler: ({ policy_id, effective_date }, ctx) => cancellationQuote(policy_id, ctx, { effective_date }) },
  { name: 'cancel_policy', method: 'POST', path: '/v1/policies/{policy_id}/cancel', tag: 'Policies', auth: 'user', scope: 'cancel', destructive: true,
    summary: 'Cancel a policy (customer confirms when an agent asks)', description: 'Cancels with a pro-rata refund and no fees. When an agent asks, the customer always confirms on their own device.',
    input: obj({ policy_id: str('Policy id.'), effective_date: str('Optional YYYY-MM-DD, default today.'), reason: str('Optional reason.'), ...idemp }, ['policy_id']),
    handler: ({ policy_id, ...r }, ctx) => cancelPolicy(policy_id, r, ctx) },
  { name: 'get_renewal_offer', method: 'GET', path: '/v1/policies/{policy_id}/renewal', tag: 'Renewals', auth: 'user', readOnly: true, scope: 'read',
    summary: 'Renewal price vs last year, with reasons', description: 'Renewal price, last year\'s price, the change and plain-language reasons. Guaranteed to equal the new-customer price for the same risk.',
    input: obj({ policy_id: str('Policy id.') }, ['policy_id']), handler: ({ policy_id }, ctx) => getRenewalOffer(policy_id, ctx) },
  { name: 'accept_renewal', method: 'POST', path: '/v1/policies/{policy_id}/renewal/accept', tag: 'Renewals', auth: 'user', scope: 'renew',
    summary: 'Accept the renewal', description: 'Renews the policy at the offered price (customer confirms unless pre-authorised).',
    input: obj({ policy_id: str('Policy id.'), payment_method: PAYMENT, ...idemp }, ['policy_id']), handler: ({ policy_id, payment_method }, ctx) => acceptRenewal(policy_id, { payment_method }, ctx) },
  { name: 'set_auto_renew', method: 'PUT', path: '/v1/policies/{policy_id}/auto-renew', tag: 'Renewals', auth: 'user', scope: 'renew', idempotent: true,
    summary: 'Turn auto-renew on or off', description: 'Off takes effect immediately. On requires the customer\'s confirmation unless pre-authorised.',
    input: obj({ policy_id: str('Policy id.'), enabled: bool('true = on, false = off.') }, ['policy_id', 'enabled']), handler: ({ policy_id, enabled }, ctx) => setAutoRenew(policy_id, enabled, ctx) },

  // ===== Claims =====
  { name: 'get_claims_guide', method: 'GET', path: '/v1/claims/guide', tag: 'Claims', auth: 'public', readOnly: true,
    summary: 'Incident types, evidence needed for each, circumstance flags', description: 'Everything needed to lodge a complete claim first time.',
    input: obj({}), handler: () => CLAIM_GUIDE },
  { name: 'create_claim', method: 'POST', path: '/v1/claims', tag: 'Claims', auth: 'user', scope: 'claim', status: 201,
    summary: 'Report a claim (first notice of loss) and get a reference instantly',
    description: 'Required: policy_id, incident_type, description. Returns the claim reference, coverage decision with clauses, the exact evidence still needed, owner and expected dates. Breakdown dispatches help immediately.',
    input: obj({ policy_id: str('Policy id or number.'), incident_type: str(`One of: ${Object.keys(INCIDENT_TYPES).join(', ')}.`, { enum: Object.keys(INCIDENT_TYPES), 'x-lenient': true }), incident_date: str('YYYY-MM-DD, default today.'), incident_time: str('Optional HH:MM.'), location: str('Where it happened.'), description: str('What happened, in plain words.'), third_party_involved: bool('Another vehicle/person involved?'), injuries: bool('Anyone hurt?'), police_reference: str('Optional crime/incident reference.'), estimated_amount: num('Optional estimated cost in local currency.'), circumstances: CIRCUMSTANCES, driver_named: bool('Was the driver named on the policy? Default true.'), driver_age: int('Driver age if not named.'), vulnerability: obj({ flag: bool('Needs extra support'), needs: str('What helps') }), ...idemp }, ['policy_id', 'incident_type', 'description']),
    handler: (i, ctx) => createClaim(stripIdem(i), ctx) },
  { name: 'get_claim', method: 'GET', path: '/v1/claims/{claim_id}', tag: 'Claims', auth: 'user', readOnly: true, scope: 'read',
    summary: 'Claim status, next step, owner, expected date, offer', description: 'Live status with next step, who owns it, expected decision date, missing evidence, settlement offer and full timeline.',
    input: obj({ claim_id: str('clm_... or claim number CLM-...') }, ['claim_id']), handler: ({ claim_id }, ctx) => getClaim(claim_id, ctx) },
  { name: 'list_claims', method: 'GET', path: '/v1/claims', tag: 'Claims', auth: 'user', readOnly: true, scope: 'read',
    summary: 'Claims of the customer you act for', description: 'All claims, optionally for one policy.',
    input: obj({ policy_id: str('Optional policy filter.'), status: str('Optional status filter.') }), handler: (i, ctx) => listClaims(ctx, i) },
  { name: 'add_claim_evidence', method: 'POST', path: '/v1/claims/{claim_id}/evidence', tag: 'Claims', auth: 'user', scope: 'claim',
    summary: 'Upload photos, estimates, reports (typed)', description: 'Add one item (kind + url/content_base64/text/metadata) or many (items[]). For repair_estimate set metadata.amount. Returns what is still required; assessment runs automatically when complete.',
    input: obj({ claim_id: str('Claim id.'), kind: str(`Evidence kind: ${Object.keys(CLAIM_GUIDE.evidence_kinds).join(', ')}.`, { enum: Object.keys(CLAIM_GUIDE.evidence_kinds) }), url: str('Link to the file.'), content_base64: str('File content, base64 (max 5 MB).'), filename: str('File name.'), content_type: str('MIME type.'), text: str('Text evidence (e.g. other party details).'), metadata: obj({ amount: num('Amount in local currency (estimates, receipts).') }, [], 'Typed details.'), items: arr(obj({ kind: str('Evidence kind'), url: str('URL'), content_base64: str('base64'), filename: str('name'), text: str('text'), metadata: obj({ amount: num('amount') }) }), 'Several items at once.'), ...idemp }, ['claim_id']),
    handler: ({ claim_id, ...rest }, ctx) => addEvidence(claim_id, rest, ctx) },
  { name: 'respond_settlement', method: 'POST', path: '/v1/claims/{claim_id}/settlement', tag: 'Claims', auth: 'user', scope: 'claim',
    summary: 'Accept or dispute a settlement offer', description: 'accept: the customer confirms on their own device, then we pay within 2 business days. dispute: a senior handler reviews (optionally also lodges a complaint).',
    input: obj({ claim_id: str('Claim id.'), decision: str('accept or dispute.', { enum: ['accept', 'dispute'] }), reason: str('Why, if disputing.'), also_lodge_complaint: bool('Also open a formal complaint.'), payout_account: str('Optional IBAN/account token for payment.'), ...idemp }, ['claim_id', 'decision']),
    handler: ({ claim_id, ...r }, ctx) => respondSettlement(claim_id, r, ctx) },

  // ===== Complaints =====
  { name: 'create_complaint', method: 'POST', path: '/v1/complaints', tag: 'Complaints', auth: 'user', scope: 'complaint', status: 201,
    summary: 'Lodge a complaint (deadlines and ombudsman route returned)', description: 'Acknowledged instantly with a reference, the update and final-response deadlines, and the ombudsman for the customer\'s country.',
    input: obj({ description: str('What went wrong.'), policy_id: str('Optional.'), claim_id: str('Optional.'), category: str('Optional: claim_decision, claim_settlement, service, price, other.'), desired_outcome: str('What would put it right.'), contact_email: str('If not acting under a mandate.'), ...idemp }, ['description']),
    handler: (i, ctx) => lodgeComplaint(stripIdem(i), ctx) },
  { name: 'get_complaint', method: 'GET', path: '/v1/complaints/{complaint_id}', tag: 'Complaints', auth: 'user', readOnly: true, scope: 'read',
    summary: 'Complaint status and responses', description: 'Status, deadlines, responses and outcome.', input: obj({ complaint_id: str('cmp_... or reference.') }, ['complaint_id']), handler: ({ complaint_id }, ctx) => getComplaint(complaint_id, ctx) },
  { name: 'list_complaints', method: 'GET', path: '/v1/complaints', tag: 'Complaints', auth: 'user', readOnly: true, scope: 'read',
    summary: 'Complaints of the customer you act for', description: 'All complaints.', input: obj({}), handler: (_, ctx) => listComplaints(ctx) },

  // ===== Human handoff =====
  { name: 'request_human', method: 'POST', path: '/v1/cases', tag: 'Human help', auth: 'public', status: 201,
    summary: 'Hand over to a person, with full context attached', description: 'Opens a case our staff see immediately with everything linked (quote, policy, claim) plus your context_summary, so nobody repeats themselves. Returns the expected response time. Customer, agent and staff share the same case thread.',
    input: obj({ reason: str('e.g. customer_request, underwriting_referral, claim_review, vulnerable_customer, complex_question.'), subject: str('Short subject.'), context_summary: str('What has happened so far and what the customer wants.'), message: str('First message.'), quote_id: str('Optional.'), policy_id: str('Optional.'), claim_id: str('Optional.'), complaint_id: str('Optional.'), priority: str('low, normal, high, urgent.', { enum: ['low', 'normal', 'high', 'urgent'] }), contact: obj({ name: str('Name'), email: str('Email'), phone: str('Phone'), preferred_channel: str('email, phone, chat') }, [], 'How to reach the customer (if no mandate).'), vulnerability: obj({ flag: bool('Needs extra support'), needs: str('What helps') }), ...idemp }, ['reason']),
    handler: (i, ctx) => openCase(stripIdem(i), ctx) },
  { name: 'get_case', method: 'GET', path: '/v1/cases/{case_id}', tag: 'Human help', auth: 'public', readOnly: true,
    summary: 'Shared case state and messages', description: 'The case as staff see it, including every message from the customer, agent and staff.', input: obj({ case_id: str('cas_...') }, ['case_id']), handler: ({ case_id }, ctx) => getCase(case_id, ctx) },
  { name: 'post_case_message', method: 'POST', path: '/v1/cases/{case_id}/messages', tag: 'Human help', auth: 'public',
    summary: 'Add a message or document to a case', description: 'Everyone on the case sees it in real time (and gets a notification).',
    input: obj({ case_id: str('cas_...'), text: str('Message.'), documents: arr(obj({ url: str('URL'), title: str('Title') }), 'Optional links.'), status: str('Optional: resolved.') }, ['case_id', 'text']),
    handler: ({ case_id, ...r }, ctx) => postCaseMessage(case_id, r, ctx) },

  // ===== Agents, mandates, identity =====
  { name: 'register_agent', method: 'POST', path: '/v1/agents', tag: 'Agents & access', auth: 'public', status: 201,
    summary: 'Get an agent API key instantly (self-serve)', description: 'Registers your agent and returns an API key, a request-signing secret and a webhook secret. Sandbox agents are verified automatically.',
    input: obj({ name: str('Agent name shown to customers.', { examples: ['Acme Assistant'] }), operator: str('Company or person operating the agent.'), contact_email: str('Developer contact.'), website: str('Optional URL.'), platform: str('Optional: claude, chatgpt, gemini, copilot, custom...'), webhook_url: str('Optional HTTPS URL for signed event webhooks.'), description: str('Optional.') }, ['name']),
    handler: (i, ctx) => registerAgent(i, ctx) },
  { name: 'get_agent', method: 'GET', path: '/v1/agents/me', tag: 'Agents & access', auth: 'agent', readOnly: true,
    summary: 'Your agent profile and verification status', description: 'Profile, verification and webhook settings.', input: obj({}), handler: (_, ctx) => publicAgent(store.agents.get(ctx.actor.agent_id)) },
  { name: 'update_agent_webhook', method: 'PUT', path: '/v1/agents/me/webhook', tag: 'Agents & access', auth: 'agent', idempotent: true,
    summary: 'Set the webhook URL for event pushes', description: 'Events (policy, claim, payment, renewal, case) are POSTed with an FK-Signature HMAC header.', input: obj({ webhook_url: str('HTTPS URL, or empty to remove.') }),
    handler: ({ webhook_url }, ctx) => publicAgent(store.agents.update(ctx.actor.agent_id, { webhook_url: webhook_url || null })) },
  { name: 'request_mandate', method: 'POST', path: '/v1/mandates', tag: 'Agents & access', auth: 'agent', status: 201,
    summary: 'Ask a customer for scoped, revocable access', description: `The customer approves on their own device. Scopes: ${Object.entries(SCOPES).map(([k, v]) => `${k} (${v})`).join('; ')}. Optional premium_cap and preauthorised_actions (bind, adjust, renew) let you act without asking each time. Returns a confirmation; poll get_confirmation for the mandate_token. Also available as OAuth 2.0 device flow at /oauth/device_authorization.`,
    input: obj({ customer_email: str('The customer\'s email.'), scopes: arr(str('scope', { enum: Object.keys(SCOPES) }), 'Default: read, quote, claim, complaint.'), premium_cap: obj({ amount: num('Max annual premium'), currency: str('Currency') }, [], 'Optional spending cap per policy.'), preauthorised_actions: arr(str('action', { enum: ['bind', 'adjust', 'renew'] }), 'Optional: actions allowed without a fresh confirmation (within the cap).'), expires_in_days: int('Default 90, max 365.'), policy_ids: arr(str('policy id'), 'Optional: limit to these policies.'), purpose: str('Why you need access (shown to the customer).'), ...idemp }, ['customer_email']),
    handler: (i, ctx) => requestMandate(ctx, i) },
  { name: 'list_mandates', method: 'GET', path: '/v1/mandates', tag: 'Agents & access', auth: 'user', readOnly: true,
    summary: 'Mandates you hold (agent) or have granted (customer)', description: 'Scopes, caps, expiry and status.',
    input: obj({}), handler: (_, ctx) => ({ mandates: (ctx.actor.type === 'customer' ? store.mandates.find({ customer_id: ctx.actor.customer_id }) : ctx.actor.type === 'staff' ? store.mandates.find({}) : store.mandates.find({ agent_id: ctx.actor.agent_id })).map(publicMandate) }) },
  { name: 'revoke_mandate', method: 'POST', path: '/v1/mandates/{mandate_id}/revoke', tag: 'Agents & access', auth: 'user', destructive: true, idempotent: true,
    summary: 'Revoke an agent\'s access immediately', description: 'Takes effect on the next request.', input: obj({ mandate_id: str('mdt_...') }, ['mandate_id']), handler: ({ mandate_id }, ctx) => revokeMandate(mandate_id, ctx) },
  { name: 'start_login', method: 'POST', path: '/v1/auth/login', tag: 'Agents & access', auth: 'public',
    summary: 'Customer sign-in: email a one-time code', description: 'For customers (or a UI acting for them). Returns login_id; the code is emailed.', input: obj({ email: str('Customer email.') }, ['email']), handler: ({ email }) => startLogin(email) },
  { name: 'verify_login', method: 'POST', path: '/v1/auth/verify', tag: 'Agents & access', auth: 'public',
    summary: 'Customer sign-in: exchange the code for a session token', description: 'Returns customer_token (fk_cus_...).', input: obj({ login_id: str('From start_login.'), code: str('6-digit code.') }, ['login_id', 'code']), handler: (i) => verifyLogin(i) },
  { name: 'get_me', method: 'GET', path: '/v1/me', tag: 'Agents & access', auth: 'user', readOnly: true,
    summary: 'Who am I acting as?', description: 'The caller identity: agent, customer (via mandate or login), mandate scopes.', input: obj({}),
    handler: (_, ctx) => ({ actor: { type: ctx.actor.type, id: ctx.actor.id, name: ctx.actor.name, verified: ctx.actor.verified || false, signed: ctx.actor.signed || false }, customer: ctx.actor.customer_id ? publicCustomer(store.customers.get(ctx.actor.customer_id)) : null, mandate: ctx.actor.mandate ? publicMandate(ctx.actor.mandate) : null }) },
  { name: 'update_support_needs', method: 'PUT', path: '/v1/me/support-needs', tag: 'Agents & access', auth: 'user', idempotent: true, scope: 'read',
    summary: 'Record that the customer needs extra support', description: 'Vulnerability / accessibility needs (e.g. prefers phone, bereavement). We route their claims and cases to people and adapt communication.',
    input: obj({ flag: bool('Needs extra support.'), needs: str('What helps.'), preferred_channel: str('email, phone, sms, post.') }),
    handler: (i, ctx) => { if (!ctx.actor.customer_id) throw forbidden('Act for a customer first.'); assertCustomerAccess(ctx, ctx.actor.customer_id, 'read'); const c = store.customers.update(ctx.actor.customer_id, { support_needs: { ...i, updated_at: nowIso() } }); audit(ctx, 'customer.support_needs', { entity: 'customer', entity_id: c.id }); return publicCustomer(c); } },
  { name: 'get_activity_log', method: 'GET', path: '/v1/activity', tag: 'Agents & access', auth: 'user', readOnly: true, scope: 'read',
    summary: 'Everything done on the customer\'s account, by whom', description: 'Audit trail: every action with actor (agent/customer/staff/system), time and mandate. Visible to the customer and their agents.',
    input: obj({ entity_id: str('Optional: one policy/claim/etc.'), limit: int('Default 100.') }),
    handler: ({ entity_id, limit }, ctx) => { const cid = ctx.actor.customer_id; if (!cid && ctx.actor.type !== 'staff') throw forbidden('Act for a customer to see their activity.', { fix: 'Use a mandate token or customer login.' }); if (cid) assertCustomerAccess(ctx, cid, 'read'); return { activity: store.audit.find({ customer_id: cid, entity_id }, { limit: limit || 100 }) }; } },
  { name: 'list_events', method: 'GET', path: '/v1/events', tag: 'Agents & access', auth: 'user', readOnly: true,
    summary: 'Event feed (alternative to webhooks)', description: 'Events for you since a timestamp: policy.bound, claim.updated, payment.failed, policy.renewal_offered, confirmation.decided, case.updated and more.',
    input: obj({ since: str('ISO timestamp; default last 7 days.'), limit: int('Default 100.') }),
    handler: ({ since, limit }, ctx) => {
      const s = since || new Date(Date.now() - 7 * DAY).toISOString();
      const rows = ctx.actor.type === 'agent' && !ctx.actor.customer_id
        ? store.events.where(`created_at > ? AND EXISTS (SELECT 1 FROM json_each(json_extract(data,'$.agent_ids')) WHERE value = ?)`, [s, ctx.actor.agent_id], { limit: limit || 100, desc: false })
        : store.events.where(`created_at > ? AND json_extract(data,'$.customer_id') = ?`, [s, ctx.actor.customer_id || ''], { limit: limit || 100, desc: false });
      return { events: rows, next_since: rows.at(-1)?.at || s };
    } },
  { name: 'verify_receipt', method: 'POST', path: '/v1/receipts/verify', tag: 'Agents & access', auth: 'public', readOnly: true,
    summary: 'Check a transaction receipt is genuine', description: 'Verifies the signature on any receipt we returned.',
    input: obj({ receipt: obj({ kind: str('k'), reference: str('r'), status: str('s'), at: str('t'), amount: num('a'), currency: str('c'), signature: str('sig') }, [], 'The receipt object.') }, ['receipt']),
    handler: ({ receipt: r }) => { const { signature, verify, ...rest } = r; const body = { kind: rest.kind, reference: rest.reference, status: rest.status, at: rest.at, amount: rest.amount ?? null, currency: rest.currency ?? null }; return { valid: signature === `hmac-sha256:${hmac(JSON.stringify(body))}` }; } },

  // ===== Transparency & legal =====
  { name: 'get_transparency_metrics', method: 'GET', path: '/v1/transparency', tag: 'Transparency', auth: 'public', readOnly: true,
    summary: 'Live claims, complaints and service metrics', description: 'Claims acceptance rate, time to payment, fast-track share, decline reasons, complaints and upheld rate, human response times, financial strength - computed live.',
    input: obj({}), handler: () => transparencyMetrics() },
  { name: 'get_legal_statements', method: 'GET', path: '/v1/legal', tag: 'Transparency', auth: 'public', readOnly: true,
    summary: 'Terms (agents welcome), AI use, privacy, vulnerability, consumer protection', description: 'Terms of use explicitly permitting agent access, where AI is and is not used, how to get human review, data minimisation and retention, vulnerability support.',
    input: obj({}), handler: (_, ctx) => legalStatements(ctx.baseUrl) },

  // ===== Sandbox =====
  { name: 'sandbox_personas', method: 'GET', path: '/v1/sandbox/personas', tag: 'Sandbox', auth: 'public', readOnly: true, sandboxOnly: true,
    summary: 'Ready-made test customers, cars and payment tokens', description: 'Personas for create_quote, plate numbers for lookup, and payment tokens that succeed or fail.', input: obj({}), handler: () => sandboxPersonas() },
  { name: 'sandbox_outbox', method: 'GET', path: '/v1/sandbox/outbox', tag: 'Sandbox', auth: 'public', readOnly: true, sandboxOnly: true,
    summary: 'Read emails we sent to a customer (sandbox only)', description: 'See confirmation codes, documents and notifications exactly as the human would.',
    input: obj({ email: str('Customer email.'), limit: int('Default 20.') }, ['email']), handler: ({ email, limit }) => ({ messages: store.notifications.find({ to: String(email).toLowerCase() }, { limit: limit || 20 }) }) },
  { name: 'sandbox_advance_clock', method: 'POST', path: '/v1/sandbox/clock', tag: 'Sandbox', auth: 'public', sandboxOnly: true,
    summary: 'Move time forward and run daily jobs (renewals, instalments)', description: 'Advance the sandbox clock by N days (0 to just run jobs) to test renewals, instalments and expiry. reset=true returns to real time.',
    input: obj({ days: int('Days to move forward.'), reset: bool('Back to real time.') }),
    handler: async ({ days, reset }, ctx) => { setClockOffset(reset ? 0 : getClockOffset() + (days || 0) * DAY); const report = await runScheduler({ baseUrl: ctx.baseUrl }); return { today: today(), offset_days: Math.round(getClockOffset() / DAY), scheduler: report }; } },

  // ===== Staff (back office) =====
  { name: 'staff_queue', method: 'GET', path: '/v1/staff/queue', tag: 'Staff', auth: 'staff', readOnly: true, internal: true,
    summary: 'Work queue: referred claims, disputes, cases, complaints, referrals', description: 'Everything waiting for a person, oldest first.',
    input: obj({}), handler: () => ({
      claims: store.claims.where(`json_extract(data,'$.status') IN ('referred','disputed')`, [], { desc: false }),
      cases: store.cases.where(`json_extract(data,'$.status') IN ('open','with_human')`, [], { desc: false }),
      complaints: store.complaints.where(`json_extract(data,'$.status') IN ('acknowledged','investigating')`, [], { desc: false }),
      referred_quotes: store.quotes.find({ status: 'referred' }, { limit: 50 }),
    }) },
  { name: 'staff_decide_claim', method: 'POST', path: '/v1/staff/claims/{claim_id}/decision', tag: 'Staff', auth: 'staff', internal: true,
    summary: 'Make an offer or decline a referred claim', description: 'decision: offer (with amount = gross loss before excess) or decline (with reason).',
    input: obj({ claim_id: str('Claim id.'), decision: str('offer or decline', { enum: ['offer', 'decline'] }), amount: num('Gross amount before excess.'), reason: str('Plain-language reason for the customer.') }, ['claim_id', 'decision']),
    handler: ({ claim_id, ...r }, ctx) => staffDecideClaim(claim_id, r, ctx) },
  { name: 'staff_respond_complaint', method: 'POST', path: '/v1/staff/complaints/{complaint_id}/response', tag: 'Staff', auth: 'staff', internal: true,
    summary: 'Respond to a complaint', description: 'Interim update or final response (final=true, upheld, remedy).',
    input: obj({ complaint_id: str('Complaint id.'), response: str('Text to the customer.'), final: bool('Final response?'), upheld: bool('Upheld?'), remedy: str('What we will do.') }, ['complaint_id', 'response']),
    handler: ({ complaint_id, ...r }, ctx) => staffRespondComplaint(complaint_id, r, ctx) },
  { name: 'staff_set_price', method: 'PUT', path: '/v1/staff/pricing/{cell}', tag: 'Staff', auth: 'staff', internal: true, idempotent: true,
    summary: 'Override one cell of the 192-price table', description: 'Sets the reference USD price for CATEGORY:BAND:TIER. Send annual_usd null to remove the override. Affects new quotes and renewals for everyone equally.',
    input: obj({ cell: str('e.g. COMPACT:B:comprehensive'), annual_usd: num('New reference price in USD, or null.') }, ['cell']),
    handler: ({ cell, annual_usd }, ctx) => {
      const exists = referenceTable().some((r) => r.cell === cell);
      if (!exists) throw badRequest('Unknown cell.', [{ field: 'cell', code: 'invalid', message: cell, fix: 'Format CATEGORY:BAND:TIER, e.g. COMPACT:B:comprehensive.' }]);
      const o = getOverrides();
      if (annual_usd == null) delete o[cell]; else o[cell] = Number(annual_usd);
      store.price_overrides.upsert({ id: 'overrides', cells: o });
      setOverrides(o);
      audit(ctx, 'pricing.override', { entity: 'price_cell', entity_id: cell, detail: { annual_usd } });
      return { cell, annual_usd: annual_usd ?? null, overrides: o };
    } },
];

// ---------- helpers ----------
function mkt(c) {
  const m = getMarket(c);
  if (!m) throw badRequest(`Country "${c}" not recognised.`, [{ field: 'country', code: 'invalid', message: 'Unknown country.', fix: 'ISO code like "IE" or a name like "Ireland".' }]);
  if (m.status === 'unavailable') throw new ApiError(422, 'market_unavailable', m.reason, { fix: 'We cannot offer cover in this country.' });
  return m;
}
function tierOr400(t) {
  const n = normaliseTier(t);
  if (!n) throw badRequest(`Unknown cover tier "${t}".`, [{ field: 'cover_tier', code: 'invalid', message: t, fix: `Use one of: ${TIER_CODES.join(', ')}.` }]);
  return n;
}
function stripIdem(i) { const { idempotency_key, ...rest } = i; return rest; }

export const OPS_BY_NAME = Object.fromEntries(OPERATIONS.map((o) => [o.name, o]));

/** Authorise, validate, de-duplicate and run an operation. Shared by REST, MCP and A2A. */
export async function runOperation(op, rawInput, ctx) {
  if (op.sandboxOnly && !isSandbox()) throw notFound('Operation', op.name);
  const a = ctx.actor;
  if (op.auth === 'staff' && a.type !== 'staff') throw a.type === 'anonymous' ? unauthorized('Staff key required.') : forbidden('Staff only.');
  if (op.auth === 'agent' && a.type !== 'agent') throw a.type === 'anonymous' ? unauthorized() : forbidden('Agent key required for this operation.', { fix: 'Register with register_agent and use the api_key.' });
  if (op.auth === 'user' && a.type === 'anonymous') throw unauthorized();
  const { value, errors } = validate(op.input, rawInput || {});
  if (errors.length) throw badRequest(`${errors.length} problem(s) with the request to ${op.name}. Fix the fields listed and retry.`, errors, op.examples ? { example: op.examples[0] } : {});
  const key = ctx.idempotencyKey || value.idempotency_key;
  const writes = op.method !== 'GET' && !op.readOnly;
  let idemId;
  if (key && writes) {
    idemId = `${a.id || ctx.ip || 'anon'}:${op.name}:${key}`;
    const prior = store.idempotency.get(idemId);
    if (prior) return { ...prior.response, idempotent_replay: true };
  }
  const result = await op.handler(value, ctx);
  if (idemId) store.idempotency.insert({ id: idemId, response: result });
  if (op.readOnly && a.type === 'agent' && a.customer_id) audit(ctx, `viewed.${op.name}`, { entity: op.tag, entity_id: value.policy_id || value.claim_id || null, customer_id: a.customer_id });
  return result;
}

