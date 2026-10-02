// Human confirmation checkpoints. Binding, cancelling, accepting a settlement and granting
// agent access are confirmed by the policyholder on their OWN device (link + code sent to them),
// unless their mandate pre-authorised the action. The agent polls or gets a webhook.
import { store } from '../db.js';
import { config, isSandbox } from '../config.js';
import { id, nowIso, now, addHours, code6, sha256, safeEqual, maskEmail, ApiError, notFound, forbidden, unprocessable } from '../util.js';
import { audit, sendMessage, emit } from './notify.js';
import { findOrCreateCustomer, markIdentityVerified, createMandate, publicMandate, SCOPES } from './auth.js';

const handlers = {};
export const registerConfirmationHandler = (action, fn) => { handlers[action] = fn; };

const ACTION_TEXT = {
  bind: 'Buy a car insurance policy',
  cancel: 'Cancel your policy',
  settlement_accept: 'Accept a claim settlement',
  grant_mandate: 'Give an agent access to your insurance',
  adjust: 'Change your policy',
  renew: 'Renew your policy',
  auto_renew_on: 'Turn on auto-renewal',
};

export function createConfirmation(ctx, { action, customer_email, customer_id, payload, summary, disclosures = [], amount, options }) {
  const code = code6();
  const cid = id('cnf');
  const link = `${ctx.baseUrl}/confirm/${cid}?c=${code}`;
  const doc = store.confirmations.insert({
    id: cid, action, action_text: ACTION_TEXT[action], status: 'pending', customer_email: String(customer_email).toLowerCase(), customer_id: customer_id || null,
    requested_by: { type: ctx.actor.type, id: ctx.actor.id || null, name: ctx.actor.name || null, agent_id: ctx.actor.agent_id || null },
    payload, summary, disclosures, amount: amount || null, options: options || null, code_hash: sha256(code + cid), confirm_url_base: `${ctx.baseUrl}/confirm/${cid}`,
    expires_at: addHours(now(), config.confirmationTtlHours), attempts: 0, result: null,
  });
  sendMessage({
    to: doc.customer_email, customer_id, kind: 'confirmation',
    subject: `Please confirm: ${ACTION_TEXT[action]}${ctx.actor.name ? ` (requested by ${ctx.actor.name})` : ''}`,
    text: [`${ctx.actor.type === 'agent' ? `Your agent "${ctx.actor.name}"` : 'Someone'} asked us to: ${ACTION_TEXT[action]}.`, '', ...summary, '',
      `Review and confirm here: ${link}`, `Or give this code to your agent / enter it on the page: ${code}`, '', 'Nothing happens unless you confirm. If this was not you, ignore this message.',
      ...(disclosures.length ? ['', 'Important documents to read before you confirm:', ...disclosures.map((d) => `- ${d.title}: ${d.url}`)] : [])].join('\n'),
    links: [{ rel: 'confirm', url: link }, ...disclosures.map((d) => ({ rel: d.doc, url: d.url }))],
  });
  audit(ctx, 'confirmation.requested', { entity: 'confirmation', entity_id: cid, customer_id, detail: { action } });
  return publicConfirmation(doc, ctx, isSandbox() ? code : undefined);
}

export function publicConfirmation(c, ctx, sandboxCode) {
  const view = {
    id: c.id, action: c.action, action_text: c.action_text, status: c.status, sent_to: maskEmail(c.customer_email), expires_at: c.expires_at,
    summary: c.summary, disclosures: c.disclosures, amount: c.amount, options: c.options, requested_by: c.requested_by,
    decided_at: c.decided_at || null, result: c.result ? redactResult(c, ctx) : null,
    human_message: c.status === 'pending' ? `We sent a confirmation request to ${maskEmail(c.customer_email)}. Ask them to open the link (or tell you the 6-digit code). Nothing happens until they confirm.` : undefined,
    next_actions: c.status === 'pending' ? [{ tool: 'get_confirmation', why: 'poll every 10-30s until status is approved or rejected (or listen for the confirmation.decided webhook)' }, { tool: 'respond_confirmation', why: 'if the customer reads you the code, submit it with decision=approve' }] : undefined,
  };
  if (sandboxCode) view.sandbox = { code: sandboxCode, note: 'Sandbox only: use this code with respond_confirmation to simulate the customer approving.' };
  return view;
}

function redactResult(c, ctx) {
  const r = { ...c.result };
  // The mandate token is handed over ONCE, and only to the agent that asked for it.
  if (r.mandate_token) {
    if (ctx.actor.type === 'agent' && ctx.actor.agent_id === c.requested_by.agent_id && !c.token_collected) {
      store.confirmations.update(c.id, { token_collected: true, result: { ...c.result, mandate_token: undefined, mandate_token_collected: true } });
    } else delete r.mandate_token;
  }
  return r;
}

export function getConfirmation(cid, ctx, code) {
  const c = expireIfDue(store.confirmations.get(cid));
  if (!c) throw notFound('Confirmation', cid);
  const a = ctx.actor;
  const allowed = a.type === 'staff' || (code && safeEqual(sha256(code + cid), c.code_hash)) || (a.type === 'agent' && a.agent_id === c.requested_by.agent_id) ||
    (a.type === 'customer' && store.customers.get(a.customer_id)?.email === c.customer_email);
  if (!allowed) throw forbidden('Only the requesting agent, the customer, or someone holding the code can view this confirmation.');
  return publicConfirmation(c, ctx);
}

function expireIfDue(c) {
  if (c && c.status === 'pending' && c.expires_at < now().toISOString()) return store.confirmations.update(c.id, { status: 'expired' });
  return c;
}

