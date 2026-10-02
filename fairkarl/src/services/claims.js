// Claims: structured FNOL -> instant reference -> explicit evidence checklist -> automatic
// assessment (fast-track) or a named human -> settlement offer -> customer accepts/disputes.
import fs from 'node:fs';
import path from 'node:path';
import { store } from '../db.js';
import { config } from '../config.js';
import { id, nowIso, now, today, addBusinessDays, daysBetween, roundMoney, humanRef, receipt, ApiError, notFound, badRequest, unprocessable, forbidden } from '../util.js';
import { getMarket, toUsd } from '../catalog/markets.js';
import { checkCoverage, normaliseIncident, INCIDENT_TYPES, EXCLUSIONS } from '../catalog/products.js';
import { audit, emit } from './notify.js';
import { assertCustomerAccess } from './auth.js';
import { createConfirmation, registerConfirmationHandler } from './confirmations.js';
import { payout, publicPayment } from './payments.js';
import { getPolicyOr404 } from './policies.js';
import { openCase } from './cases.js';
import { lodgeComplaint } from './complaints.js';

export const EVIDENCE_KINDS = {
  photos_damage: 'Photos of the damage (at least 2 angles)',
  photos_scene: 'Photos of the scene, if safe to take',
  repair_estimate: 'A repair estimate or invoice (any garage; set metadata.amount)',
  police_report: 'Police report or crime reference number',
  other_party_details: 'Other driver\'s name, registration and insurer',
  witness_details: 'Witness names and contact details',
  medical_report: 'Medical report or doctor\'s note',
  keys_confirmation: 'Confirmation of how many keys you have (photo of all keys)',
  receipt: 'Receipt for costs you paid (towing, locksmith, etc.)',
  breakdown_report: 'Roadside assistance report',
  other: 'Anything else relevant',
};

const REQUIRED = {
  collision: ['photos_damage', 'repair_estimate'], collision_not_at_fault: ['photos_damage', 'repair_estimate', 'other_party_details'],
  third_party_damage: ['other_party_details', 'photos_damage'], third_party_injury: ['other_party_details'],
  theft: ['police_report', 'keys_confirmation'], attempted_theft: ['photos_damage', 'police_report', 'repair_estimate'], fire: ['photos_damage', 'repair_estimate'],
  vandalism: ['photos_damage', 'police_report', 'repair_estimate'], weather: ['photos_damage', 'repair_estimate'], windscreen: ['photos_damage'],
  breakdown: [], lost_keys: ['receipt'], driver_injury: ['medical_report'],
};
const STATUS_TEXT = {
  awaiting_evidence: 'We need a few things from you before we can decide.', assessing: 'We have everything and are assessing the claim.',
  referred: 'A claims handler is reviewing your claim personally.', offer_made: 'We have made a settlement offer. Accept or dispute it.',
  settlement_pending_confirmation: 'Waiting for the policyholder to confirm the settlement on their own device.', accepted: 'Settlement accepted; payment is on its way.',
  paid: 'Paid.', closed: 'Closed.', declined: 'Not covered - see the explanation. You can ask for a human review or complain.', disputed: 'You disputed the offer; a human is reviewing it.', withdrawn: 'Withdrawn.',
  service_dispatched: 'Help is on the way.',
};

function timeline(c, status, note, actor = 'system') {
  c.timeline = [...(c.timeline || []), { at: nowIso(), status, note, actor }];
  c.status = status;
  c.status_text = STATUS_TEXT[status];
  return c;
}

