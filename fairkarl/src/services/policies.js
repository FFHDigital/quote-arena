// Policy lifecycle: bind -> documents -> adjust -> renew / cancel.
import { store } from '../db.js';
import { config } from '../config.js';
import { id, nowIso, today, addDays, addMonths, daysBetween, roundMoney, humanRef, hmac, receipt, ApiError, notFound, badRequest, unprocessable, conflict, clone } from '../util.js';
import { getMarket } from '../catalog/markets.js';
import { TIERS, PRODUCT, localiseTier, ipidText, wordingText } from '../catalog/products.js';
import { DRIVER_BANDS } from '../catalog/pricing.js';
import { audit, emit, sendMessage } from './notify.js';
import { assertCustomerAccess, isPreauthorised, findOrCreateCustomer } from './auth.js';
import { createConfirmation, registerConfirmationHandler } from './confirmations.js';
import { charge, refund, normaliseMethod, collectedFor, publicPayment } from './payments.js';
import { normaliseQuoteInput, priceRisk, createQuote } from './quotes.js';

const docSig = (policyId, doc) => hmac(`${policyId}:${doc}`).slice(0, 24);
export const verifyDocSig = (policyId, doc, sig) => sig === docSig(policyId, doc);
const DOCS = { schedule: 'Policy schedule', certificate: 'Certificate of motor insurance', ipid: 'Insurance Product Information Document (IPID)', wording: 'Policy wording', demands_and_needs: 'Demands-and-needs statement', receipts: 'Payment receipts' };

export function getPolicyOr404(pid) {
  const p = store.policies.get(pid) || store.policies.findOne({ number: pid });
  if (!p) throw notFound('Policy', pid);
  return p;
}

export function disclosureLinks(base, { quote, policy }) {
  if (policy) return ['ipid', 'wording', 'demands_and_needs', 'schedule', 'certificate'].map((d) => ({ doc: d, title: DOCS[d], url: `${base}/documents/policy/${policy.id}/${d}?sig=${docSig(policy.id, d)}` }));
  return [
    { doc: 'ipid', title: DOCS.ipid, url: `${base}/documents/ipid/${quote.cover_tier}?country=${quote.country}` },
    { doc: 'wording', title: DOCS.wording, url: `${base}/documents/wording?country=${quote.country}` },
    { doc: 'demands_and_needs', title: DOCS.demands_and_needs, url: `${base}/documents/quote/${quote.id}/demands_and_needs?sig=${docSig(quote.id, 'dn')}` },
  ];
}
export const verifyQuoteDocSig = (qid, sig) => sig === docSig(qid, 'dn');

// ---------- bind ----------
export function bindPolicy(input, ctx) {
  const q = store.quotes.get(input.quote_id);
  if (!q) throw notFound('Quote', input.quote_id);
  if (q.status === 'bound') {
    const existing = store.policies.findOne({ quote_id: q.id });
    if (existing) throw conflict('This quote has already been bought.', { code: 'quote_already_bound', policy_id: existing.id, fix: 'Use get_policy with this policy_id.' });
  }
  if (q.status !== 'quoted') throw unprocessable('quote_not_bindable', `This quote is ${q.status}, so it cannot be bought.`, { fix: q.status === 'declined' ? 'See the quote explanation; request_human for a review.' : 'Create a new quote.' });
  if (q.valid_until < today()) throw unprocessable('quote_expired', `This quote expired on ${q.valid_until}.`, { fix: 'Call requote with this quote_id to get a fresh price (it will be the same unless the table changed).', next_actions: [{ tool: 'requote', args: { quote_id: q.id, changes: {} } }] });
  let ph = { ...(input.policyholder || {}) };
  if (ctx.actor.customer_id) {
    const c = store.customers.get(ctx.actor.customer_id);
    ph = { name: c.name, email: c.email, phone: c.phone, address: c.address, ...ph };
    if (ph.email.toLowerCase() !== c.email) throw unprocessable('policyholder_mismatch', 'You can only buy policies for the customer you are authorised for.', { fix: 'Omit policyholder.email, or use the customer\'s own email.' });
  }
  const errs = [];
  if (!ph.name) errs.push({ field: 'policyholder.name', code: 'required', message: 'Policyholder full name is required.', fix: 'e.g. "Alex Murphy".' });
  if (!ph.email || !/^\S+@\S+\.\S+$/.test(ph.email)) errs.push({ field: 'policyholder.email', code: 'required', message: 'Policyholder email is required: we send the confirmation and legal documents directly to them.', fix: 'The customer\'s own email address.' });
  if (errs.length) throw badRequest('Policyholder details are missing.', errs);
  const startDate = input.start_date || (q.start_date < today() ? today() : q.start_date);
  if (startDate < today()) throw badRequest('Start date cannot be in the past.', [{ field: 'start_date', code: 'invalid', message: 'In the past.', fix: `Use ${today()} or later.` }]);
  const payload = {
    quote_id: q.id, policyholder: ph, payment_method: normaliseMethod(input.payment_method), payment_plan: input.payment_plan || q.payment_plan || 'annual',
    start_date: startDate, auto_renew: input.auto_renew === true, agent_id: ctx.actor.agent_id || null, demands_and_needs_acknowledged: true,
  };
  const amount = { amount: q.price.total_annual, currency: q.price.currency };
  if (isPreauthorised(ctx, 'bind', amount) && payload.payment_method.type !== 'pay_on_confirmation') {
    return executeBind(payload, { customer_id: ctx.actor.customer_id }, ctx);
  }
  const summary = [
    `Car: ${q.vehicle.year} ${q.vehicle.make} ${q.vehicle.model} (${q.vehicle.category_name})`, `Cover: ${TIERS[q.cover_tier].name} - ${TIERS[q.cover_tier].summary}`,
    `Price: ${q.price.total_annual} ${q.price.currency} a year (includes ${q.price.tax_total} tax; no fees)${payload.payment_plan === 'monthly' ? `, paid as 12 x ${q.price.monthly_option.amount} at 0% interest` : ''}`,
    `Starts: ${startDate}, for 12 months. Auto-renew: ${payload.auto_renew ? 'ON' : 'OFF (we will ask you before renewing)'}`,
    `Drivers: ${q.drivers.map((d) => `${d.name || 'driver'} aged ${d.age}`).join(', ')}`, `Demands and needs: ${q.demands_and_needs.statement}`,
  ];
  return createConfirmation(ctx, {
    action: 'bind', customer_email: ph.email, customer_id: ctx.actor.customer_id, payload, summary, amount,
    disclosures: disclosureLinks(ctx.baseUrl, { quote: q }), options: { grant_agent_access: !!ctx.actor.agent_id, needs_payment_method: payload.payment_method.type === 'pay_on_confirmation' },
  });
}

