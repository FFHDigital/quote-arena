// HTTP server: REST (/v1), MCP (/mcp), A2A (/a2a), OAuth device flow, discovery files and web pages.
// Zero dependencies: node:http + node:sqlite.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { config, isSandbox } from './config.js';
import { openDb, store } from './db.js';
import { ApiError, unauthorized, badRequest, sha256, nowIso } from './util.js';
import { OPERATIONS, runOperation } from './api/operations.js';
import { openapi } from './api/openapi.js';
import { handleMcpMessage } from './api/mcp.js';
import { handleA2a } from './api/a2a.js';
import { llmsTxt, robotsTxt, sitemap, agentCard, mcpServerCard, ucpProfile, oauthMetadata, protectedResourceMetadata, aiPlugin, securityTxt } from './api/wellknown.js';
import { resolveActor, createMandate } from './services/auth.js';
import { requestMandate } from './services/confirmations.js';
import { setOverrides } from './catalog/pricing.js';
import { startScheduler } from './services/scheduler.js';
import { renderPage, renderDocument, staticAsset } from './web/pages.js';

const started = Date.now();
const metrics = { requests: 0, errors_5xx: 0, latency_ms_total: 0 };

// ---------- routing ----------
const routes = OPERATIONS.map((op) => {
  const keys = [];
  const re = new RegExp('^' + op.path.replace(/\{(\w+)\}/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { op, re, keys, specificity: -keys.length };
}).sort((a, b) => b.specificity - a.specificity);

function matchRoute(method, path) {
  let pathMatched = false;
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    pathMatched = true;
    if (r.op.method !== method) continue;
    return { op: r.op, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return pathMatched ? { methodNotAllowed: true } : null;
}

// ---------- rate limiting (fixed window per minute) ----------
const buckets = new Map();
function rateLimit(key, limit) {
  const win = Math.floor(Date.now() / 60000);
  const k = `${key}:${win}`;
  const n = (buckets.get(k) || 0) + 1;
  buckets.set(k, n);
  if (buckets.size > 50000) for (const kk of buckets.keys()) if (!kk.endsWith(`:${win}`)) buckets.delete(kk);
  return { limit, remaining: Math.max(0, limit - n), reset: 60 - Math.floor((Date.now() / 1000) % 60), exceeded: n > limit };
}

// ---------- helpers ----------
const CORS = {
  'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,idempotency-key,fk-agent-signature,fk-agent-platform,x-api-key,mcp-session-id,mcp-protocol-version,last-event-id',
  'access-control-expose-headers': 'ratelimit-limit,ratelimit-remaining,ratelimit-reset,retry-after,fk-request-id,fk-api-version,mcp-session-id',
};

function send(res, status, body, headers = {}) {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  const payload = isStr ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': isStr ? 'text/plain; charset=utf-8' : status >= 400 ? 'application/problem+json' : 'application/json; charset=utf-8', ...CORS, ...headers });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 8 * 1024 * 1024) throw new ApiError(413, 'payload_too_large', 'Request body over 8 MB.', { fix: 'Send evidence as URLs or smaller files.' }); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return { raw: '', json: {} };
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/x-www-form-urlencoded')) return { raw, json: Object.fromEntries(new URLSearchParams(raw)) };
  try { return { raw, json: JSON.parse(raw) }; } catch { throw badRequest('Body is not valid JSON.', [{ field: 'body', code: 'invalid_json', message: 'Could not parse JSON.', fix: 'Send a JSON object with Content-Type: application/json.' }]); }
}

const baseUrlOf = (req) => config.baseUrl || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host || `localhost:${config.port}`}`;

// ---------- OAuth 2.0 device authorization grant -> mandate ----------
async function oauth(path, body, ctx, res) {
  if (path === '/oauth/device_authorization') {
    const agent = store.agents.get(body.client_id);
    if (!agent || agent.key_hash !== sha256(body.client_secret || '')) return send(res, 401, { error: 'invalid_client', error_description: 'client_id = agent id, client_secret = agent API key.' });
    if (!body.login_hint) return send(res, 400, { error: 'invalid_request', error_description: 'login_hint (the customer email) is required.' });
    const actx = { ...ctx, actor: { type: 'agent', id: agent.id, agent_id: agent.id, name: agent.name, verified: agent.verified } };
    const scopes = String(body.scope || 'read quote claim complaint').split(/[ ,]+/).filter(Boolean);
    const c = requestMandate(actx, { customer_email: body.login_hint, scopes });
    return send(res, 200, { device_code: c.id, user_code: 'Sent to the customer by email', verification_uri: `${ctx.baseUrl}/confirm/${c.id}`, expires_in: 72 * 3600, interval: 5, ...(c.sandbox ? { sandbox_code: c.sandbox.code } : {}) });
  }
  if (path === '/oauth/token') {
    if (body.grant_type !== 'urn:ietf:params:oauth:grant-type:device_code') return send(res, 400, { error: 'unsupported_grant_type' });
    const c = store.confirmations.get(body.device_code);
    const agent = c && store.agents.get(c.requested_by.agent_id);
    if (!c || !agent || agent.id !== body.client_id) return send(res, 400, { error: 'invalid_grant' });
    if (c.status === 'pending') return send(res, 400, { error: 'authorization_pending' });
    if (c.status === 'rejected') return send(res, 400, { error: 'access_denied' });
    if (c.status === 'expired') return send(res, 400, { error: 'expired_token' });
    if (c.token_collected || !c.result?.mandate_token) return send(res, 400, { error: 'invalid_grant', error_description: 'Token already issued.' });
    store.confirmations.update(c.id, { token_collected: true, result: { ...c.result, mandate_token: undefined, mandate_token_collected: true } });
    const m = c.result.mandate;
    return send(res, 200, { access_token: c.result.mandate_token, token_type: 'Bearer', expires_in: Math.floor((new Date(m.expires_at) - Date.now()) / 1000), scope: m.scopes.join(' ') });
  }
  if (path === '/oauth/revoke') {
    const m = store.mandates.findOne({ token_hash: sha256(body.token || '') });
    if (m) store.mandates.update(m.id, { status: 'revoked', revoked_at: nowIso(), revoked_by: 'oauth_revoke' });
    return send(res, 200, {});
  }
  return send(res, 404, { error: 'not_found' });
}

// ---------- main handler ----------
export function createServer() {
  return http.createServer(async (req, res) => {
    const t0 = Date.now();
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const reqId = `req_${Math.random().toString(36).slice(2, 12)}`;
    res.setHeader('fk-request-id', reqId);
    res.setHeader('fk-api-version', config.apiVersion);
    metrics.requests++;
    res.on('finish', () => { metrics.latency_ms_total += Date.now() - t0; if (res.statusCode >= 500) metrics.errors_5xx++; });
    const ctx = { baseUrl: baseUrlOf(req), ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace(/:\d+$/, ''), requestId: reqId, actor: { type: 'anonymous' } };
    try {
      if (req.method === 'OPTIONS') return send(res, 204, '');
      // discovery & static
      const base = ctx.baseUrl;
      const statics = {
        '/llms.txt': () => [llmsTxt(base), 'text/markdown; charset=utf-8'], '/llms-full.txt': () => [llmsTxt(base) + '\n\n## OpenAPI\n\n```json\n' + JSON.stringify(openapi(base), null, 1) + '\n```\n', 'text/markdown; charset=utf-8'],
        '/robots.txt': () => [robotsTxt(base), 'text/plain; charset=utf-8'], '/sitemap.xml': () => [sitemap(base), 'application/xml'],
        '/openapi.json': () => [openapi(base)], '/.well-known/openapi.json': () => [openapi(base)],
        '/.well-known/agent-card.json': () => [agentCard(base)], '/.well-known/agent.json': () => [agentCard(base)],
        '/.well-known/mcp.json': () => [mcpServerCard(base)], '/.well-known/mcp/server-card.json': () => [mcpServerCard(base)], '/.well-known/mcp': () => [mcpServerCard(base)],
        '/.well-known/ucp': () => [ucpProfile(base)], '/.well-known/ai-plugin.json': () => [aiPlugin(base)],
        '/.well-known/oauth-authorization-server': () => [oauthMetadata(base)], '/.well-known/oauth-protected-resource': () => [protectedResourceMetadata(base)], '/.well-known/oauth-protected-resource/mcp': () => [protectedResourceMetadata(base)],
        '/.well-known/security.txt': () => [securityTxt(base), 'text/plain; charset=utf-8'],
        '/health': () => [{ ok: true }],
        '/v1/status': () => [statusJson()],
      };
      if (req.method === 'GET' && statics[path]) {
        const [body, ct] = statics[path]();
        return send(res, 200, body, { ...(ct ? { 'content-type': ct } : {}), 'cache-control': 'public, max-age=300' });
      }
      if (path.startsWith('/assets/')) { const a = staticAsset(path); return a ? send(res, 200, a.body, { 'content-type': a.type, 'cache-control': 'public, max-age=3600' }) : send(res, 404, 'Not found'); }
      if (path.startsWith('/documents/')) { const d = renderDocument(path, url.searchParams, ctx); return send(res, d.status, d.body, { 'content-type': 'text/html; charset=utf-8' }); }

      // resolve caller
      const needsBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
      const body = needsBody ? await readBody(req) : { raw: '', json: {} };
      ctx.actor = resolveActor(req.headers, { method: req.method, path, rawBody: body.raw });
      ctx.idempotencyKey = req.headers['idempotency-key'] || null;
      const rl = rateLimit(ctx.actor.id || ctx.ip, config.rateLimits[ctx.actor.type] || config.rateLimits.anonymous);
      res.setHeader('ratelimit-limit', rl.limit); res.setHeader('ratelimit-remaining', rl.remaining); res.setHeader('ratelimit-reset', rl.reset);
      if (rl.exceeded) return send(res, 429, new ApiError(429, 'rate_limited', `Rate limit of ${rl.limit} requests/minute exceeded.`, { retryable: true, retry_after_seconds: rl.reset, fix: `Wait ${rl.reset}s. Register an agent key (register_agent) for ${config.rateLimits.agent}/min.` }).toJSON(), { 'retry-after': String(rl.reset) });

      if (path.startsWith('/oauth/') && req.method === 'POST') return oauth(path, body.json, ctx, res);

      if (path === '/mcp') {
        if (req.method === 'GET') return send(res, 405, { error: 'This server does not open an SSE stream; POST JSON-RPC messages.' }, { allow: 'POST' });
        if (req.method === 'DELETE') return send(res, 204, '');
        if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }, { allow: 'POST' });
        const msgs = Array.isArray(body.json) ? body.json : [body.json];
        const out = (await Promise.all(msgs.map((m) => handleMcpMessage(m, ctx)))).filter(Boolean);
        if (!out.length) return send(res, 202, '');
        return send(res, 200, Array.isArray(body.json) ? out : out[0], { 'content-type': 'application/json' });
      }
      if (path === '/a2a' && req.method === 'POST') return send(res, 200, await handleA2a(body.json, ctx), { 'content-type': 'application/json' });

      if (path.startsWith('/v1')) {
        const m = matchRoute(req.method, path);
        if (!m) throw new ApiError(404, 'not_found', `No endpoint ${req.method} ${path}.`, { fix: `See ${base}/openapi.json or start with GET /v1/start.` });
        if (m.methodNotAllowed) throw new ApiError(405, 'method_not_allowed', `${req.method} is not supported on ${path}.`, { fix: `See ${base}/openapi.json for the allowed methods.` });
        const query = Object.fromEntries(url.searchParams);
        const input = { ...query, ...(Array.isArray(body.json) ? {} : body.json), ...m.params };
        const result = await runOperation(m.op, input, ctx);
        const status = result?.status === 'pending' && result?.action ? 202 : m.op.status || 200;
        return send(res, status, result);
      }

      if (req.method === 'GET') {
        const page = renderPage(path, url.searchParams, ctx);
        if (page) return send(res, page.status || 200, page.body, { 'content-type': page.type || 'text/html; charset=utf-8' });
      }
      return send(res, 404, new ApiError(404, 'not_found', `Nothing at ${path}.`, { fix: `Try ${base}/ or ${base}/llms.txt` }).toJSON());
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401 && path === '/mcp') res.setHeader('www-authenticate', `Bearer resource_metadata="${ctx.baseUrl}/.well-known/oauth-protected-resource"`);
        return send(res, e.status, { ...e.toJSON(), request_id: reqId });
      }
      console.error(`[${reqId}]`, e);
      return send(res, 500, { type: 'https://fairkarl.example/errors/internal_error', status: 500, code: 'internal_error', detail: 'Something went wrong on our side. It is safe to retry; if it persists, quote the request_id to support.', retryable: true, request_id: reqId });
    }
  });
}

export function statusJson() {
  return {
    status: 'operational', environment: config.env, version: config.apiVersion, uptime_seconds: Math.round((Date.now() - started) / 1000),
    sla: { availability_target: '99.95%', quote_latency_target_ms_p95: 300, support: 'Status changes are posted here and pushed to registered agents.' },
    live: { requests_served: metrics.requests, error_rate_5xx: metrics.requests ? metrics.errors_5xx / metrics.requests : 0, average_latency_ms: metrics.requests ? Math.round(metrics.latency_ms_total / metrics.requests) : 0 },
    components: [{ name: 'REST API', status: 'operational' }, { name: 'MCP server', status: 'operational' }, { name: 'A2A endpoint', status: 'operational' }, { name: 'Payments', status: isSandbox() ? 'sandbox' : 'operational' }, { name: 'Claims', status: 'operational' }],
    incidents_last_90_days: [], rate_limits_per_minute: config.rateLimits,
  };
}

export function boot({ dbPath, port = config.port, scheduler = true } = {}) {
  openDb(dbPath);
  const o = store.price_overrides.get('overrides');
  if (o) setOverrides(o.cells);
  const server = createServer();
  return new Promise((resolve) => server.listen(port, () => {
    const addr = server.address();
    const base = config.baseUrl || `http://localhost:${addr.port}`;
    if (scheduler) startScheduler(base);
    resolve({ server, port: addr.port, base });
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  boot().then(({ base }) => {
    console.log(`${config.company.name} (${config.env}) running at ${base}`);
    console.log(`  Website      ${base}/`);
    console.log(`  REST + docs  ${base}/v1/start   ${base}/openapi.json`);
    console.log(`  MCP          ${base}/mcp`);
    console.log(`  A2A          ${base}/.well-known/agent-card.json`);
    console.log(`  Agent guide  ${base}/llms.txt`);
  });
}