export function createClaim(input, ctx) {
  const p = getPolicyOr404(input.policy_id);
  assertCustomerAccess(ctx, p.customer_id, 'claim', { policyId: p.id });
  const type = normaliseIncident(input.incident_type || input.type);
  const errs = [];
  if (!type) errs.push({ field: 'incident_type', code: 'invalid', message: 'Unknown or missing incident type.', fix: `Use one of: ${Object.keys(INCIDENT_TYPES).join(', ')}.` });
  const date = input.incident_date || input.date || today();
  if (isNaN(new Date(date))) errs.push({ field: 'incident_date', code: 'invalid', message: 'Not a date.', fix: 'YYYY-MM-DD.' });
  if (!input.description) errs.push({ field: 'description', code: 'required', message: 'Tell us what happened in a sentence or two.', fix: 'e.g. "Reversed into a bollard in a car park, rear bumper cracked."' });
  if (errs.length) throw badRequest('The claim needs a few more details.', errs);
  const market = getMarket(p.country);
  const coverEnd = p.cover_ends || p.end_date;
  const onCover = date >= p.start_date && date <= coverEnd;
  const driverNamed = input.driver_named !== false;
  const coverage = onCover
    ? checkCoverage({ tier: p.cover_tier, incident_type: type, circumstances: input.circumstances || {}, market, vehicleValueLocal: p.vehicle.value ?? null, driver_named: driverNamed, driver_age: input.driver_age })
    : { covered: false, explanation: `The incident date ${date} is outside the period of cover (${p.start_date} to ${coverEnd}).`, exclusions_triggered: [], sections_used: [] };
  const flags = [];
  if (onCover && daysBetween(p.start_date, date) <= 14) flags.push('incident_within_14_days_of_start');
  if (store.claims.find({ policy_id: p.id }).filter((c) => daysBetween(c.incident.date, date) < 60).length >= 2) flags.push('multiple_recent_claims');
  if (input.injuries) flags.push('injuries_reported');
  const required = (REQUIRED[type] || []).map((k) => ({ kind: k, label: EVIDENCE_KINDS[k], received: false }));
  let c = {
    id: id('clm'), number: humanRef('CLM'), policy_id: p.id, policy_number: p.number, customer_id: p.customer_id, currency: p.currency,
    reported_by: { type: ctx.actor.type, id: ctx.actor.id || null, name: ctx.actor.name || null },
    incident: { type, name: INCIDENT_TYPES[type].name, date, time: input.incident_time || null, location: input.location || null, description: input.description,
      third_party_involved: !!input.third_party_involved || ['third_party_damage', 'third_party_injury', 'collision_not_at_fault'].includes(type), injuries: !!input.injuries,
      police_reference: input.police_reference || null, circumstances: input.circumstances || {}, estimated_amount: input.estimated_amount != null ? Number(input.estimated_amount) : null, driver_named: driverNamed },
    coverage, required_evidence: required, evidence: [], fraud_flags: flags, offer: null, decision: null, timeline: [],
    owner: { type: 'automated', name: 'FairKarl claims engine' }, sla: { acknowledged_at: nowIso() }, total_loss: false, vulnerability: input.vulnerability || p.vulnerability || null,
  };
  if (input.police_reference) markEvidence(c, 'police_report');
  if (!coverage.covered && !coverage.exclusions_triggered?.length && !onCover) c = decline(c, coverage.explanation);
  else if (type === 'breakdown' && coverage.covered) timeline(c, 'service_dispatched', 'Roadside assistance requested. A patrol will call the driver within 15 minutes.');
  else timeline(c, required.length ? 'awaiting_evidence' : 'assessing', `Claim ${c.number} opened.`);
  c = store.claims.insert(c);
  audit(ctx, 'claim.created', { entity: 'claim', entity_id: c.id, customer_id: p.customer_id, detail: { type, policy: p.number } });
  c = assess(c.id, ctx);
  emit('claim.created', { customer_id: p.customer_id, data: { claim_id: c.id, number: c.number, status: c.status },
    human: { subject: `Claim ${c.number} received`, text: `We have your claim: ${c.incident.name} on ${c.incident.date}.\nStatus: ${c.status_text}\n${c.required_evidence.filter((e) => !e.received).map((e) => `- Still needed: ${e.label}`).join('\n')}` } });
  return publicClaim(c, ctx);
}

function markEvidence(c, kind) { c.required_evidence = c.required_evidence.map((e) => (e.kind === kind ? { ...e, received: true } : e)); }