async function executeBind(payload, c, ctx) {
  const q = store.quotes.get(payload.quote_id);
  const existing = store.policies.findOne({ quote_id: q.id });
  if (existing) return { policy: publicPolicy(existing, ctx), already_bound: true };
  if (q.status !== 'quoted' || q.valid_until < today()) throw unprocessable('quote_not_bindable', `The quote is ${q.valid_until < today() ? 'expired' : q.status}.`, { fix: 'Requote and try again.' });
  let method = c.payment_method_override ? normaliseMethod(c.payment_method_override) : payload.payment_method;
  if (method.type === 'pay_on_confirmation') throw new ApiError(402, 'payment_method_required', 'A payment method is needed to complete the purchase.', { fix: 'Send payment_method (e.g. {"type":"card","token":"tok_visa"}) with respond_confirmation, or the customer can pay on the confirmation page.' });
  const customer = findOrCreateCustomer({ ...payload.policyholder, country: q.country });
  const market = getMarket(q.country);
  const ccy = q.price.currency;
  const end = addDays(addMonths(payload.start_date, 12), -1);
  const policyId = id('pol');
  const firstAmount = payload.payment_plan === 'monthly' ? q.price.monthly_option.amount : q.price.total_annual;
  const pay = await charge({ policy_id: policyId, customer_id: customer.id, amount: firstAmount, currency: ccy, method, description: payload.payment_plan === 'monthly' ? 'First monthly instalment' : 'Annual premium' });
  if (pay.status !== 'succeeded') {
    emit('payment.failed', { customer_id: customer.id, agent_ids: [payload.agent_id], data: { quote_id: q.id, payment_id: pay.id, reason: pay.failure } });
    throw new ApiError(402, 'payment_failed', `Payment failed: ${pay.failure.message}`, { payment: publicPayment(pay), fix: 'Try another payment method. Nothing was bought and the confirmation is still open.', retryable: true });
  }
  const instalments = payload.payment_plan === 'monthly'
    ? Array.from({ length: 12 }, (_, i) => ({ n: i + 1, due: addMonths(payload.start_date, i), amount: i === 11 ? q.price.monthly_option.final_instalment : q.price.monthly_option.amount, status: i === 0 ? 'paid' : 'scheduled', payment_id: i === 0 ? pay.id : null }))
    : [];
  const p = store.policies.insert({
    id: policyId, number: humanRef('FK'), status: payload.start_date > today() ? 'scheduled' : 'active', customer_id: customer.id, quote_id: q.id,
    created_by: { type: c.requested_by?.type || ctx.actor.type, id: c.requested_by?.id || ctx.actor.id, agent_id: payload.agent_id },
    country: q.country, currency: ccy, cover_tier: q.cover_tier, vehicle: q.vehicle, drivers: q.drivers, driver_band: q.driver_band, category: q.vehicle.category,
    start_date: payload.start_date, end_date: end, term_days: daysBetween(payload.start_date, end) + 1,
    premium: { annual_total: q.price.total_annual, base_premium: q.price.base_premium, tax_total: q.price.tax_total, fee_total: 0, currency: ccy, price_cell: q.price.price_cell, plan: payload.payment_plan, instalments },
    payment_method: method, auto_renew: payload.auto_renew, policyholder: payload.policyholder, raw_input: { ...q.raw_input, start_date: undefined },
    demands_and_needs: q.demands_and_needs, product_version: PRODUCT.version, documents_version: 1, history: [{ at: nowIso(), type: 'bound', detail: `Bought for ${q.price.total_annual} ${ccy}` }],
    renewal: null, vulnerability: q.vulnerability || null, market_name: market.name,
  });
  store.quotes.update(q.id, { status: 'bound', policy_id: p.id, customer_id: customer.id });
  // G5: disclosures go straight to the policyholder, with proof of delivery.
  const links = disclosureLinks(ctx.baseUrl, { policy: p });
  const n = sendMessage({
    to: customer.email, customer_id: customer.id, kind: 'policy.bound',
    subject: `You're covered: policy ${p.number}`,
    text: [`Your ${TIERS[p.cover_tier].name} cover for the ${p.vehicle.year} ${p.vehicle.make} ${p.vehicle.model} starts ${p.start_date} and ends ${p.end_date}.`,
      `You paid ${firstAmount} ${ccy}${payload.payment_plan === 'monthly' ? ' (first of 12 instalments, 0% interest)' : ''}.`, '', 'Your documents (please read the IPID and demands-and-needs statement):', ...links.map((l) => `- ${l.title}: ${l.url}`), '',
      `You can cancel within ${config.coolingOffDays} days for a full pro-rata refund, and any time after with no fees.`].join('\n'),
    links,
  });
  store.policies.update(p.id, { disclosures_delivered: [{ to: customer.email, notification_id: n.id, at: n.sent_at, documents: links.map((l) => l.doc) }] });
  audit(ctx, 'policy.bound', { entity: 'policy', entity_id: p.id, customer_id: customer.id, detail: { number: p.number, premium: p.premium.annual_total, currency: ccy } });
  emit('policy.bound', { customer_id: customer.id, agent_ids: [payload.agent_id], data: { policy_id: p.id, number: p.number, status: p.status } });
  const fresh = store.policies.get(p.id);
  return { policy: publicPolicy(fresh, ctx), payment: publicPayment(pay), receipt: receipt('policy.bound', p.number, { status: 'bound', amount: firstAmount, currency: ccy }), documents: links };
}
registerConfirmationHandler('bind', executeBind);

