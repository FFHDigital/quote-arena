// Notifications (email outbox), event feed + signed webhooks, and the audit trail.
// Every important event reaches BOTH the policyholder and every agent acting for them.
import { store } from '../db.js';
import { id, nowIso, hmac, now } from '../util.js';
import { config } from '../config.js';

// ---------- audit ----------
export function audit(ctx, action, { entity, entity_id, customer_id, detail } = {}) {
  const a = ctx?.actor || { type: 'system' };
  return store.audit.insert({
    id: id('aud'), at: nowIso(), action, entity, entity_id,
    customer_id: customer_id ?? a.customer_id ?? null,
    actor: { type: a.type, id: a.id || null, name: a.name || null, agent_id: a.agent_id || null, verified: a.verified || false, signed: a.signed || false },
    mandate_id: a.mandate_id || null, detail: detail || null, ip: ctx?.ip || null,
  });
}

// ---------- messages to humans ----------
/** Email/SMS outbox. In production plug a provider in `transport`; in sandbox read them via GET /v1/sandbox/outbox. */
export let transport = async () => {};
export const setTransport = (fn) => { transport = fn; };

export function sendMessage({ to, subject, text, links = [], kind = 'info', channel = 'email', customer_id }) {
  if (!to) return null;
  const n = store.notifications.insert({ id: id('ntf'), channel, to: String(to).toLowerCase(), subject, text, links, kind, customer_id: customer_id || null, sent_at: nowIso(), status: 'sent' });
  Promise.resolve(transport(n)).catch(() => store.notifications.update(n.id, { status: 'failed' }));
  return n;
}

// ---------- events + webhooks ----------
function agentsFor(customerId) {
  if (!customerId) return [];
  const t = now().toISOString();
  return store.mandates.find({ customer_id: customerId, status: 'active' }).filter((m) => !m.expires_at || m.expires_at > t).map((m) => m.agent_id);
}

/**
 * emit('claim.updated', { customer_id, agent_ids, data, human: {subject, text, links} })
 * Stores the event, emails the policyholder, and pushes a signed webhook to every agent acting for them.
 */
export function emit(type, { customer_id, agent_ids = [], data = {}, human } = {}) {
  const recipients = [...new Set([...agentsFor(customer_id), ...agent_ids.filter(Boolean)])];
  const ev = store.events.insert({ id: id('evt'), type, at: nowIso(), customer_id: customer_id || null, agent_ids: recipients, data, api_version: config.apiVersion });
  if (human && customer_id) {
    const c = store.customers.get(customer_id);
    if (c) sendMessage({ to: c.email, subject: human.subject, text: human.text, links: human.links, kind: type, customer_id });
  }
  for (const agentId of recipients) deliverWebhook(agentId, ev);
  return ev;
}

export function deliverWebhook(agentId, ev, attempt = 1) {
  const agent = store.agents.get(agentId);
  if (!agent?.webhook_url) return;
  const body = JSON.stringify({ id: ev.id, type: ev.type, created_at: ev.at, api_version: ev.api_version, data: ev.data });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${hmac(`${t}.${body}`, agent.webhook_secret)}`;
  fetch(agent.webhook_url, { method: 'POST', headers: { 'content-type': 'application/json', 'fk-signature': sig, 'fk-event-id': ev.id }, body, signal: AbortSignal.timeout(5000) })
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
    .catch(() => { if (attempt < 4) setTimeout(() => deliverWebhook(agentId, ev, attempt + 1), 2 ** attempt * 1000).unref?.(); });
}