function decline(c, why) {
  c.decision = { outcome: 'declined', reason: why, decided_at: nowIso(), decided_by: c.owner, human_review: 'You can ask for a person to review this decision (request_human) or lodge a complaint.' };
  return timeline(c, 'declined', why);
}

/** Automatic assessment. Runs after FNOL and after each evidence upload. */
function assess(claimId, ctx) {
  let c = store.claims.get(claimId);
  if (!['awaiting_evidence', 'assessing'].includes(c.status)) return c;
  const missing = c.required_evidence.filter((e) => !e.received);
  if (missing.length) return c;
  const p = store.policies.get(c.policy_id);
  const market = getMarket(p.country);
  c = store.claims.update(c.id, (d) => {
    if (!d.coverage.covered) return decline(d, d.coverage.explanation);
    const estimate = d.evidence.filter((e) => e.metadata?.amount).map((e) => Number(e.metadata?.amount || 0)).reduce((a, b) => Math.max(a, b), 0) || d.incident.estimated_amount || 0;
    const humanNeeded = d.incident.third_party_involved || d.incident.injuries || d.fraud_flags.length || d.coverage.exclusions_triggered.length || !estimate ||
      toUsd(estimate, market) > config.fastTrackClaimUsd || d.incident.type === 'theft' || d.vulnerability;
    if (humanNeeded) {
      d.owner = { type: 'human', name: 'Claims team', queue: 'claims' };
      d.expected_decision_by = addBusinessDays(now(), 3);
      return timeline(d, 'referred', `A claims handler will decide by ${d.expected_decision_by.slice(0, 10)}. Reason: ${[d.incident.third_party_involved && 'third party involved', d.incident.injuries && 'injuries', d.fraud_flags.length && 'routine checks', !estimate && 'no amount yet', d.incident.type === 'theft' && 'theft claims are always reviewed by a person', toUsd(estimate, market) > config.fastTrackClaimUsd && 'above the fast-track limit', d.vulnerability && 'extra support requested'].filter(Boolean).join(', ')}.`);
    }
    return makeOffer(d, p, estimate, 'Fast-track: evidence complete and within the automatic settlement limit.');
  });
  if (['offer_made', 'declined', 'referred'].includes(c.status)) notifyStatus(c, ctx);
  return c;
}

function makeOffer(d, p, estimate, note, owner) {
  const valueLimit = p.vehicle.value != null ? Number(p.vehicle.value) : Infinity;
  const totalLoss = valueLimit !== Infinity && estimate > 0.7 * valueLimit && ['own_damage', 'fire', 'theft'].includes(d.coverage.sections_used[0]);
  const gross = totalLoss ? valueLimit : Math.min(estimate, valueLimit);
  const excess = d.coverage.excess?.amount || 0;
  const net = Math.max(0, roundMoney(gross - excess, p.currency));
  d.total_loss = totalLoss || d.incident.type === 'theft';
  d.offer = {
    id: id('off'), made_at: nowIso(), currency: p.currency, valid_days: 30,
    breakdown: [{ item: totalLoss ? 'Market value of your car (total loss)' : 'Repair / loss amount', amount: roundMoney(gross, p.currency) }, { item: 'Less your excess', amount: -excess }],
    gross: roundMoney(gross, p.currency), excess, net_payable: net, pay_to: 'policyholder', total_loss: d.total_loss,
    explanation: `${note} We will pay ${net} ${p.currency} (${roundMoney(gross, p.currency)} minus your ${excess} excess).${totalLoss ? ' The repair would cost more than 70% of the car\'s value, so we treat it as a total loss: your policy ends once paid.' : ''}`,
  };
  if (owner) d.owner = owner;
  d.decision = { outcome: 'offer', decided_at: nowIso(), decided_by: d.owner };
  return timeline(d, 'offer_made', d.offer.explanation);
}