// ---------- read ----------
export function publicPolicy(p, ctx) {
  const market = getMarket(p.country);
  const local = localiseTier(p.cover_tier, market, p.vehicle.value ?? null);
  return {
    id: p.id, number: p.number, status: p.status, customer_id: p.customer_id, policyholder: p.policyholder,
    start_date: p.start_date, end_date: p.end_date, cover_ends: p.cover_ends || p.end_date, country: p.country, currency: p.currency,
    vehicle: p.vehicle, drivers: p.drivers, driver_band: p.driver_band, driver_band_name: DRIVER_BANDS[p.driver_band]?.name, category: p.category,
    cover_tier: p.cover_tier, cover: { name: local.name, summary: local.summary, sections: local.sections, not_included: local.not_included, exclusions: local.exclusions },
    premium: p.premium, auto_renew: p.auto_renew, renewal: p.renewal, cancellation: p.cancellation || null,
    documents: disclosureLinks(ctx.baseUrl, { policy: p }), documents_version: p.documents_version, product_version: p.product_version,
    history: p.history, created_at: p.created_at, renewed_from: p.renewed_from || null, renewed_to: p.renewed_to || null, disclosures_delivered: p.disclosures_delivered || [],
    servicing: {
      what_am_i_covered_for: local.summary, renews_on: addDays(p.end_date, 1), days_left: Math.max(0, daysBetween(today(), p.end_date)),
      claims_line: config.company.supportEmail, how_to_claim: 'Call create_claim (POST /v1/claims) or use your account page.',
    },
    next_actions: ['active', 'scheduled'].includes(p.status) ? [
      { tool: 'get_policy_documents', why: 'certificate, schedule, IPID' }, { tool: 'create_claim', why: 'something happened' },
      { tool: 'quote_adjustment', why: 'changed car, driver or address' }, { tool: 'get_renewal_offer', why: 'renewal price and reasons' }, { tool: 'quote_cancellation', why: 'see the refund before cancelling' },
    ] : [],
  };
}

export function getPolicy(pid, ctx) {
  const p = getPolicyOr404(pid);
  assertCustomerAccess(ctx, p.customer_id, 'read', { policyId: p.id });
  return publicPolicy(p, ctx);
}

export function listPolicies(ctx, { customer_id, status } = {}) {
  const a = ctx.actor;
  const cid = a.type === 'staff' ? customer_id : a.customer_id;
  if (!cid && a.type !== 'staff') {
    if (a.type === 'agent') return { policies: [], note: 'Agents see policies once a customer grants a mandate (request_mandate), or after a bind the customer confirmed with agent access.' };
  }
  if (cid) assertCustomerAccess(ctx, cid, 'read');
  const list = store.policies.find({ customer_id: cid, status }, { limit: 200 }).filter((p) => !a.mandate?.policy_ids?.length || a.mandate.policy_ids.includes(p.id));
  return { policies: list.map((p) => ({ id: p.id, number: p.number, status: p.status, vehicle: `${p.vehicle.year} ${p.vehicle.make} ${p.vehicle.model}`, cover_tier: p.cover_tier, start_date: p.start_date, end_date: p.end_date, annual_premium: p.premium.annual_total, currency: p.currency })) };
}

