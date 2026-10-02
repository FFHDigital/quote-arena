// Complaints with published deadlines and the ombudsman route for the customer's country.
import { store } from '../db.js';
import { id, nowIso, now, addBusinessDays, humanRef, notFound, forbidden, badRequest } from '../util.js';
import { getMarket } from '../catalog/markets.js';
import { audit, emit } from './notify.js';
import { assertCustomerAccess } from './auth.js';

export function lodgeComplaint(input, ctx) {
  if (!input.description) throw badRequest('Describe the complaint.', [{ field: 'description', code: 'required', message: 'Missing description.', fix: 'What went wrong, in the customer\'s words.' }]);
  let customerId = ctx.actor.customer_id || null;
  let country = null;
  for (const [k, coll] of [['policy_id', 'policies'], ['claim_id', 'claims']]) {
    if (!input[k]) continue;
    const d = store[coll].get(input[k]);
    if (!d) throw notFound(k.replace('_id', ''), input[k]);
    assertCustomerAccess(ctx, d.customer_id, 'complaint');
    customerId = d.customer_id;
    country = country || d.country || store.policies.get(d.policy_id)?.country;
  }
  if (customerId) assertCustomerAccess(ctx, customerId, 'complaint');
  const contact = input.contact_email || (customerId ? store.customers.get(customerId).email : null);
  if (!customerId && !contact) throw badRequest('We need a way to reply.', [{ field: 'contact_email', code: 'required', message: 'No customer context or email.', fix: 'Send contact_email, or act under the customer\'s mandate.' }]);
  const market = getMarket(country || input.country || 'IE');
  const t = now();
  const c = store.complaints.insert({
    id: id('cmp'), reference: humanRef('CMP'), customer_id: customerId, contact_email: contact, about: { policy_id: input.policy_id || null, claim_id: input.claim_id || null },
    category: input.category || 'general', description: input.description, desired_outcome: input.desired_outcome || null, status: 'acknowledged', lodged_by: { type: ctx.actor.type, name: ctx.actor.name || null },
    deadlines: { acknowledged_at: t.toISOString(), next_update_by: addBusinessDays(t, 20), final_response_by: addBusinessDays(t, 40) },
    ombudsman: { ...market.ombudsman, when: 'If you are unhappy with our final response, or we have not given one within 40 business days, you can refer your complaint to the ombudsman free of charge.' },
    responses: [], outcome: null,
  });
  audit(ctx, 'complaint.lodged', { entity: 'complaint', entity_id: c.id, customer_id: customerId });
  emit('complaint.acknowledged', { customer_id: customerId, data: { complaint_id: c.id, reference: c.reference, deadlines: c.deadlines },
    human: { subject: `We have your complaint ${c.reference}`, text: `Thank you for telling us. A named person will investigate.\nUpdate by: ${c.deadlines.next_update_by.slice(0, 10)}\nFinal response by: ${c.deadlines.final_response_by.slice(0, 10)}\nIndependent route: ${c.ombudsman.name}${c.ombudsman.url ? ' ' + c.ombudsman.url : ''}` } });
  return c;
}

export function getComplaint(cid, ctx) {
  const c = store.complaints.get(cid) || store.complaints.findOne({ reference: cid });
  if (!c) throw notFound('Complaint', cid);
  if (ctx.actor.type !== 'staff') {
    if (c.customer_id) assertCustomerAccess(ctx, c.customer_id, 'read');
    else throw forbidden('Not your complaint.');
  }
  return c;
}

export function listComplaints(ctx) {
  if (ctx.actor.type === 'staff') return { complaints: store.complaints.find({}) };
  if (!ctx.actor.customer_id) return { complaints: [] };
  assertCustomerAccess(ctx, ctx.actor.customer_id, 'read');
  return { complaints: store.complaints.find({ customer_id: ctx.actor.customer_id }) };
}

export function staffRespondComplaint(cid, { response, upheld, remedy, final }, ctx) {
  if (ctx.actor.type !== 'staff') throw forbidden('Staff only.');
  const c = getComplaint(cid, ctx);
  const u = store.complaints.update(c.id, (d) => {
    d.responses.push({ at: nowIso(), by: ctx.actor.name, text: response, final: !!final });
    if (final) { d.status = 'final_response'; d.outcome = { upheld: !!upheld, remedy: remedy || null, at: nowIso() }; } else d.status = 'investigating';
    return d;
  });
  audit(ctx, 'complaint.response', { entity: 'complaint', entity_id: c.id, customer_id: c.customer_id, detail: { final, upheld } });
  emit('complaint.updated', { customer_id: c.customer_id, data: { complaint_id: c.id, status: u.status, outcome: u.outcome },
    human: { subject: `${final ? 'Final response' : 'Update'} on complaint ${c.reference}`, text: `${response}${final ? `\n\nIf you are not satisfied you can go to ${u.ombudsman.name}${u.ombudsman.url ? ' ' + u.ombudsman.url : ''}.` : ''}` } });
  return u;
}