function notifyStatus(c, ctx) {
  emit('claim.updated', { customer_id: c.customer_id, data: { claim_id: c.id, number: c.number, status: c.status, offer: c.offer },
    human: { subject: `Claim ${c.number}: ${c.status.replace(/_/g, ' ')}`, text: `${c.status_text}\n${c.timeline.at(-1).note}${c.status === 'offer_made' ? `\nAccept or dispute here: ${ctx.baseUrl}/account` : ''}` } });
}

export function addEvidence(claimId, input, ctx) {
  const c = store.claims.get(claimId);
  if (!c) throw notFound('Claim', claimId);
  assertCustomerAccess(ctx, c.customer_id, 'claim', { policyId: c.policy_id });
  const items = Array.isArray(input.items) ? input.items : [input];
  const added = [];
  for (const it of items) {
    if (!EVIDENCE_KINDS[it.kind]) throw unprocessable('invalid_evidence_kind', `Unknown evidence kind "${it.kind}".`, { fix: `Use one of: ${Object.keys(EVIDENCE_KINDS).join(', ')}.`, allowed: EVIDENCE_KINDS });
    if (!it.url && !it.content_base64 && !it.text && !it.metadata) throw badRequest('Each evidence item needs url, content_base64, text or metadata.', [{ field: 'url', code: 'required', message: 'No content.', fix: 'Send a public/presigned URL, base64 content (max 5 MB), or text/metadata (e.g. {"amount": 850}).' }]);
    let stored = null;
    if (it.content_base64) {
      const buf = Buffer.from(it.content_base64, 'base64');
      if (buf.length > 5 * 1024 * 1024) throw new ApiError(413, 'file_too_large', 'Evidence files must be 5 MB or less.', { fix: 'Compress the image or send a URL instead.' });
      fs.mkdirSync(config.filesDir, { recursive: true });
      stored = `${id('fil')}${path.extname(it.filename || '') || ''}`;
      fs.writeFileSync(path.join(config.filesDir, stored), buf);
    }
    const ev = { id: id('evd'), kind: it.kind, label: EVIDENCE_KINDS[it.kind], filename: it.filename || null, content_type: it.content_type || null, url: it.url || null, stored_file: stored, text: it.text || null, metadata: it.metadata || null, uploaded_by: ctx.actor.type, at: nowIso() };
    added.push(ev);
  }
  store.claims.update(c.id, (d) => {
    d.evidence.push(...added);
    for (const e of added) markEvidence(d, e.kind);
    if (d.status === 'awaiting_evidence' && !d.required_evidence.some((e) => !e.received)) timeline(d, 'assessing', 'All required evidence received.');
    return d;
  });
  audit(ctx, 'claim.evidence_added', { entity: 'claim', entity_id: c.id, customer_id: c.customer_id, detail: { kinds: added.map((a) => a.kind) } });
  const after = assess(c.id, ctx);
  return { added: added.map((a) => ({ id: a.id, kind: a.kind })), still_required: after.required_evidence.filter((e) => !e.received), claim: publicClaim(after, ctx) };
}