// ---------- documents ----------
export function buildDocument(p, doc) {
  const market = getMarket(p.country);
  const local = localiseTier(p.cover_tier, market, p.vehicle.value ?? null);
  switch (doc) {
    case 'schedule': return {
      title: DOCS.schedule, policy_number: p.number, version: p.documents_version, issued_at: p.updated_at, insurer: config.company.legalName,
      policyholder: p.policyholder, period: { start: p.start_date, end: p.end_date, cover_ends: p.cover_ends || p.end_date }, vehicle: p.vehicle, drivers: p.drivers.map((d) => ({ name: d.name, age: d.age, band: d.band })),
      cover_tier: local.name, sections: local.sections, not_included: local.not_included, premium: p.premium, auto_renew: p.auto_renew, product: `${PRODUCT.name} v${p.product_version}`,
    };
    case 'certificate': return {
      title: DOCS.certificate, certificate_number: `${p.number}-C${p.documents_version}`, policy_number: p.number, insurer: config.company.legalName,
      policyholder: p.policyholder?.name, vehicle_registration: p.vehicle.registration || 'As registered to the policyholder', vehicle: `${p.vehicle.year} ${p.vehicle.make} ${p.vehicle.model}`,
      effective_from: p.start_date, expires: p.cover_ends || p.end_date, persons_entitled_to_drive: [...p.drivers.map((d) => d.name || `Named driver aged ${d.age}`), 'Any other person with the policyholder\'s permission holding a full licence and aged 25+ (third-party only)'],
      limitations_as_to_use: PRODUCT.use, territory: PRODUCT.territory, status: p.status,
      statement: `I hereby certify that the policy to which this certificate relates satisfies the requirements of the relevant law applicable in ${market.name}.`,
    };
    case 'ipid': return { title: DOCS.ipid, text: ipidText(p.cover_tier, market), version: PRODUCT.version };
    case 'wording': return { title: DOCS.wording, text: wordingText(market), version: PRODUCT.version, changelog: PRODUCT.changelog };
    case 'demands_and_needs': return { title: DOCS.demands_and_needs, ...p.demands_and_needs };
    case 'receipts': return { title: DOCS.receipts, payments: store.payments.find({ policy_id: p.id }).map(publicPayment) };
    default: throw notFound('Document', doc);
  }
}

export function getDocuments(pid, ctx, { doc } = {}) {
  const p = getPolicyOr404(pid);
  assertCustomerAccess(ctx, p.customer_id, 'read', { policyId: p.id });
  const docs = doc ? [doc] : Object.keys(DOCS);
  return {
    policy_id: p.id, policy_number: p.number, documents_version: p.documents_version,
    documents: docs.map((d) => ({ doc: d, title: DOCS[d], html_url: `${ctx.baseUrl}/documents/policy/${p.id}/${d}?sig=${docSig(p.id, d)}`, pdf: 'Open html_url and print to PDF', data: buildDocument(p, d) })),
  };
}

