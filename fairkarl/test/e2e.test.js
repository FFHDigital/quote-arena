// End-to-end: the scorecard's agent test scripts T1-T8, run against REST, MCP and A2A.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const dbPath = path.join(os.tmpdir(), `fk-test-${Date.now()}.db`);
process.env.FK_FILES_DIR = path.join(os.tmpdir(), 'fk-test-files');
const { boot } = await import('../src/server.js');
let srv, base;

before(async () => { const b = await boot({ dbPath, port: 0, scheduler: false }); srv = b.server; base = b.base; });
after(() => { srv.close(); try { fs.unlinkSync(dbPath); } catch { /* ignore */ } });

async function call(method, p, body, token, headers = {}) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, headers: r.headers };
}
const ok = (r, s = [200, 201, 202]) => { assert.ok(s.includes(r.status), `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 600)}`); return r.body; };
async function mcp(method, params, token) {
  const r = await call('POST', '/mcp', { jsonrpc: '2.0', id: Math.random(), method, params }, token);
  return r.body;
}
const tool = async (name, args, token) => { const r = await mcp('tools/call', { name, arguments: args }, token); assert.ok(r.result, JSON.stringify(r)); return r.result; };

const EMAIL = 'alex@example.com';
const state = {};

test('T1 discoverability: well-known files, llms.txt, robots, JSON-LD, no-JS content', async () => {
  for (const p of ['/llms.txt', '/robots.txt', '/openapi.json', '/.well-known/agent-card.json', '/.well-known/mcp.json', '/.well-known/ucp', '/.well-known/oauth-authorization-server', '/sitemap.xml', '/.well-known/ai-plugin.json']) ok(await call('GET', p));
  const robots = (await call('GET', '/robots.txt')).body;
  assert.match(robots, /ClaudeBot\nAllow: \//);
  const home = (await call('GET', '/')).body;
  assert.match(home, /application\/ld\+json/);
  const pricing = (await call('GET', '/pricing?country=IE')).body;
  assert.equal((pricing.match(/<td>/g) || []).length, 192, 'pricing page renders all 192 prices as HTML text');
  const spec = (await call('GET', '/openapi.json')).body;
  assert.equal(spec.openapi, '3.1.0');
  const card = (await call('GET', '/.well-known/agent-card.json')).body;
  assert.ok(card.skills.find((s) => s.id === 'create_quote'));
});

test('T2 product data: tiers, typed limits, exclusions, IPID text, coverage check with clause', async () => {
  const p = ok(await call('GET', '/v1/products?country=IE'));
  assert.equal(p.tiers.length, 4);
  assert.equal(typeof p.tiers[2].sections.own_damage.excess, 'number');
  const g = ok(await call('GET', '/v1/products/comprehensive'));
  assert.match(g.ipid_text, /WHAT IS NOT INSURED/);
  const cov = ok(await call('POST', '/v1/coverage-check', { cover_tier: 'comprehensive', incident_type: 'theft', circumstances: { keys_left_in_or_unlocked: true } }));
  assert.equal(cov.covered, false);
  assert.equal(cov.exclusions_triggered[0].id, 'EX06');
  const pt = ok(await call('GET', '/v1/pricing/table?country=US'));
  assert.equal(pt.count, 192);
});

test('T3 quote: firm, itemised, all tiers, what-if requote, forgiving input, actionable errors', async () => {
  const bad = await call('POST', '/v1/quotes', { country: 'IE', vehicle: { make: 'Toyota' } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors.every((e) => e.fix), 'every error says how to fix it');
  // sloppy, model-style input: strings for numbers, top-level fields, tier alias
  const q = ok(await call('POST', '/v1/quotes', { country: 'Ireland', make: 'Skoda', model: 'Octavia', year: '2020', value: '18000', age: '45', years_licensed: '25', cover_tier: 'fully comprehensive' }));
  assert.equal(q.status, 'quoted');
  assert.equal(q.cover_tier, 'comprehensive');
  assert.equal(q.price.total_annual, Math.round((q.price.base_premium + q.price.tax_total) * 100) / 100);
  assert.equal(q.alternatives.length, 4);
  assert.ok(q.demands_and_needs.statement);
  const t0 = Date.now();
  for (const tier of ['third_party', 'third_party_fire_theft', 'comprehensive_plus']) {
    const r = ok(await call('POST', `/v1/quotes/${q.id}/requote`, { changes: { cover_tier: tier } }));
    assert.ok(r.price_change);
  }
  assert.ok(Date.now() - t0 < 2000);
  const declined = ok(await call('POST', '/v1/quotes', { country: 'IE', vehicle: { make: 'Toyota', model: 'Prius', year: 2019, use: 'rideshare' }, drivers: [{ age: 40 }] }));
  assert.equal(declined.status, 'declined');
  assert.match(declined.explanation, /hire/);
  state.quote = q;
  const r = await call('GET', '/v1/quotes/' + q.id);
  assert.ok(r.headers.get('ratelimit-limit'));
});

test('T4 buy: agent registers, binds, human confirms, idempotent, documents delivered to human', async () => {
  const reg = ok(await call('POST', '/v1/agents', { name: 'Test Assistant', platform: 'claude' }));
  state.agentKey = reg.api_key;
  const body = { quote_id: state.quote.id, policyholder: { name: 'Alex Murphy', email: EMAIL }, payment_method: { type: 'card', token: 'tok_visa' }, payment_plan: 'monthly' };
  const c1 = ok(await call('POST', '/v1/policies', body, state.agentKey, { 'idempotency-key': 'buy-1' }));
  const c2 = ok(await call('POST', '/v1/policies', body, state.agentKey, { 'idempotency-key': 'buy-1' }));
  assert.equal(c1.id, c2.id, 'same idempotency key -> same confirmation');
  assert.equal(c1.status, 'pending');
  const wrong = await call('POST', `/v1/confirmations/${c1.id}`, { code: '000000', decision: 'approve' }, state.agentKey);
  assert.equal(wrong.status, 401);
  const outbox = ok(await call('GET', `/v1/sandbox/outbox?email=${EMAIL}`));
  assert.match(outbox.messages[0].text, /Review and confirm/);
  const conf = ok(await call('POST', `/v1/confirmations/${c1.id}`, { code: c1.sandbox.code, decision: 'approve', grant_agent_access: true }));
  assert.equal(conf.status, 'approved');
  const polled = ok(await call('GET', `/v1/confirmations/${c1.id}`, null, state.agentKey));
  assert.ok(polled.result.mandate_token, 'agent collects mandate token once');
  const again = ok(await call('GET', `/v1/confirmations/${c1.id}`, null, state.agentKey));
  assert.ok(!again.result.mandate_token, 'token shown only once');
  state.mdt = polled.result.mandate_token;
  state.policy = polled.result.policy;
  assert.equal(state.policy.status, 'active');
  const docs = ok(await call('GET', `/v1/policies/${state.policy.id}/documents`, null, state.mdt));
  assert.ok(docs.documents.find((d) => d.doc === 'certificate'));
  const html = await call('GET', docs.documents[0].html_url.replace(base, ''));
  assert.equal(html.status, 200);
  const mail = ok(await call('GET', `/v1/sandbox/outbox?email=${EMAIL}`));
  assert.ok(mail.messages.some((m) => m.subject.includes("You're covered")), 'disclosures emailed to policyholder');
  const p = ok(await call('GET', `/v1/policies/${state.policy.id}`, null, state.mdt));
  assert.equal(p.disclosures_delivered.length, 1);
  // receipt verification
  const v = ok(await call('POST', '/v1/receipts/verify', { receipt: polled.result.receipt }));
  assert.equal(v.valid, true);
});

test('T5 mid-term change priced before commit; mandate scope enforced', async () => {
  const aq = ok(await call('POST', `/v1/policies/${state.policy.id}/adjustments/quote`, { changes: { vehicle: { make: 'BMW', model: '5 Series', year: 2022, value: 45000, body_type: 'saloon' } } }, state.mdt));
  assert.equal(aq.possible, true);
  assert.equal(aq.adjustment.new.vehicle.category, 'EXECUTIVE');
  assert.ok(aq.adjustment.prorata_difference > 0);
  const ap = ok(await call('POST', `/v1/policies/${state.policy.id}/adjustments`, { adjustment_id: aq.adjustment.id }, state.mdt));
  assert.equal(ap.action, 'adjust', 'price increase needs customer confirmation');
  ok(await call('POST', `/v1/confirmations/${ap.id}`, { code: ap.sandbox.code, decision: 'approve' }));
  const p = ok(await call('GET', `/v1/policies/${state.policy.id}`, null, state.mdt));
  assert.equal(p.category, 'EXECUTIVE');
  assert.equal(p.documents_version, 2);
  const cancelNoScope = await call('POST', `/v1/policies/${state.policy.id}/cancel`, {}, state.mdt);
  assert.equal(cancelNoScope.status, 403);
  assert.equal(cancelNoScope.body.code, 'mandate_scope_missing');
});

test('T6 claim: FNOL, evidence checklist, fast-track offer, accept with human confirmation, paid', async () => {
  const c = ok(await call('POST', '/v1/claims', { policy_id: state.policy.number, incident_type: 'weather', incident_date: state.policy.start_date, description: 'Flash flood in the street damaged the car interior.' }, state.mdt));
  assert.match(c.number, /^CLM-/);
  assert.equal(c.status, 'awaiting_evidence');
  assert.ok(c.missing_evidence.length >= 1);
  const e = ok(await call('POST', `/v1/claims/${c.id}/evidence`, { items: [{ kind: 'photos_damage', url: 'https://example.com/a.jpg' }, { kind: 'repair_estimate', text: 'Garage quote', metadata: { amount: 1800 } }] }, state.mdt));
  // incident within 14 days of start -> routine human review
  assert.equal(e.claim.status, 'referred');
  ok(await call('POST', `/v1/staff/claims/${c.id}/decision`, { decision: 'offer', amount: 1800, reason: 'Reviewed photos and estimate.' }, 'fk_staff_sandbox'));
  const got = ok(await call('GET', `/v1/claims/${c.id}`, null, state.mdt));
  assert.equal(got.status, 'offer_made');
  assert.equal(got.offer.net_payable, 1800 - got.offer.excess);
  const acc = ok(await call('POST', `/v1/claims/${c.id}/settlement`, { decision: 'accept' }, state.mdt));
  ok(await call('POST', `/v1/confirmations/${acc.confirmation.id}`, { code: acc.confirmation.sandbox.code, decision: 'approve' }));
  const paid = ok(await call('GET', `/v1/claims/${c.id}`, null, state.mdt));
  assert.equal(paid.status, 'closed');
  assert.ok(paid.payment);
  const ev = ok(await call('GET', '/v1/events', null, state.agentKey));
  assert.ok(ev.events.some((x) => x.type === 'claim.updated'), 'agent receives claim events');
  const h = ok(await call('POST', '/v1/cases', { reason: 'customer_request', claim_id: c.id, context_summary: 'Customer wants to talk about repairs.' }, state.mdt));
  assert.ok(h.expected_response_by);
  ok(await call('POST', `/v1/cases/${h.id}/messages`, { text: 'Hi, I can help.' }, 'fk_staff_sandbox'));
  const shared = ok(await call('GET', `/v1/cases/${h.id}`, null, state.mdt));
  assert.equal(shared.messages.length, 1);
});

test('T7 decline explained, complaint lodged with deadlines and ombudsman', async () => {
  const c = ok(await call('POST', '/v1/claims', { policy_id: state.policy.id, incident_type: 'theft', description: 'Stolen from driveway', circumstances: { keys_left_in_or_unlocked: true } }, state.mdt));
  ok(await call('POST', `/v1/claims/${c.id}/evidence`, { items: [{ kind: 'police_report', text: 'Ref 123' }, { kind: 'keys_confirmation', text: 'One key missing' }] }, state.mdt));
  const d = ok(await call('GET', `/v1/claims/${c.id}`, null, state.mdt));
  assert.equal(d.status, 'declined');
  assert.match(d.decision.reason, /EX06/);
  const cmp = ok(await call('POST', '/v1/complaints', { claim_id: c.id, description: 'Keys were not left in the car.' }, state.mdt));
  assert.match(cmp.ombudsman.name, /FSPO/);
  assert.ok(cmp.deadlines.final_response_by);
});

test('T8 renewal (no loyalty penalty) and cancellation with refund; audit log', async () => {
  const r = ok(await call('POST', '/v1/sandbox/clock', { days: 340 }));
  assert.ok(r.scheduler.renewals_offered >= 1);
  const ren = ok(await call('GET', `/v1/policies/${state.policy.id}/renewal`, null, state.mdt));
  assert.equal(ren.status, 'offered');
  assert.ok(ren.reasons.length);
  assert.match(ren.fairness_statement, /new customer/);
  // customer login + cancel directly
  const l = ok(await call('POST', '/v1/auth/login', { email: EMAIL }));
  const v = ok(await call('POST', '/v1/auth/verify', { login_id: l.login_id, code: l.sandbox_code }));
  const cq = ok(await call('GET', `/v1/policies/${state.policy.id}/cancellation-quote`, null, v.customer_token));
  assert.equal(cq.fees, 0);
  const cx = ok(await call('POST', `/v1/policies/${state.policy.id}/cancel`, { reason: 'Sold the car' }, v.customer_token));
  assert.equal(cx.policy.status, 'cancelled');
  const log = ok(await call('GET', '/v1/activity', null, v.customer_token));
  assert.ok(log.activity.some((a) => a.actor.type === 'agent'), 'agent actions visible to the customer');
  const mandates = ok(await call('GET', '/v1/mandates', null, v.customer_token));
  ok(await call('POST', `/v1/mandates/${mandates.mandates[0].id}/revoke`, {}, v.customer_token));
  const after = await call('GET', `/v1/policies/${state.policy.id}`, null, state.mdt);
  assert.equal(after.status, 401, 'revocation is immediate');
  ok(await call('POST', '/v1/sandbox/clock', { reset: true }));
});

test('MCP: initialize, list tools, quote via tool, errors are tool results', async () => {
  const init = await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  const list = await mcp('tools/list', {});
  assert.ok(list.result.tools.length > 40);
  assert.ok(!list.result.tools.find((t) => t.name.startsWith('staff_')));
  const q = await tool('create_quote', { country: 'GB', vehicle: { make: 'Toyota', model: 'Aygo', year: 2018 }, drivers: [{ age: 19, years_licensed: 1 }] });
  assert.equal(q.isError, false);
  assert.equal(q.structuredContent.vehicle.category, 'MICRO');
  assert.equal(q.structuredContent.driver_band, 'C'); // 19 (3 pts) + licensed 1 year (1 pt)
  const bad = await tool('create_quote', { country: 'GB' });
  assert.equal(bad.isError, true);
  assert.ok(bad.structuredContent.error.errors.length);
  const res = await mcp('resources/read', { uri: 'fairkarl://price-table/JP' });
  assert.equal(JSON.parse(res.result.contents[0].text).rows.length, 192);
  const pr = await mcp('prompts/get', { name: 'buy_car_insurance', arguments: {} });
  assert.ok(pr.result.messages.length);
});

test('A2A: data part runs a skill', async () => {
  const r = ok(await call('POST', '/a2a', { jsonrpc: '2.0', id: 1, method: 'message/send', params: { message: { role: 'user', messageId: 'm1', parts: [{ kind: 'data', data: { skill: 'create_quote', input: { country: 'IN', vehicle: { make: 'Maruti Suzuki', model: 'Alto', year: 2020 }, drivers: [{ age: 30 }] } } }] } } }));
  assert.equal(r.result.status.state, 'completed');
  assert.equal(r.result.artifacts[0].parts[0].data.price.currency, 'INR');
});

test('Global: every country quotes; sanctioned countries are declined with reason', async () => {
  for (const c of ['US', 'JP', 'NG', 'BR', 'MN', 'Fiji']) {
    const q = ok(await call('POST', '/v1/quotes', { country: c, vehicle: { make: 'Honda', model: 'Civic', year: 2019 }, drivers: [{ age: 40 }] }));
    assert.equal(q.status, 'quoted', c);
  }
  const ir = ok(await call('POST', '/v1/quotes', { country: 'IR', vehicle: { make: 'Honda', model: 'Civic', year: 2019 }, drivers: [{ age: 40 }] }));
  assert.equal(ir.status, 'declined');
});

test('OAuth device flow issues a revocable mandate token', async () => {
  const reg = ok(await call('POST', '/v1/agents', { name: 'OAuth Agent' }));
  const da = ok(await call('POST', '/oauth/device_authorization', { client_id: reg.agent.id, client_secret: reg.api_key, login_hint: 'sam@example.com', scope: 'read quote' }));
  const pending = await call('POST', '/oauth/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: da.device_code, client_id: reg.agent.id });
  assert.equal(pending.body.error, 'authorization_pending');
  ok(await call('POST', `/v1/confirmations/${da.device_code}`, { code: da.sandbox_code, decision: 'approve' }));
  const tok = ok(await call('POST', '/oauth/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: da.device_code, client_id: reg.agent.id }));
  assert.match(tok.access_token, /^fk_mdt_/);
  const me = ok(await call('GET', '/v1/me', null, tok.access_token));
  assert.equal(me.customer.email, 'sam@example.com');
});

test('Lifecycle: customer buys directly, instalments collected, fast-track claim, auto-renew', async () => {
  const login = async () => { const l = ok(await call('POST', '/v1/auth/login', { email: 'kim@example.com' })); return ok(await call('POST', '/v1/auth/verify', { login_id: l.login_id, code: l.sandbox_code })).customer_token; };
  let tok = await login();
  const q = ok(await call('POST', '/v1/quotes', { country: 'DE', vehicle: { make: 'Volkswagen', model: 'ID.4', year: 2023, value: 35000 }, drivers: [{ age: 42, years_licensed: 20 }], cover_tier: 'comprehensive_plus' }, tok));
  assert.equal(q.vehicle.category, 'EV');
  const b = ok(await call('POST', '/v1/policies', { quote_id: q.id, payment_method: { type: 'sepa_debit', token: 'sepa_mdt_1' }, payment_plan: 'monthly', policyholder: { name: 'Kim Weber' } }, tok));
  assert.equal(b.policy.status, 'active', 'a logged-in customer buys instantly');
  const pid = b.policy.id;
  const auto = ok(await call('PUT', `/v1/policies/${pid}/auto-renew`, { enabled: true }, tok));
  assert.equal(auto.auto_renew, true);
  const adv = ok(await call('POST', '/v1/sandbox/clock', { days: 40 }));
  assert.ok(adv.scheduler.instalments_collected >= 1);
  tok = await login(); // sessions last 30 days
  const c = ok(await call('POST', '/v1/claims', { policy_id: pid, incident_type: 'windscreen', description: 'Stone chip cracked the windscreen.' }, tok));
  const e = ok(await call('POST', `/v1/claims/${c.id}/evidence`, { kind: 'photos_damage', url: 'https://example.com/w.jpg', metadata: { amount: 400 } }, tok));
  assert.equal(e.claim.status, 'offer_made', e.claim.timeline.at(-1).note + ' fast-track: decided automatically once evidence is complete');
  assert.equal(e.claim.owner.type, 'automated');
  const s = ok(await call('POST', `/v1/claims/${c.id}/settlement`, { decision: 'accept' }, tok));
  assert.equal(s.claim.status, 'closed');
  const end = ok(await call('POST', '/v1/sandbox/clock', { days: 330 }));
  assert.ok(end.scheduler.auto_renewed >= 1, JSON.stringify(end.scheduler));
  tok = await login();
  const old = ok(await call('GET', `/v1/policies/${pid}`, null, tok));
  assert.ok(old.renewed_to);
  const t = ok(await call('GET', '/v1/transparency'));
  assert.ok(t.claims.paid >= 1);
  ok(await call('POST', '/v1/sandbox/clock', { reset: true }));
});