export function publicClaim(c, ctx) {
  const missing = c.required_evidence.filter((e) => !e.received);
  const nextStep = {
    awaiting_evidence: `Upload: ${missing.map((m) => m.label).join('; ')}.`, assessing: 'Nothing to do: we are assessing.', referred: `Nothing to do: ${c.owner.name} will decide by ${c.expected_decision_by?.slice(0, 10)}.`,
    offer_made: 'Accept or dispute the offer (respond_settlement).', settlement_pending_confirmation: 'The policyholder must confirm on their device.', accepted: 'Payment is being sent.',
    paid: 'Nothing to do.', closed: 'Nothing to do.', declined: 'Ask for a human review (request_human) or lodge a complaint (create_complaint) if you disagree.', disputed: 'A person is reviewing your dispute.', service_dispatched: 'Stay with the car if safe.',
  }[c.status];
  return {
    id: c.id, number: c.number, policy_id: c.policy_id, policy_number: c.policy_number, status: c.status, status_text: c.status_text, next_step: nextStep,
    owner: c.owner, expected_decision_by: c.expected_decision_by || null, incident: c.incident, coverage: c.coverage, required_evidence: c.required_evidence, missing_evidence: missing,
    evidence: c.evidence.map((e) => ({ id: e.id, kind: e.kind, filename: e.filename, url: e.url, metadata: e.metadata, at: e.at })), offer: c.offer, decision: c.decision,
    payment: c.payment || null, timeline: c.timeline, total_loss: c.total_loss, created_at: c.created_at, updated_at: c.updated_at,
    next_actions: c.status === 'awaiting_evidence' ? [{ tool: 'add_claim_evidence', args: { claim_id: c.id, kind: missing[0]?.kind } }]
      : c.status === 'offer_made' ? [{ tool: 'respond_settlement', args: { claim_id: c.id, decision: 'accept' } }, { tool: 'respond_settlement', args: { claim_id: c.id, decision: 'dispute', reason: '...' } }]
        : c.status === 'declined' ? [{ tool: 'request_human', args: { claim_id: c.id, reason: 'claim_review' } }, { tool: 'create_complaint', args: { claim_id: c.id } }] : [{ tool: 'get_claim', why: 'check again later, or listen for claim.updated webhooks' }],
  };
}

export function getClaim(cid, ctx) {
  const c = store.claims.get(cid) || store.claims.findOne({ number: cid });
  if (!c) throw notFound('Claim', cid);
  assertCustomerAccess(ctx, c.customer_id, 'read', { policyId: c.policy_id });
  return publicClaim(c, ctx);
}

export function listClaims(ctx, { policy_id, status } = {}) {
  const a = ctx.actor;
  if (a.type === 'staff') return { claims: store.claims.find({ policy_id, status }).map((c) => publicClaim(c, ctx)) };
  if (!a.customer_id) return { claims: [], note: 'Act for a customer (mandate) to see their claims.' };
  assertCustomerAccess(ctx, a.customer_id, 'read');
  return { claims: store.claims.find({ customer_id: a.customer_id, policy_id, status }).map((c) => publicClaim(c, ctx)) };
}

export function respondSettlement(cid, { decision, reason, also_lodge_complaint, payout_account }, ctx) {
  const c = store.claims.get(cid);
  if (!c) throw notFound('Claim', cid);
  assertCustomerAccess(ctx, c.customer_id, 'claim', { policyId: c.policy_id });
  if (!['offer_made', 'settlement_pending_confirmation'].includes(c.status)) throw unprocessable('no_open_offer', `There is no open offer (claim is ${c.status}).`, { fix: 'Check get_claim for the current status.' });
  if (decision === 'dispute') {
    const u = store.claims.update(c.id, (d) => { d.dispute = { reason: reason || null, at: nowIso() }; d.owner = { type: 'human', name: 'Claims team (senior review)' }; d.expected_decision_by = addBusinessDays(now(), 5); return timeline(d, 'disputed', `Offer disputed: ${reason || 'no reason given'}. A senior handler will review by ${d.expected_decision_by.slice(0, 10)}.`); });
    const kase = openCase({ subject: `Settlement dispute on ${c.number}`, reason: 'claim_dispute', priority: 'high', claim_id: c.id, policy_id: c.policy_id, context_summary: reason }, { ...ctx, actor: { ...ctx.actor, customer_id: c.customer_id } });
    const complaint = also_lodge_complaint ? lodgeComplaint({ claim_id: c.id, policy_id: c.policy_id, category: 'claim_settlement', description: reason || 'Disputed settlement offer', desired_outcome: 'A higher settlement' }, ctx) : null;
    notifyStatus(u, ctx);
    return { claim: publicClaim(u, ctx), case: kase, complaint };
  }
  if (decision !== 'accept') throw badRequest('decision must be "accept" or "dispute".', [{ field: 'decision', code: 'invalid', message: `Got ${decision}`, fix: 'Send "accept" or "dispute".' }]);
  if (ctx.actor.type === 'agent') {
    const conf = createConfirmation(ctx, {
      action: 'settlement_accept', customer_email: store.customers.get(c.customer_id).email, customer_id: c.customer_id, payload: { claim_id: c.id, offer_id: c.offer.id, payout_account },
      summary: [`Accept ${c.offer.net_payable} ${c.currency} for claim ${c.number} (${c.incident.name}).`, c.offer.explanation, 'Accepting settles this claim in full.'], amount: { amount: c.offer.net_payable, currency: c.currency },
    });
    store.claims.update(c.id, (d) => timeline(d, 'settlement_pending_confirmation', 'Waiting for the policyholder to confirm.'));
    return { confirmation: conf };
  }
  return executeSettlement({ claim_id: c.id, offer_id: c.offer.id, payout_account }, {}, ctx);
}