// ---------- mid-term adjustments ----------
export function quoteAdjustment(pid, changes = {}, ctx) {
  const p = getPolicyOr404(pid);
  assertCustomerAccess(ctx, p.customer_id, 'quote', { policyId: p.id });
  if (p.status !== 'active' && p.status !== 'scheduled') throw unprocessable('policy_not_active', `Policy is ${p.status}.`, { fix: 'Only active or scheduled policies can be changed.' });
  if (changes.country && changes.country !== p.country) throw unprocessable('country_change_not_supported', 'Moving the car to another country needs a new policy in that country.', { fix: 'Quote in the new country, then cancel this policy (pro-rata refund, no fees).' });
  const raw = clone(p.raw_input);
  if (changes.vehicle) raw.vehicle = changes.vehicle.make ? { ...changes.vehicle } : { ...raw.vehicle, ...changes.vehicle };
  if (changes.drivers) raw.drivers = changes.drivers;
  if (changes.add_driver) raw.drivers = [...(raw.drivers || []), changes.add_driver];
  if (changes.remove_driver_index != null) raw.drivers = (raw.drivers || []).filter((_, i) => i !== Number(changes.remove_driver_index));
  if (changes.cover_tier) raw.cover_tier = changes.cover_tier;
  raw.cover_tier = raw.cover_tier || p.cover_tier;
  raw.start_date = today() < p.start_date ? p.start_date : today();
  const n = normaliseQuoteInput(raw);
  if (n.errors.length) throw badRequest('Some changes are invalid.', n.errors);
  const r = priceRisk(n, { asOf: p.start_date });
  if (r.declines.length || r.refer.length) {
    return { possible: false, reasons: [...r.declines, ...r.refer], explanation: 'We cannot make this change instantly.', next_actions: [{ tool: 'request_human', why: 'a person can review it' }] };
  }
  const eff = raw.start_date;
  const remaining = Math.max(0, daysBetween(eff, p.cover_ends || p.end_date) + 1);
  const frac = remaining / p.term_days;
  const diff = roundMoney((r.price.total_annual - p.premium.annual_total) * frac, p.currency);
  const adj = {
    id: id('adj'), created_at: nowIso(), valid_until: addDays(today(), 7), effective_date: eff, changes,
    new: { vehicle: { ...n.vehicle, category: r.cls.category, category_name: r.cls.name }, drivers: r.bands.drivers, driver_band: r.bands.band, cover_tier: n.tier, price: r.price, raw_input: { ...raw, start_date: undefined } },
    old_annual: p.premium.annual_total, new_annual: r.price.total_annual, currency: p.currency, days_remaining: remaining,
    prorata_difference: diff, direction: diff > 0 ? 'you_pay' : diff < 0 ? 'we_refund' : 'no_change', fees: 0,
    explanation: diff === 0 ? 'No change in price.' : `${diff > 0 ? 'Extra' : 'Refund of'} ${Math.abs(diff)} ${p.currency} for the ${remaining} days left (new annual price ${r.price.total_annual} vs ${p.premium.annual_total}). No admin fee.`,
    category_change: r.cls.category !== p.category ? { from: p.category, to: r.cls.category } : null, band_change: r.bands.band !== p.driver_band ? { from: p.driver_band, to: r.bands.band, reasons: r.bands.drivers.flatMap((d) => d.reasons) } : null,
  };
  store.policies.update(p.id, (d) => { d.pending_adjustments = [...(d.pending_adjustments || []).slice(-9), adj]; return d; });
  return { possible: true, adjustment: { ...adj, new: { ...adj.new, raw_input: undefined } }, next_actions: [{ tool: 'apply_adjustment', args: { policy_id: p.id, adjustment_id: adj.id } }] };
}

export function applyAdjustment(pid, adjustmentId, ctx) {
  const p = getPolicyOr404(pid);
  assertCustomerAccess(ctx, p.customer_id, 'adjust', { policyId: p.id });
  const adj = (p.pending_adjustments || []).find((a) => a.id === adjustmentId);
  if (!adj) throw notFound('Adjustment', adjustmentId);
  if (adj.applied) return { already_applied: true, policy: publicPolicy(p, ctx) };
  if (adj.valid_until < today()) throw unprocessable('adjustment_expired', 'This adjustment quote has expired.', { fix: 'Call quote_adjustment again.' });
  if (adj.prorata_difference > 0 && !isPreauthorised(ctx, 'adjust', { amount: adj.new_annual, currency: adj.currency })) {
    return createConfirmation(ctx, {
      action: 'adjust', customer_email: store.customers.get(p.customer_id).email, customer_id: p.customer_id, payload: { policy_id: p.id, adjustment_id: adj.id },
      summary: [`Policy ${p.number}: ${JSON.stringify(adj.changes)}`, adj.explanation], amount: { amount: adj.prorata_difference, currency: adj.currency },
    });
  }
  return executeAdjust({ policy_id: p.id, adjustment_id: adj.id }, {}, ctx);
}

async function executeAdjust({ policy_id, adjustment_id }, c, ctx) {
  const p = store.policies.get(policy_id);
  const adj = p.pending_adjustments.find((a) => a.id === adjustment_id);
  if (adj.applied) return { already_applied: true };
  let pay = null;
  if (adj.prorata_difference > 0) {
    pay = await charge({ policy_id, customer_id: p.customer_id, amount: adj.prorata_difference, currency: p.currency, method: p.payment_method, description: `Mid-term change ${adj.id}` });
    if (pay.status !== 'succeeded') throw new ApiError(402, 'payment_failed', 'The extra premium could not be collected.', { fix: 'Update the payment method and try again.' });
  } else if (adj.prorata_difference < 0) {
    pay = await refund({ policy_id, customer_id: p.customer_id, amount: -adj.prorata_difference, currency: p.currency, method: p.payment_method, description: `Mid-term change ${adj.id}` });
  }
  const u = store.policies.update(policy_id, (d) => {
    d.vehicle = adj.new.vehicle; d.drivers = adj.new.drivers; d.driver_band = adj.new.driver_band; d.cover_tier = adj.new.cover_tier; d.category = adj.new.vehicle.category;
    d.raw_input = adj.new.raw_input;
    d.premium = { ...d.premium, annual_total: adj.new_annual, base_premium: adj.new.price.base_premium, tax_total: adj.new.price.tax_total, price_cell: adj.new.price.price_cell };
    d.documents_version += 1;
    d.history.push({ at: nowIso(), type: 'adjusted', detail: adj.explanation, adjustment_id: adj.id });
    d.pending_adjustments = d.pending_adjustments.map((a) => (a.id === adj.id ? { ...a, applied: true, applied_at: nowIso() } : a));
    return d;
  });
  audit(ctx, 'policy.adjusted', { entity: 'policy', entity_id: p.id, customer_id: p.customer_id, detail: { adjustment_id, difference: adj.prorata_difference } });
  emit('policy.adjusted', { customer_id: p.customer_id, data: { policy_id: p.id, adjustment_id, difference: adj.prorata_difference, currency: p.currency },
    human: { subject: `Policy ${p.number} updated`, text: `${adj.explanation}\nYour updated documents (version ${u.documents_version}): ${ctx.baseUrl}/documents/policy/${p.id}/schedule?sig=${docSig(p.id, 'schedule')}` } });
  return { policy: publicPolicy(u, ctx), payment: pay && publicPayment(pay), receipt: receipt('policy.adjusted', `${p.number}/${adj.id}`, { status: 'applied', amount: adj.prorata_difference, currency: p.currency }) };
}
registerConfirmationHandler('adjust', executeAdjust);

