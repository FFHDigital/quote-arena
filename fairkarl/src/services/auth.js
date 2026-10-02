// Identity: who is calling (agent, customer, staff, anonymous), which customer authorised it,
// and what it may do (mandate scopes, premium cap, pre-authorised actions).
import { store } from '../db.js';
import { config, isSandbox } from '../config.js';
import { id, token, sha256, hmac, safeEqual, nowIso, now, addDays, code6, ApiError, forbidden, unauthorized, badRequest, notFound } from '../util.js';
import { audit, sendMessage } from './notify.js';

export const SCOPES = {
  read: 'View policies, documents, claims and the activity log',
  quote: 'Get quotes and price changes',
  bind: 'Buy new policies',
  adjust: 'Change policies (vehicle, drivers, address, cover)',
  renew: 'Accept renewals and change auto-renew',
  cancel: 'Cancel policies',
  claim: 'Make and manage claims (accepting a settlement always needs your confirmation)',
  complaint: 'Lodge and follow complaints',
};
export const DEFAULT_SCOPES = ['read', 'quote', 'claim', 'complaint'];
export const PREAUTHORISABLE = ['bind', 'adjust', 'renew'];

// ---------- agents ----------
export function registerAgent(input, ctx) {
  const apiKey = token('fk_agt');
  const signingSecret = token('fk_sig');
  const agent = store.agents.insert({
    id: id('agt'), name: input.name, operator: input.operator || null, contact_email: input.contact_email || null,
    website: input.website || null, platform: input.platform || null, description: input.description || null,
    webhook_url: input.webhook_url || null, webhook_secret: token('whsec'), signing_secret_hash: sha256(signingSecret), signing_secret: signingSecret,
    key_hash: sha256(apiKey), environment: config.env,
    verified: isSandbox() ? true : false, verification: isSandbox() ? 'sandbox_auto' : 'pending_review', status: 'active',
  });
  audit({ ...ctx, actor: { type: 'agent', id: agent.id, name: agent.name } }, 'agent.registered', { entity: 'agent', entity_id: agent.id });
  return {
    agent: publicAgent(agent), api_key: apiKey, signing_secret: signingSecret, webhook_secret: agent.webhook_secret,
    important: 'Store api_key, signing_secret and webhook_secret now: they are shown only once.',
    how_to_use: 'Send "Authorization: Bearer <api_key>" on every request. Optionally sign requests (FK-Agent-Signature) to be treated as a verified agent in production.',
  };
}
export const publicAgent = (a) => ({ id: a.id, name: a.name, operator: a.operator, platform: a.platform, website: a.website, webhook_url: a.webhook_url, verified: a.verified, verification: a.verification, environment: a.environment, created_at: a.created_at });

// ---------- resolve the caller ----------
export function resolveActor(headers, { method, path, rawBody } = {}) {
  const authz = headers['authorization'] || '';
  const bearer = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : (headers['x-api-key'] || '').trim();
  if (!bearer) return { type: 'anonymous' };
  if (bearer.startsWith('fk_staff')) {
    if (safeEqual(bearer, config.staffKey)) return { type: 'staff', id: 'staff', name: 'FairKarl staff' };
    throw unauthorized('Invalid staff key.');
  }
  if (bearer.startsWith('fk_agt_')) {
    const agent = store.agents.findOne({ key_hash: sha256(bearer) });
    if (!agent || agent.status !== 'active') throw unauthorized('Unknown or disabled agent API key.');
    return agentActor(agent, headers, { method, path, rawBody });
  }
  if (bearer.startsWith('fk_mdt_')) {
    const m = store.mandates.findOne({ token_hash: sha256(bearer) });
    if (!m) throw unauthorized('Unknown mandate token.');
    if (m.status !== 'active') throw new ApiError(401, 'mandate_revoked', `This mandate is ${m.status}. The customer must grant a new one.`, { fix: 'Call request_mandate (POST /v1/mandates) to ask the customer for access again.' });
    if (m.expires_at && m.expires_at < now().toISOString()) throw new ApiError(401, 'mandate_expired', 'This mandate has expired.', { fix: 'Call request_mandate to ask the customer for a new mandate.' });
    const agent = store.agents.get(m.agent_id);
    const base = agentActor(agent, headers, { method, path, rawBody });
    return { ...base, customer_id: m.customer_id, mandate_id: m.id, mandate: m };
  }
  if (bearer.startsWith('fk_cus_')) {
    const s = store.sessions.findOne({ token_hash: sha256(bearer) });
    if (!s || s.expires_at < now().toISOString()) throw unauthorized('Session expired. Log in again.');
    const c = store.customers.get(s.customer_id);
    return { type: 'customer', id: c.id, name: c.name, customer_id: c.id };
  }
  throw unauthorized('Unrecognised credential. Keys start with fk_agt_, fk_mdt_, fk_cus_ or fk_staff.');
}