/** The human (or an agent relaying the human's code) approves or rejects. */
export async function respondConfirmation(cid, { code, decision = 'approve', grant_agent_access, payment_method, reason }, ctx) {
  let c = expireIfDue(store.confirmations.get(cid));
  if (!c) throw notFound('Confirmation', cid);
  if (c.status !== 'pending') throw new ApiError(409, 'already_decided', `This confirmation is already ${c.status}.`, { status_now: c.status, result: c.result });
  const a = ctx.actor;
  const isOwner = a.type === 'customer' && store.customers.get(a.customer_id)?.email === c.customer_email;
  if (!isOwner) {
    if (!code) throw unprocessable('code_required', 'The 6-digit code sent to the customer is required.', { errors: [{ field: 'code', code: 'required', message: 'Missing code.', fix: 'Ask the customer for the code in the message we sent them.' }] });
    if (c.attempts >= 5) throw new ApiError(429, 'too_many_attempts', 'Too many wrong codes. This confirmation is locked.', { fix: 'Start the action again to send a new code.' });
    if (!safeEqual(sha256(String(code) + cid), c.code_hash)) {
      store.confirmations.update(cid, { attempts: c.attempts + 1 });
      throw new ApiError(401, 'invalid_code', 'That code is not correct.', { attempts_left: 4 - c.attempts, fix: 'Check the code in the message sent to the customer.' });
    }
  }
  const customer = findOrCreateCustomer({ email: c.customer_email, ...(c.payload?.policyholder || {}) });
  markIdentityVerified(customer.id);
  const hctx = { ...ctx, actor: { type: 'customer', id: customer.id, customer_id: customer.id, name: customer.name, via: 'confirmation' }, confirmation: c };
  if (decision === 'reject') {
    c = store.confirmations.update(cid, { status: 'rejected', decided_at: nowIso(), customer_id: customer.id, result: { reason: reason || 'Rejected by the customer.' } });
    audit(hctx, 'confirmation.rejected', { entity: 'confirmation', entity_id: cid, customer_id: customer.id, detail: { action: c.action } });
    emit('confirmation.decided', { customer_id: customer.id, agent_ids: [c.requested_by.agent_id], data: { confirmation_id: cid, action: c.action, status: 'rejected' } });
    return publicConfirmation(c, ctx);
  }
  const handler = handlers[c.action];
  let result = await handler(c.payload, { ...c, customer_id: customer.id, payment_method_override: payment_method }, hctx);
  // Agent access: the customer chooses explicitly whether the requesting agent may keep servicing what it set up.
  const agentId = c.requested_by.agent_id;
  if (agentId && c.action !== 'grant_mandate' && grant_agent_access && !store.mandates.find({ agent_id: agentId, customer_id: customer.id, status: 'active' }).length) {
    const { mandate, token } = createMandate({ agent_id: agentId, customer_id: customer.id, scopes: ['read', 'quote', 'claim', 'complaint', 'adjust', 'renew'], expires_in_days: 365, purpose: `Servicing what it set up (${c.action})` });
    result = { ...result, mandate: mandate, mandate_token: token };
  }
  c = store.confirmations.update(cid, { status: 'approved', decided_at: nowIso(), customer_id: customer.id, result });
  audit(hctx, 'confirmation.approved', { entity: 'confirmation', entity_id: cid, customer_id: customer.id, detail: { action: c.action } });
  emit('confirmation.decided', { customer_id: customer.id, agent_ids: [agentId], data: { confirmation_id: cid, action: c.action, status: 'approved', result: { ...result, mandate_token: undefined } } });
  return publicConfirmation(c, ctx);
}

// ---------- agent access requests (mandates) ----------
registerConfirmationHandler('grant_mandate', (p, c) => {
  const { mandate, token } = createMandate({ ...p, customer_id: c.customer_id });
  return { mandate, mandate_token: token, how_to_use: 'Send "Authorization: Bearer <mandate_token>" to act for this customer within the mandate.' };
});

export function requestMandate(ctx, input) {
  if (ctx.actor.type !== 'agent') throw forbidden('Only agents request mandates.', { fix: 'Use an agent API key (register_agent).' });
  const scopes = [...new Set((input.scopes?.length ? input.scopes : ['read', 'quote', 'claim', 'complaint']).map(String))];
  const bad = scopes.filter((s) => !SCOPES[s]);
  if (bad.length) throw unprocessable('invalid_scope', `Unknown scope(s): ${bad.join(', ')}.`, { errors: bad.map((s) => ({ field: 'scopes', code: 'invalid', message: `Unknown scope ${s}`, fix: `Use any of: ${Object.keys(SCOPES).join(', ')}` })) });
  const payload = { agent_id: ctx.actor.agent_id, scopes, premium_cap: input.premium_cap || null, preauthorised_actions: input.preauthorised_actions || [], expires_in_days: input.expires_in_days || 90, policy_ids: input.policy_ids || null, purpose: input.purpose || null };
  const summary = [
    `Agent: ${ctx.actor.name} (${ctx.actor.verified ? 'verified' : 'unverified'})`,
    `It will be able to: ${scopes.map((s) => SCOPES[s]).join('; ')}.`,
    payload.premium_cap ? `Spending cap: ${payload.premium_cap.amount} ${payload.premium_cap.currency} per policy.` : 'No spending cap set (it can never buy without your confirmation unless you pre-authorise).',
    payload.preauthorised_actions.length ? `Without asking you each time: ${payload.preauthorised_actions.join(', ')}.` : 'It must ask you to confirm every purchase, cancellation and settlement.',
    `Valid for ${payload.expires_in_days} days. You can revoke it any time from your account.`,
  ];
  return createConfirmation(ctx, { action: 'grant_mandate', customer_email: input.customer_email, payload, summary });
}

export { publicMandate };