// ---------- cancellation ----------
export function cancellationQuote(pid, ctx, { effective_date } = {}) {
  const p = getPolicyOr404(pid);
  assertCustomerAccess(ctx, p.customer_id, 'read', { policyId: p.id });
  return calcCancellation(p, effective_date);
}

function calcCancellation(p, effective) {
  if (!['active', 'scheduled'].includes(p.status)) throw unprocessable('policy_not_active', `Policy is ${p.status}.`, { fix: 'Only active or scheduled policies can be cancelled.' });
  const eff = effective || today();
  if (eff < today()) throw badRequest('Cancellation cannot be backdated.', [{ field: 'effective_date', code: 'invalid', message: 'In the past.', fix: `Use ${today()} or later.` }]);
  const daysOnCover = eff < p.start_date ? 0 : Math.min(p.term_days, daysBetween(p.start_date, eff));
  const earned = roundMoney((p.premium.annual_total * daysOnCover) / p.term_days, p.currency);
  const collected = roundMoney(collectedFor(p.id), p.currency);
  const totalLoss = store.claims.find({ policy_id: p.id }).some((c) => c.total_loss && ['paid', 'closed', 'accepted'].includes(c.status));
  const refundAmt = totalLoss ? 0 : Math.max(0, roundMoney(collected - earned, p.currency));
  const owed = totalLoss ? 0 : Math.max(0, roundMoney(earned - collected, p.currency));
  const coolingOff = daysBetween(p.start_date, today()) <= config.coolingOffDays;
  return {
    policy_id: p.id, effective_date: eff, days_on_cover: daysOnCover, term_days: p.term_days, premium_collected: collected, premium_earned: earned,
    refund: refundAmt, amount_still_owed: owed, fees: 0, currency: p.currency, within_cooling_off: coolingOff, future_instalments_cancelled: p.premium.plan === 'monthly',
    explanation: totalLoss ? 'No refund: we have paid a total-loss claim on this policy, so the full premium is earned.'
      : `You get back ${refundAmt} ${p.currency}: you paid ${collected}, and ${daysOnCover} of ${p.term_days} days of cover cost ${earned}. No cancellation fee${coolingOff ? ' (you are also within the 14-day cooling-off period)' : ''}.${owed ? ` ${owed} ${p.currency} is still owed for cover already provided.` : ''}`,
  };
}

export function cancelPolicy(pid, { effective_date, reason } = {}, ctx) {
  const p = getPolicyOr404(pid);
  assertCustomerAccess(ctx, p.customer_id, 'cancel', { policyId: p.id });
  const calc = calcCancellation(p, effective_date);
  if (ctx.actor.type === 'agent') {
    return createConfirmation(ctx, {
      action: 'cancel', customer_email: store.customers.get(p.customer_id).email, customer_id: p.customer_id, payload: { policy_id: p.id, effective_date: calc.effective_date, reason: reason || null },
      summary: [`Cancel policy ${p.number} (${p.vehicle.year} ${p.vehicle.make} ${p.vehicle.model}) from ${calc.effective_date}.`, calc.explanation, 'Your car will not be insured after this date - driving uninsured is illegal.'],
      amount: { amount: calc.refund, currency: p.currency },
    });
  }
  return executeCancel({ policy_id: p.id, effective_date: calc.effective_date, reason }, {}, ctx);
}