function agentActor(agent, headers, { method, path, rawBody }) {
  let signed = false;
  const sig = headers['fk-agent-signature'];
  if (sig) {
    const parts = Object.fromEntries(String(sig).split(',').map((p) => p.split('=')));
    const t = Number(parts.t);
    if (!t || Math.abs(Date.now() / 1000 - t) > 300) throw unauthorized('FK-Agent-Signature timestamp is missing or more than 5 minutes old.');
    const expected = hmac(`${t}.${method}.${path}.${rawBody || ''}`, agent.signing_secret);
    if (!safeEqual(expected, parts.v1 || '')) throw unauthorized('FK-Agent-Signature does not match. Sign "<t>.<METHOD>.<path>.<raw body>" with HMAC-SHA256 using your signing_secret.');
    signed = true;
  }
  return { type: 'agent', id: agent.id, agent_id: agent.id, name: agent.name, verified: agent.verified, signed, platform: headers['fk-agent-platform'] || agent.platform || null };
}

// ---------- authorisation helpers ----------
/** Throws unless the caller may act on this customer's data with `scope`. */
export function assertCustomerAccess(ctx, customerId, scope = 'read', { policyId } = {}) {
  const a = ctx.actor;
  if (a.type === 'staff') return;
  if (a.type === 'customer' && a.customer_id === customerId) return;
  if (a.type === 'agent' && a.mandate && a.customer_id === customerId) {
    const m = a.mandate;
    if (!m.scopes.includes(scope)) {
      throw forbidden(`Your mandate does not include the "${scope}" scope.`, { code: 'mandate_scope_missing', required_scope: scope, granted_scopes: m.scopes, fix: `Ask the customer to grant "${scope}" with request_mandate, or ask them to do this themselves.`, next_actions: [{ tool: 'request_mandate', why: `get the ${scope} scope` }] });
    }
    if (policyId && m.policy_ids?.length && !m.policy_ids.includes(policyId)) throw forbidden('Your mandate does not cover this policy.', { code: 'mandate_policy_not_covered', fix: 'Ask the customer for a mandate that includes this policy.' });
    return;
  }
  if (a.type === 'anonymous') throw unauthorized();
  throw forbidden('You are not authorised for this customer.', { code: 'no_mandate', fix: 'Agents need a mandate from the customer. Call request_mandate (POST /v1/mandates) with the customer\'s email; they approve it on their own device.', next_actions: [{ tool: 'request_mandate', why: 'ask the customer for access' }] });
}

/** Can the agent do `action` without a fresh human confirmation? */
export function isPreauthorised(ctx, action, amount) {
  const a = ctx.actor;
  if (a.type === 'customer' || a.type === 'staff') return true;
  const m = a.mandate;
  if (!m || !m.scopes.includes(action) || !m.preauthorised_actions?.includes(action)) return false;
  if (amount && m.premium_cap && amount.currency === m.premium_cap.currency && amount.amount > m.premium_cap.amount) return false;
  if (amount && m.premium_cap && amount.currency !== m.premium_cap.currency) return false;
  return true;
}