async function executeSettlement({ claim_id, offer_id, payout_account }, conf, ctx) {
  let c = store.claims.get(claim_id);
  if (c.offer?.id !== offer_id) throw unprocessable('offer_changed', 'The offer changed since this was requested.', { fix: 'Review the new offer with get_claim.' });
  if (c.status === 'paid' || c.status === 'closed') return { claim: publicClaim(c, ctx) };
  c = store.claims.update(c.id, (d) => timeline(d, 'accepted', 'Settlement accepted by the policyholder.', 'customer'));
  const po = await payout({ claim_id: c.id, policy_id: c.policy_id, customer_id: c.customer_id, amount: c.offer.net_payable, currency: c.currency, method: payout_account ? { type: 'bank', token: String(payout_account) } : { type: 'original_payment_method' }, description: `Claim ${c.number} settlement` });
  c = store.claims.update(c.id, (d) => { d.payment = { ...publicPayment(po), expected_in_account: addBusinessDays(now(), 2).slice(0, 10) }; timeline(d, 'paid', `Paid ${c.offer.net_payable} ${c.currency}. Expect it within 2 business days.`); return timeline(d, 'closed', 'Claim closed.'); });
  if (c.total_loss) {
    store.policies.update(c.policy_id, (d) => { d.status = 'cancelled'; d.cover_ends = today(); d.auto_renew = false; d.history.push({ at: nowIso(), type: 'ended_total_loss', detail: `Claim ${c.number}` }); return d; });
  }
  audit(ctx, 'claim.settled', { entity: 'claim', entity_id: c.id, customer_id: c.customer_id, detail: { amount: c.offer.net_payable } });
  notifyStatus(c, ctx);
  return { claim: publicClaim(c, ctx), receipt: receipt('claim.paid', c.number, { status: 'paid', amount: c.offer.net_payable, currency: c.currency }) };
}
registerConfirmationHandler('settlement_accept', executeSettlement);

// ---------- staff ----------
export function staffDecideClaim(cid, { decision, amount, reason }, ctx) {
  if (ctx.actor.type !== 'staff') throw forbidden('Staff only.');
  const c = store.claims.get(cid);
  if (!c) throw notFound('Claim', cid);
  const p = store.policies.get(c.policy_id);
  const owner = { type: 'human', name: ctx.actor.name };
  const u = store.claims.update(c.id, (d) => {
    if (decision === 'decline') { d.owner = owner; return decline(d, reason || 'Declined after review.'); }
    if (decision === 'offer') return makeOffer(d, p, Number(amount), reason || 'Reviewed by a claims handler.', owner);
    throw badRequest('decision must be "offer" or "decline".');
  });
  audit(ctx, `claim.${decision}`, { entity: 'claim', entity_id: c.id, customer_id: c.customer_id, detail: { amount, reason } });
  notifyStatus(u, ctx);
  return publicClaim(u, ctx);
}

export const CLAIM_GUIDE = { incident_types: INCIDENT_TYPES, evidence_kinds: EVIDENCE_KINDS, required_evidence: REQUIRED, circumstance_flags: EXCLUSIONS.map((e) => ({ flag: e.circumstance, exclusion: e.id, title: e.title })) };