async function executeCancel({ policy_id, effective_date, reason }, c, ctx) {
  const p = store.policies.get(policy_id);
  if (p.status === 'cancelled') return { already_cancelled: true, policy: publicPolicy(p, ctx) };
  const calc = calcCancellation(p, effective_date);
  const rf = calc.refund > 0 ? await refund({ policy_id, customer_id: p.customer_id, amount: calc.refund, currency: p.currency, method: p.payment_method, description: 'Cancellation refund' }) : null;
  const u = store.policies.update(policy_id, (d) => {
    d.status = 'cancelled'; d.cover_ends = calc.effective_date; d.auto_renew = false;
    d.cancellation = { ...calc, reason: reason || null, cancelled_at: nowIso(), refund_payment_id: rf?.id || null };
    d.premium.instalments = d.premium.instalments.map((i) => (i.status === 'scheduled' ? { ...i, status: 'cancelled' } : i));
    d.history.push({ at: nowIso(), type: 'cancelled', detail: calc.explanation });
    return d;
  });
  audit(ctx, 'policy.cancelled', { entity: 'policy', entity_id: p.id, customer_id: p.customer_id, detail: { refund: calc.refund, reason } });
  emit('policy.cancelled', { customer_id: p.customer_id, data: { policy_id: p.id, effective_date: calc.effective_date, refund: calc.refund, currency: p.currency },
    human: { subject: `Policy ${p.number} cancelled`, text: `Your cover ends ${calc.effective_date}. ${calc.explanation} Refunds reach your account in 3-5 business days.` } });
  return { policy: publicPolicy(u, ctx), refund: rf && publicPayment(rf), cancellation: calc, receipt: receipt('policy.cancelled', p.number, { status: 'cancelled', amount: calc.refund, currency: p.currency }) };
}
registerConfirmationHandler('cancel', executeCancel);

// ---------- renewals ----------
const AT_FAULT = ['collision', 'third_party_damage', 'third_party_injury'];

export function generateRenewal(p, ctx) {
  if (p.renewal) return p.renewal;
  const raw = clone(p.raw_input);
  raw.start_date = addDays(p.end_date, 1) > addDays(today(), 90) ? addDays(today(), 90) : addDays(p.end_date, 1) < today() ? today() : addDays(p.end_date, 1);
  raw.drivers = (raw.drivers || []).map((d) => (d.age != null && !d.date_of_birth ? { ...d, age: Number(d.age) + 1 } : d)).map((d) => ({ ...d, years_licensed: Number(d.years_licensed ?? 0) + 1 }));
  const termClaims = store.claims.find({ policy_id: p.id }).filter((c) => AT_FAULT.includes(c.incident.type) && !['declined', 'withdrawn'].includes(c.status));
  const protectedCount = TIERS[p.cover_tier].sections.ncd_protection ? 1 : 0;
  const counted = Math.max(0, termClaims.length - protectedCount);
  if (raw.drivers[0] && counted) raw.drivers[0].claims_last_5y = Number(raw.drivers[0].claims_last_5y || 0) + counted;
  raw.cover_tier = p.cover_tier;
  const sysCtx = { ...ctx, actor: { type: 'system', id: 'renewals', customer_id: p.customer_id } };
  const q = createQuote(raw, sysCtx, { renewal_of: p.id, customer_id: p.customer_id });
  const reasons = [];
  if (q.status !== 'quoted') {
    const r = { status: 'not_offered', offered_at: nowIso(), reasons: [q.explanation], explanation: `We cannot offer renewal: ${q.explanation} You can ask a human to review this.`, accept_by: p.end_date };
    store.policies.update(p.id, { renewal: r });
    return r;
  }
  const newCell = q.price.price_cell;
  const [oc, ob] = p.premium.price_cell.split(':');
  const [nc, nb] = newCell.split(':');
  if (oc !== nc) reasons.push(`Your car is now in the ${q.vehicle.category_name} category (was ${oc}).`);
  if (ob !== nb) reasons.push(`Your driver band moved from ${ob} to ${nb}: ${q.drivers.flatMap((d) => d.reasons).join('; ')}.`);
  if (termClaims.length) reasons.push(`${termClaims.length} at-fault claim(s) this year${protectedCount && termClaims.length <= protectedCount ? ' - protected by your no-claims protection, so it does not count' : ''}.`);
  if (oc === nc && ob === nb && q.price.total_annual !== p.premium.annual_total) reasons.push('Our published price table for your group changed for every customer, new or existing.');
  if (!reasons.length) reasons.push('Nothing changed, so your price is the same.');
  const diff = roundMoney(q.price.total_annual - p.premium.annual_total, p.currency);
  const r = {
    status: 'offered', quote_id: q.id, offered_at: nowIso(), new_start_date: q.start_date, prior_annual: p.premium.annual_total, new_annual: q.price.total_annual, currency: p.currency,
    change: diff, change_pct: p.premium.annual_total ? Math.round((diff / p.premium.annual_total) * 1000) / 10 : 0, reasons, price: q.price, alternatives: q.alternatives,
    fairness_statement: 'This is exactly the price a new customer with the same car, drivers and record would pay today. We never charge loyal customers more (no price walking).',
    accept_by: p.end_date, auto_renew: p.auto_renew,
    what_happens_next: p.auto_renew ? `Auto-renew is ON: we will renew on ${addDays(p.end_date, 1)} unless you turn it off.` : `Auto-renew is OFF: your cover ends on ${p.end_date} unless you accept.`,
  };
  store.policies.update(p.id, { renewal: r });
  emit('policy.renewal_offered', { customer_id: p.customer_id, data: { policy_id: p.id, ...r, price: undefined, alternatives: undefined },
    human: { subject: `Your renewal price for ${p.number}: ${r.new_annual} ${p.currency} (last year ${r.prior_annual})`, text: [...reasons, r.fairness_statement, r.what_happens_next].join('\n') } });
  return r;
}