// ---------- mandates ----------
export function createMandate({ agent_id, customer_id, scopes, premium_cap, preauthorised_actions, expires_in_days = 90, policy_ids = null, purpose }) {
  const tok = token('fk_mdt');
  const m = store.mandates.insert({
    id: id('mdt'), agent_id, customer_id, scopes, premium_cap: premium_cap || null,
    preauthorised_actions: (preauthorised_actions || []).filter((x) => PREAUTHORISABLE.includes(x) && scopes.includes(x)),
    policy_ids, purpose: purpose || null, status: 'active', granted_at: nowIso(), expires_at: new Date(new Date(addDays(now(), Math.min(expires_in_days, 365))).getTime()).toISOString(),
    token_hash: sha256(tok),
  });
  return { mandate: publicMandate(m), token: tok };
}
export function publicMandate(m) {
  const agent = store.agents.get(m.agent_id);
  return { id: m.id, agent: agent ? { id: agent.id, name: agent.name, verified: agent.verified } : null, customer_id: m.customer_id, scopes: m.scopes, scope_descriptions: m.scopes.map((s) => `${s}: ${SCOPES[s]}`), premium_cap: m.premium_cap, preauthorised_actions: m.preauthorised_actions, policy_ids: m.policy_ids, purpose: m.purpose, status: m.status, granted_at: m.granted_at, expires_at: m.expires_at, revoked_at: m.revoked_at || null };
}
export function revokeMandate(mandateId, ctx) {
  const m = store.mandates.get(mandateId);
  if (!m) throw notFound('Mandate', mandateId);
  const a = ctx.actor;
  const ok = a.type === 'staff' || (a.type === 'customer' && a.customer_id === m.customer_id) || (a.type === 'agent' && a.agent_id === m.agent_id);
  if (!ok) throw forbidden('Only the customer, the agent holding it, or staff can revoke a mandate.');
  const u = store.mandates.update(m.id, { status: 'revoked', revoked_at: nowIso(), revoked_by: a.type });
  audit(ctx, 'mandate.revoked', { entity: 'mandate', entity_id: m.id, customer_id: m.customer_id });
  return publicMandate(u);
}

// ---------- customers ----------
export function findOrCreateCustomer({ email, name, phone, country, address, date_of_birth }) {
  const e = String(email).trim().toLowerCase();
  let c = store.customers.findOne({ email: e });
  if (!c) c = store.customers.insert({ id: id('cus'), email: e, name: name || null, phone: phone || null, country: country || null, address: address || null, date_of_birth: date_of_birth || null, identity: null, support_needs: null });
  else {
    const patch = {};
    for (const [k, v] of Object.entries({ name, phone, country, address, date_of_birth })) if (v && !c[k]) patch[k] = v;
    if (Object.keys(patch).length) c = store.customers.update(c.id, patch);
  }
  return c;
}

/** One identity check, reused for every later action (scorecard 6.4). */
export function markIdentityVerified(customerId, method = 'email_code_possession') {
  const c = store.customers.get(customerId);
  if (!c.identity) store.customers.update(customerId, { identity: { level: method === 'email_code_possession' ? 'basic' : 'strong', method, verified_at: nowIso(), reusable: true } });
}

export function startLogin(email) {
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw badRequest('A valid email is required.', [{ field: 'email', code: 'invalid', message: 'Not a valid email address.', fix: 'Send e.g. "alex@example.com".' }]);
  const code = code6();
  const e = email.trim().toLowerCase();
  const loginId = id('lgn');
  store.sessions.insert({ id: loginId, kind: 'login', email: e, code_hash: sha256(code + loginId), expires_at: new Date(now().getTime() + 15 * 60_000).toISOString(), used: false });
  sendMessage({ to: e, subject: `Your ${config.company.name} sign-in code: ${code}`, text: `Your code is ${code}. It expires in 15 minutes. If you did not ask for it, ignore this email.`, kind: 'login' });
  return { login_id: loginId, sent_to: e, expires_in_seconds: 900, ...(isSandbox() ? { sandbox_code: code } : {}) };
}

export function verifyLogin({ login_id, code }) {
  const l = store.sessions.get(login_id);
  if (!l || l.kind !== 'login' || l.used || l.expires_at < now().toISOString() || !safeEqual(sha256(String(code) + login_id), l.code_hash)) {
    throw new ApiError(401, 'invalid_code', 'That code is wrong or has expired.', { fix: 'Call start_login again to get a new code.' });
  }
  store.sessions.update(login_id, { used: true });
  const c = findOrCreateCustomer({ email: l.email });
  markIdentityVerified(c.id);
  const tok = token('fk_cus');
  store.sessions.insert({ id: id('ses'), kind: 'session', customer_id: c.id, token_hash: sha256(tok), expires_at: new Date(now().getTime() + 30 * 86_400_000).toISOString() });
  return { customer_token: tok, customer: publicCustomer(store.customers.get(c.id)), expires_in_days: 30 };
}

export const publicCustomer = (c) => c && ({ id: c.id, email: c.email, name: c.name, phone: c.phone, country: c.country, address: c.address, identity: c.identity, support_needs: c.support_needs, created_at: c.created_at });
