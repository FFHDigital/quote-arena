// Human-agent handoff: a shared case that the customer, their agent and our staff all see,
// with full context attached so nobody repeats themselves.
import { store } from '../db.js';
import { id, nowIso, now, addHours, notFound, forbidden, badRequest } from '../util.js';
import { audit, emit } from './notify.js';
import { assertCustomerAccess } from './auth.js';

const RESPONSE_HOURS = { urgent: 0.25, high: 2, normal: 8, low: 24 };

export function openCase(input, ctx) {
  if (!input.reason && !input.subject) throw badRequest('Tell us why a human is needed.', [{ field: 'reason', code: 'required', message: 'Missing reason.', fix: 'e.g. "underwriting_referral", "claim_review", "customer_request", "vulnerable_customer", "complex_question".' }]);
  const a = ctx.actor;
  let customerId = a.customer_id || null;
  const refs = {};
  for (const [k, coll] of [['quote_id', 'quotes'], ['policy_id', 'policies'], ['claim_id', 'claims'], ['complaint_id', 'complaints']]) {
    if (!input[k]) continue;
    const doc = store[coll].get(input[k]);
    if (!doc) throw notFound(k.replace('_id', ''), input[k]);
    if (doc.customer_id) {
      if (a.type !== 'staff' && a.type !== 'anonymous' && a.customer_id !== doc.customer_id && doc.created_by?.id !== a.id) assertCustomerAccess(ctx, doc.customer_id, 'read');
      customerId = customerId || doc.customer_id;
    }
    refs[k] = input[k];
  }
  const priority = input.priority || (input.vulnerability ? 'high' : 'normal');
  const k = store.cases.insert({
    id: id('cas'), subject: input.subject || String(input.reason).replace(/_/g, ' '), reason: input.reason || 'customer_request', priority, status: 'open', customer_id: customerId,
    contact: input.contact || null, refs, context_summary: input.context_summary || null, transcript: input.transcript || null, documents: input.documents || [],
    vulnerability: input.vulnerability || null, opened_by: { type: a.type, id: a.id || null, name: a.name || null },
    expected_response_by: addHours(now(), RESPONSE_HOURS[priority] || 8), assigned_to: null,
    messages: input.message ? [{ id: id('msg'), at: nowIso(), from: { type: a.type, name: a.name || a.type }, text: input.message }] : [],
  });
  audit(ctx, 'case.opened', { entity: 'case', entity_id: k.id, customer_id: customerId, detail: { reason: k.reason, priority } });
  emit('case.opened', { customer_id: customerId, agent_ids: [a.agent_id], data: { case_id: k.id, subject: k.subject, expected_response_by: k.expected_response_by } });
  return publicCase(k);
}

export function publicCase(k) {
  return { ...k, human_message: k.status === 'open' ? `A person from our team will pick this up by ${k.expected_response_by}. They can already see ${Object.keys(k.refs).length ? Object.keys(k.refs).join(', ') : 'your message'} and everything attached, so nobody needs to repeat anything.` : undefined };
}

function access(k, ctx) {
  const a = ctx.actor;
  if (a.type === 'staff') return;
  if (k.opened_by.id && k.opened_by.id === a.id) return;
  if (k.customer_id) return assertCustomerAccess(ctx, k.customer_id, 'read');
  throw forbidden('Not your case.');
}

export function getCase(cid, ctx) {
  const k = store.cases.get(cid);
  if (!k) throw notFound('Case', cid);
  access(k, ctx);
  return publicCase(k);
}

export function postCaseMessage(cid, { text, documents, status }, ctx) {
  const k = store.cases.get(cid);
  if (!k) throw notFound('Case', cid);
  access(k, ctx);
  if (!text) throw badRequest('text is required.', [{ field: 'text', code: 'required', message: 'Empty message.', fix: 'Write the message.' }]);
  const a = ctx.actor;
  const u = store.cases.update(k.id, (d) => {
    d.messages.push({ id: id('msg'), at: nowIso(), from: { type: a.type, name: a.name || a.type }, text, documents: documents || [] });
    if (a.type === 'staff') { d.assigned_to = d.assigned_to || a.name; d.status = status || 'with_human'; d.first_response_at = d.first_response_at || nowIso(); }
    else if (status === 'resolved') d.status = 'resolved';
    return d;
  });
  audit(ctx, 'case.message', { entity: 'case', entity_id: k.id, customer_id: k.customer_id });
  emit('case.updated', { customer_id: k.customer_id, agent_ids: [k.opened_by.type === 'agent' ? k.opened_by.id : null], data: { case_id: k.id, status: u.status, last_message: u.messages.at(-1) },
    human: a.type === 'staff' ? { subject: `Update on: ${k.subject}`, text: text } : undefined });
  return publicCase(u);
}