export function getRenewalOffer(pid, ctx) {
  const p = getPolicyOr404(pid);
  assertCustomerAccess(ctx, p.customer_id, 'read', { policyId: p.id });
  if (p.renewed_to) return { status: 'renewed', renewed_to: p.renewed_to, renewal: p.renewal };
  if (!['active', 'scheduled'].includes(p.status)) throw unprocessable('policy_not_renewable', `Policy is ${p.status}.`, { fix: 'Get a new quote instead (create_quote).' });
  const availableFrom = addDays(p.end_date, -60);
  if (today() < availableFrom) return { status: 'not_yet_available', available_from: availableFrom, auto_renew: p.auto_renew, explanation: `Renewal prices are available from ${availableFrom} (60 days before your cover ends). You will be told automatically 30 days before.` };
  return { policy_id: p.id, ...generateRenewal(p, ctx), next_actions: [{ tool: 'accept_renewal', args: { policy_id: p.id } }, { tool: 'set_auto_renew' }] };
}

export function acceptRenewal(pid, { payment_method } = {}, ctx) {
  const p = getPolicyOr404(pid);
  assertCustomerAccess(ctx, p.customer_id, 'renew', { policyId: p.id });
  if (p.renewed_to) return { already_renewed: true, policy_id: p.renewed_to };
  const r = p.renewal?.status === 'offered' ? p.renewal : generateRenewal(p, ctx);
  if (r.status !== 'offered') throw unprocessable('renewal_not_offered', r.explanation || 'No renewal offer available.', { fix: 'Use get_renewal_offer once it is available, or request_human.' });
  const payload = { policy_id: p.id, payment_method: payment_method ? normaliseMethod(payment_method) : p.payment_method };
  if (!isPreauthorised(ctx, 'renew', { amount: r.new_annual, currency: r.currency })) {
    return createConfirmation(ctx, { action: 'renew', customer_email: store.customers.get(p.customer_id).email, customer_id: p.customer_id, payload, amount: { amount: r.new_annual, currency: r.currency },
      summary: [`Renew policy ${p.number} from ${r.new_start_date} for ${r.new_annual} ${r.currency} (last year ${r.prior_annual}).`, ...r.reasons, r.fairness_statement] });
  }
  return executeRenewal(payload, {}, ctx);
}

export async function executeRenewal({ policy_id, payment_method }, c, ctx) {
  const p = store.policies.get(policy_id);
  if (p.renewed_to) return { already_renewed: true, policy_id: p.renewed_to };
  const q = store.quotes.get(p.renewal.quote_id);
  const sysCtx = { ...ctx, actor: ctx.actor };
  const res = await executeBind({ quote_id: q.id, policyholder: p.policyholder, payment_method: payment_method || p.payment_method, payment_plan: p.premium.plan, start_date: q.start_date, auto_renew: p.auto_renew, agent_id: p.created_by?.agent_id }, { customer_id: p.customer_id }, sysCtx);
  store.policies.update(res.policy.id, { renewed_from: p.id });
  store.policies.update(p.id, (d) => { d.renewed_to = res.policy.id; d.renewal = { ...d.renewal, status: 'accepted', accepted_at: nowIso() }; d.history.push({ at: nowIso(), type: 'renewed', detail: `Renewed as ${res.policy.number}` }); return d; });
  audit(ctx, 'policy.renewed', { entity: 'policy', entity_id: p.id, customer_id: p.customer_id, detail: { new_policy_id: res.policy.id } });
  return { ...res, renewed_from: p.id };
}
registerConfirmationHandler('renew', executeRenewal);

export function setAutoRenew(pid, enabled, ctx) {
  const p = getPolicyOr404(pid);
  assertCustomerAccess(ctx, p.customer_id, 'renew', { policyId: p.id });
  if (enabled && !isPreauthorised(ctx, 'renew')) {
    return createConfirmation(ctx, { action: 'auto_renew_on', customer_email: store.customers.get(p.customer_id).email, customer_id: p.customer_id, payload: { policy_id: p.id },
      summary: [`Turn ON auto-renew for ${p.number}. We will tell you the new price 30 days before ${p.end_date} and you can turn it off any time.`] });
  }
  return executeAutoRenew({ policy_id: p.id, enabled: !!enabled }, {}, ctx);
}
function executeAutoRenew({ policy_id, enabled = true }, c, ctx) {
  const u = store.policies.update(policy_id, (d) => { d.auto_renew = enabled; if (d.renewal) d.renewal.auto_renew = enabled; d.history.push({ at: nowIso(), type: 'auto_renew', detail: enabled ? 'on' : 'off' }); return d; });
  audit(ctx, `policy.auto_renew_${enabled ? 'on' : 'off'}`, { entity: 'policy', entity_id: policy_id, customer_id: u.customer_id });
  emit('policy.updated', { customer_id: u.customer_id, data: { policy_id, auto_renew: enabled } });
  return { policy_id, auto_renew: enabled };
}
registerConfirmationHandler('auto_renew_on', executeAutoRenew);
