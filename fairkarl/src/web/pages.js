// Server-rendered pages: every fact is plain HTML (readable with JavaScript off) plus Schema.org JSON-LD.
// Interactive bits (quote, confirm, account, staff) are progressively enhanced by /assets/app.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { esc, fmtMoney } from '../util.js';
import { store } from '../db.js';
import { CATEGORIES } from '../catalog/categories.js';
import { TIERS, TIER_CODES, PRODUCT, EXCLUSIONS, ELIGIBILITY_RULES, localiseTier, ipidText, wordingText } from '../catalog/products.js';
import { DRIVER_BANDS, BANDING_RULES, marketTable, BAND_CODES, cellKey } from '../catalog/pricing.js';
import { getMarket, listMarkets } from '../catalog/markets.js';
import { OPERATIONS } from '../api/operations.js';
import { COMMITMENTS, transparencyMetrics, legalStatements, VERSIONING } from '../services/company.js';
import { buildDocument, verifyDocSig, verifyQuoteDocSig } from '../services/policies.js';
import { statusJson } from '../server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = { '/assets/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/assets/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/assets/icon.svg': ['icon.svg', 'image/svg+xml'] };
export function staticAsset(p) {
  const a = ASSETS[p];
  return a ? { body: fs.readFileSync(path.join(here, 'assets', a[0])), type: a[1] } : null;
}

const NAV = [['/', 'Get a quote'], ['/products', 'Cover'], ['/pricing', 'Prices'], ['/transparency', 'Our numbers'], ['/developers', 'For agents & developers'], ['/account', 'My account']];

function layout({ title, description, page, body, jsonld = [], base, current }) {
  const ld = [{ '@context': 'https://schema.org', '@type': 'InsuranceAgency', name: config.company.name, legalName: config.company.legalName, url: base, email: config.company.supportEmail, description: config.company.tagline, areaServed: 'Worldwide', logo: `${base}/assets/icon.svg` }, ...jsonld];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/styles.css">
<link rel="alternate" type="text/markdown" title="Agent guide" href="/llms.txt">
<link rel="service-desc" type="application/json" href="/openapi.json">
<link rel="mcp" href="/mcp">
${ld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body data-page="${page}">
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap row">
<a class="brand" href="/"><img src="/assets/icon.svg" alt="" width="28" height="28"> ${esc(config.company.name)}</a>
<nav aria-label="Main">${NAV.map(([h, l]) => `<a href="${h}"${current === h ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
</div></header>
${config.env !== 'production' ? '<div class="banner">Sandbox: no real cover or payments. Codes and emails are visible via the sandbox tools.</div>' : ''}
<main id="main" class="wrap">${body}</main>
<footer class="wrap foot">
<p><strong>${esc(config.company.legalName)}</strong>. ${esc(config.company.regulator)}. <a href="/legal">Terms (AI agents welcome), AI use &amp; privacy</a> · <a href="/status">Status</a> · <a href="/llms.txt">llms.txt</a> · <a href="/openapi.json">OpenAPI</a> · <a href="/.well-known/agent-card.json">A2A</a> · <a href="/developers#mcp">MCP</a></p>
</footer>
<script src="/assets/app.js" defer></script>
</body></html>`;
}

const money = (amount, currency) => fmtMoney({ amount, currency });
const limitText = (s) => (typeof s.limit === 'object' ? Object.entries(s.limit).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'number' ? money(v, s.currency) : String(v).replace(/_/g, ' ')}`).join('; ') : typeof s.limit === 'number' ? money(s.limit, s.currency) : String(s.limit).replace(/_/g, ' '));

// ---------- pages ----------
function home(base, params) {
  const m = getMarket(params?.get('country') || 'IE') || getMarket('IE');
  const from = Math.min(...[...marketTable(m).values()].map((r) => r.total));
  const faq = [
    ['How do you price my car?', `Every car falls into one of ${CATEGORIES.length} categories and every driver into one of 4 bands. With 4 cover tiers that makes 192 prices, all published on our prices page. No hidden profiling.`],
    ['Can my AI assistant buy this for me?', 'Yes. Assistants like Claude, ChatGPT and Gemini can quote, buy and manage your policy through our MCP server and API. You always confirm purchases, cancellations and settlements yourself, on your own device.'],
    ['Are there any fees?', 'No. No fees for buying, paying monthly (0% interest), making changes or cancelling.'],
    ['Will my price go up just because I stay?', 'Never. At renewal you pay exactly what a new customer with the same car and record would pay.'],
    ['Which countries do you cover?', 'Every country except those under international sanctions (North Korea, Iran, Syria, Cuba).'],
    ['How do claims work?', 'Report it online, in the app or through your assistant and get a reference instantly. We tell you exactly what we need. Smaller claims are settled automatically the moment we have it; a person handles everything else.'],
  ];
  const body = `
<section class="hero">
  <h1>Fair car insurance for any car, anywhere.</h1>
  <p class="lede">Three questions, one honest price. From <strong>${money(from, m.currency)}</strong> a year in ${esc(m.name)}. No fees, no loyalty penalty, and your AI assistant can handle it all for you.</p>
</section>
<section class="card" id="quote" aria-labelledby="qh">
  <h2 id="qh">Get your price</h2>
  <form id="quote-form" class="grid" action="/v1/quotes" method="post">
    <label>Country <input name="country" value="${m.code}" required autocomplete="country" list="countries"></label>
    <datalist id="countries">${listMarkets().map((x) => `<option value="${x.code}">${esc(x.name)}</option>`).join('')}</datalist>
    <label>Number plate <small>(optional, fills the car for you)</small><input name="registration" placeholder="e.g. 241D12345"></label>
    <label>Make <input name="make" placeholder="Toyota" required></label>
    <label>Model <input name="model" placeholder="Corolla" required></label>
    <label>Year <input name="year" type="number" inputmode="numeric" placeholder="2021" required></label>
    <label>Value <small>(local currency, optional)</small><input name="value" type="number" inputmode="numeric" placeholder="22000"></label>
    <label>Your age <input name="age" type="number" inputmode="numeric" placeholder="38" required></label>
    <label>Years licensed <input name="years_licensed" type="number" inputmode="numeric" placeholder="15"></label>
    <label>At-fault claims in 5 years <input name="claims_last_5y" type="number" inputmode="numeric" value="0"></label>
    <button class="btn primary" type="submit">See my prices</button>
  </form>
  <div id="quote-result" aria-live="polite"></div>
</section>
<section class="grid3">
  ${COMMITMENTS.slice(0, 6).map((c) => `<div class="card small"><p>${esc(c)}</p></div>`).join('')}
</section>
<section class="card">
  <h2>Let your assistant do it</h2>
  <p>Tell Claude, ChatGPT, Gemini or any agent: <em>"Get me car insurance from ${esc(config.company.name)}."</em> They connect through our <a href="/developers#mcp">MCP server</a>, <a href="/openapi.json">API</a> or <a href="/.well-known/agent-card.json">A2A card</a>. You confirm on your own phone, and you can see and revoke what they did at any time.</p>
</section>
<section class="card"><h2>Questions</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>`;
  return {
    title: `${config.company.name} - fair car insurance for any car, anywhere`, description: 'Car insurance for any car in any country. One published price table, no fees, no loyalty penalty. AI agents welcome.', page: 'home', current: '/', body,
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: config.company.name, url: base, potentialAction: { '@type': 'QuoteAction', target: { '@type': 'EntryPoint', urlTemplate: `${base}/v1/quotes`, httpMethod: 'POST', contentType: 'application/json' } } },
    ],
  };
}

function products(base, params) {
  const m = getMarket(params.get('country') || 'IE') || getMarket('IE');
  const tiers = TIER_CODES.map((t) => localiseTier(t, m));
  const sections = [...new Set(tiers.flatMap((t) => Object.keys(t.sections)))];
  const body = `
<h1>What each cover includes</h1>
<p>Limits and excesses in ${esc(m.name)} (${m.currency}). <a href="?country=US">US</a> · <a href="?country=GB">UK</a> · <a href="?country=IN">India</a> · <a href="?country=DE">Germany</a>. Product ${esc(PRODUCT.name)} v${PRODUCT.version}, effective ${PRODUCT.effective_from}.</p>
<div class="scroll"><table>
<caption>Sections, limits and excesses by cover tier</caption>
<thead><tr><th scope="col">Section</th>${tiers.map((t) => `<th scope="col">${esc(t.name)}</th>`).join('')}</tr></thead>
<tbody>${sections.map((s) => `<tr><th scope="row">${esc(tiers.find((t) => t.sections[s]).sections[s].name)}</th>${tiers.map((t) => { const x = t.sections[s]; return `<td>${x ? `Limit: ${esc(limitText(x))}<br>Excess: ${money(x.excess, x.currency)}${x.days ? `<br>${x.days} days` : ''}${x.condition ? `<br><small>${esc(x.condition)}</small>` : ''}` : '<span class="no">Not included</span>'}</td>`; }).join('')}</tr>`).join('')}</tbody>
</table></div>
${tiers.map((t) => `<section class="card" id="${t.code}"><h2>${esc(t.name)}</h2><p>${esc(t.summary)}</p><p><a href="/documents/ipid/${t.code}?country=${m.code}">IPID (product information document)</a></p></section>`).join('')}
<section class="card" id="exclusions"><h2>What is never covered</h2><dl>${EXCLUSIONS.map((e) => `<dt id="${e.id}">${e.id} ${esc(e.title)}</dt><dd>${esc(e.text)}${e.exception ? ` <em>Exception: ${esc(e.exception)}</em>` : ''} <small>Applies to: ${e.applies_to.join(', ')}</small></dd>`).join('')}</dl></section>
<section class="card" id="eligibility"><h2>Who we can insure</h2><ul>${ELIGIBILITY_RULES.map((r) => `<li><strong>${r.id}</strong> ${esc(r.rule)} <small>(${r.outcome})</small></li>`).join('')}</ul>
<p>Who can drive: ${esc(PRODUCT.who_can_drive)} Use: ${esc(PRODUCT.use)} Territory: ${esc(PRODUCT.territory)}</p>
<p><a href="/documents/wording?country=${m.code}">Full policy wording (text)</a></p></section>`;
  const ld = tiers.map((t) => ({ '@context': 'https://schema.org', '@type': 'FinancialProduct', name: `${config.company.name} ${t.name}`, category: 'Car insurance', description: t.summary, provider: { '@type': 'InsuranceAgency', name: config.company.name }, url: `${base}/products#${t.code}`,
    offers: { '@type': 'AggregateOffer', priceCurrency: m.currency, lowPrice: Math.min(...[...marketTable(m).values()].filter((r) => r.tier === t.code).map((r) => r.total)), highPrice: Math.max(...[...marketTable(m).values()].filter((r) => r.tier === t.code).map((r) => r.total)), offerCount: 48 } }));
  return { title: `Cover tiers, limits and exclusions - ${config.company.name}`, description: 'Every section, limit, excess and exclusion for all four cover tiers, as plain text.', page: 'products', current: '/products', body, jsonld: ld };
}

function pricing(base, params) {
  const m = getMarket(params.get('country') || 'IE') || getMarket('IE');
  const t = marketTable(m);
  const body = `
<h1>Every price we charge</h1>
<p>${CATEGORIES.length} car categories × 4 driver bands × 4 cover tiers = <strong>192 prices</strong>. This is the whole pricing model. Showing <strong>${esc(m.name)}</strong> in ${m.currency}, annual total including ${esc(m.tax.name)} (${Math.round(m.tax.rate * 1000) / 10}%). Monthly = total ÷ 12 at 0% interest. Price level: ${m.price_index}.</p>
<form class="inline" method="get"><label>Country <input name="country" value="${m.code}" list="countries" size="6"></label><datalist id="countries">${listMarkets().map((x) => `<option value="${x.code}">${esc(x.name)}</option>`).join('')}</datalist><button class="btn">Show</button></form>
<h2>Driver bands</h2><ul>${Object.values(DRIVER_BANDS).map((b) => `<li><strong>${b.code} ${b.name}</strong>: ${esc(b.description)}</li>`).join('')}</ul>
<details><summary>How points work</summary><ul>${BANDING_RULES.map((r) => `<li>${esc(r.factor.replace(/_/g, ' '))}: ${esc(r.rule)}</li>`).join('')}</ul></details>
${TIER_CODES.map((tier) => `<h2>${esc(TIERS[tier].name)}</h2><div class="scroll"><table><caption>${esc(TIERS[tier].name)} annual prices in ${m.currency}</caption>
<thead><tr><th scope="col">Car category</th>${BAND_CODES.map((b) => `<th scope="col">Band ${b}</th>`).join('')}</tr></thead>
<tbody>${CATEGORIES.map((c) => `<tr><th scope="row">${esc(c.name)}<br><small>${esc(c.examples.slice(0, 2).join(', '))}</small></th>${BAND_CODES.map((b) => `<td>${money(t.get(cellKey(c.code, b, tier)).total, m.currency)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('')}
<p>Machine-readable: <a href="/v1/pricing/table?country=${m.code}">/v1/pricing/table?country=${m.code}</a></p>`;
  return { title: `All 192 car insurance prices in ${m.name} - ${config.company.name}`, description: `The complete ${config.company.name} price table for ${m.name}.`, page: 'pricing', current: '/pricing', body };
}

function developers(base) {
  const ops = OPERATIONS.filter((o) => !o.internal);
  const mcpCfg = JSON.stringify({ mcpServers: { fairkarl: { type: 'http', url: `${base}/mcp` } } }, null, 2);
  const stdioCfg = JSON.stringify({ mcpServers: { fairkarl: { command: 'npx', args: ['-y', 'fairkarl-mcp'], env: { FK_BASE_URL: base, FK_API_KEY: 'fk_agt_... (optional)' } } } }, null, 2);
  const body = `
<h1>Connect any agent in one minute</h1>
<p>Everything a person can do here, an agent can do too: quote, buy, change, renew, cancel, claim, complain and ask for a human. One registry powers every interface, so REST, MCP and A2A always agree.</p>
<section class="card" id="mcp"><h2>MCP (Claude, ChatGPT, Cursor, Copilot, Gemini CLI...)</h2>
<p>Remote server (Streamable HTTP): <code>${base}/mcp</code>. Public tools need no key.</p><pre><code>${esc(mcpCfg)}</code></pre>
<p>Local stdio bridge:</p><pre><code>${esc(stdioCfg)}</code></pre>
<p>Server card: <a href="/.well-known/mcp.json">/.well-known/mcp.json</a>. Includes resources (price tables, products, guide) and prompts (buy_car_insurance, make_a_claim, review_my_renewal).</p></section>
<section class="card"><h2>REST + OpenAPI</h2><p><a href="/openapi.json">/openapi.json</a> (OpenAPI 3.1). Base URL <code>${base}/v1</code>. Start with <a href="/v1/start">GET /v1/start</a>.</p>
<pre><code>curl -X POST ${base}/v1/quotes -H 'content-type: application/json' \\
  -d '{"country":"IE","vehicle":{"make":"Toyota","model":"Corolla","year":2021},"drivers":[{"age":38}]}'</code></pre></section>
<section class="card"><h2>A2A, UCP and other discovery</h2><ul>
<li><a href="/.well-known/agent-card.json">A2A agent card</a>, JSON-RPC endpoint <code>${base}/a2a</code> (send a DataPart <code>{"skill":"create_quote","input":{...}}</code>)</li>
<li><a href="/.well-known/ucp">UCP profile</a> · <a href="/.well-known/ai-plugin.json">ai-plugin.json</a> · <a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">llms-full.txt</a> · <a href="/robots.txt">robots.txt</a> (AI agents allowed)</li></ul></section>
<section class="card" id="auth"><h2>Identity, consent and limits</h2><ol>
<li><strong>Anonymous</strong>: catalogue, prices, eligibility, quotes, coverage checks, starting a purchase.</li>
<li><strong>Agent key</strong>: <code>POST /v1/agents</code> (tool <code>register_agent</code>) returns a key instantly. Optional request signing: header <code>FK-Agent-Signature: t=&lt;unix&gt;,v1=HMAC_SHA256(signing_secret, "&lt;t&gt;.&lt;METHOD&gt;.&lt;path&gt;.&lt;body&gt;")</code> marks you as a verified agent.</li>
<li id="consent"><strong>Customer mandate</strong>: <code>request_mandate</code> (or OAuth 2.0 device flow at <code>/oauth/device_authorization</code> with <code>login_hint</code>). The customer approves scopes (${['read', 'quote', 'bind', 'adjust', 'renew', 'cancel', 'claim', 'complaint'].join(', ')}), an optional premium cap and pre-authorised actions on their own device. Revocable instantly; every action shows in their activity log.</li>
<li><strong>Human checkpoints</strong>: buying (unless pre-authorised within the cap), cancelling and accepting a settlement are always confirmed by the policyholder. You get a <code>confirmation</code>; poll <code>get_confirmation</code> or wait for the <code>confirmation.decided</code> webhook. Never guess the code.</li></ol></section>
<section class="card"><h2>Webhooks</h2><p>Set <code>webhook_url</code>. Events: policy.bound, policy.adjusted, policy.cancelled, policy.renewal_offered, policy.expired, policy.lapsed, payment.failed, claim.created, claim.updated, complaint.*, case.*, confirmation.decided. Header <code>FK-Signature: t=..,v1=HMAC_SHA256(webhook_secret, "t.body")</code>. Or poll <code>GET /v1/events?since=</code>.</p></section>
<section class="card"><h2>Errors, retries, limits, versions</h2><ul>
<li>Errors are RFC 9457 <code>application/problem+json</code> with <code>errors[].field</code>, <code>errors[].fix</code>, <code>retryable</code> and often <code>next_actions</code>.</li>
<li>Every POST accepts <code>Idempotency-Key</code> (MCP: <code>idempotency_key</code>): a repeat returns the original result, never a second policy or payment.</li>
<li>Rate limits per minute: anonymous ${config.rateLimits.anonymous}, agents ${config.rateLimits.agent}. Headers <code>RateLimit-Limit/Remaining/Reset</code>, <code>Retry-After</code> on 429. Quotes typically return in under 50 ms.</li>
<li>Versioning: ${esc(VERSIONING.policy)}</li></ul></section>
<section class="card"><h2>Sandbox</h2><p>This environment is a free self-serve sandbox. Personas: <a href="/v1/sandbox/personas">/v1/sandbox/personas</a>. Card token <code>tok_visa</code> succeeds, <code>tok_card_fail</code> fails. Read the customer's emails (codes, documents) with <code>sandbox_outbox</code>. Move time with <code>sandbox_advance_clock</code> to test renewals and instalments.</p></section>
<section class="card"><h2>All ${ops.length} tools / endpoints</h2><div class="scroll"><table><thead><tr><th>Tool</th><th>HTTP</th><th>What it does</th><th>Auth</th></tr></thead><tbody>
${ops.map((o) => `<tr><td><code>${o.name}</code></td><td><code>${o.method} ${o.path}</code></td><td>${esc(o.summary)}</td><td>${o.auth}${o.scope ? ` (${o.scope})` : ''}</td></tr>`).join('')}</tbody></table></div></section>`;
  return { title: `Developers & AI agents - ${config.company.name}`, description: 'MCP, OpenAPI, A2A and UCP interfaces for car insurance. Self-serve sandbox.', page: 'developers', current: '/developers', body };
}

function transparency() {
  const t = transparencyMetrics();
  const row = (k, v) => `<tr><th scope="row">${esc(k)}</th><td>${v == null ? '<em>Not enough data yet</em>' : esc(String(v))}</td></tr>`;
  const body = `<h1>Our numbers, live</h1><p>${esc(t.method)} Generated ${esc(t.generated_at)}. JSON: <a href="/v1/transparency">/v1/transparency</a>.</p>
<table><tbody>${row('Active policies', t.policies.active)}${row('Claims reported', t.claims.reported)}${row('Claims acceptance rate (%)', t.claims.acceptance_rate)}${row('Average days from report to payment', t.claims.average_days_report_to_payment)}${row('Claims settled automatically (%)', t.claims.fast_track_share)}${row('Complaints received', t.complaints.received)}${row('Complaints upheld (%)', t.complaints.upheld_rate)}${row('Average first human response (minutes)', t.human_support.average_first_response_minutes)}</tbody></table>
<h2>Our service targets</h2><ul>${Object.entries(t.targets).map(([k, v]) => `<li>${esc(k.replace(/_/g, ' '))}: ${esc(v)}</li>`).join('')}</ul>
<h2>Financial strength</h2><p>${esc(t.financial_strength.rating)}</p><h2>Independent reviews</h2><p>${esc(t.independent_reviews.status)}</p>`;
  return { title: `Live claims and complaints figures - ${config.company.name}`, description: 'Claims acceptance, settlement times and complaints, computed live.', page: 'transparency', current: '/transparency', body };
}

function legal(base) {
  const l = legalStatements(base);
  const sect = (title, o) => `<section class="card"><h2>${esc(title)}</h2>${Object.entries(o).map(([k, v]) => `<h3>${esc(k.replace(/_/g, ' '))}</h3>${Array.isArray(v) ? `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : typeof v === 'object' ? `<ul>${Object.entries(v).map(([a, b]) => `<li>${esc(a.replace(/_/g, ' '))}: ${esc(b)}</li>`).join('')}</ul>` : `<p>${esc(v)}</p>`}`).join('')}</section>`;
  const body = `<h1>Terms, AI use and privacy</h1>${sect('Terms of use (AI agents welcome)', l.terms_of_use)}${sect('How we use AI', l.ai_use_statement)}${sect('Privacy', l.privacy)}${sect('Extra support', l.vulnerability_and_support)}${sect('Consumer protection', l.consumer_protection)}<section class="card"><h2>Accessibility</h2><p>${esc(l.accessibility)}</p></section>`;
  return { title: `Terms, AI use & privacy - ${config.company.name}`, description: 'Agent access permitted. How we use AI, your data and your rights.', page: 'legal', current: '/legal', body };
}

function statusPage() {
  const s = statusJson();
  const body = `<h1>System status: ${esc(s.status)}</h1><p>Availability target ${esc(s.sla.availability_target)}. Uptime ${s.uptime_seconds}s. Average latency ${s.live.average_latency_ms} ms.</p><ul>${s.components.map((c) => `<li>${esc(c.name)}: <strong>${esc(c.status)}</strong></li>`).join('')}</ul><h2>Incidents in the last 90 days</h2><p>${s.incidents_last_90_days.length ? '' : 'None.'}</p><p>JSON: <a href="/v1/status">/v1/status</a></p>`;
  return { title: `Status - ${config.company.name}`, description: 'Live system status and incident history.', page: 'status', current: '', body };
}

const shell = (page, title, h1, inner) => ({ title: `${title} - ${config.company.name}`, description: title, page, current: page === 'account' ? '/account' : '', body: `<h1>${h1}</h1><noscript><p>This page needs JavaScript. Everything here is also available through our API.</p></noscript>${inner}` });

export function renderPage(p, params, ctx) {
  const base = ctx.baseUrl;
  let r;
  if (p === '/') r = home(base, params);
  else if (p === '/products') r = products(base, params);
  else if (p === '/pricing') r = pricing(base, params);
  else if (p === '/developers') r = developers(base);
  else if (p === '/transparency') r = transparency();
  else if (p === '/legal') r = legal(base);
  else if (p === '/status') r = statusPage();
  else if (p.startsWith('/confirm/')) r = shell('confirm', 'Please confirm', 'Please confirm', `<div id="confirm-app" data-id="${esc(p.split('/')[2])}"></div>`);
  else if (p === '/account') r = shell('account', 'My account', 'My account', '<div id="account-app"></div>');
  else if (p === '/staff') r = shell('staff', 'Staff console', 'Staff console', '<div id="staff-app"></div>');
  else return null;
  return { body: layout({ ...r, base }) };
}

// ---------- documents (printable HTML) ----------
function docHtml(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="/assets/styles.css"></head><body class="doc"><main class="wrap"><p class="noprint"><button onclick="print()" class="btn">Print / save as PDF</button></p>${inner}<footer class="foot"><p>${esc(config.company.legalName)} · ${esc(config.company.regulator)}</p></footer></main></body></html>`;
}
const pre = (t) => `<pre class="wording">${esc(t)}</pre>`;
function kv(o, depth = 0) {
  if (o == null) return '';
  if (Array.isArray(o)) return `<ul>${o.map((x) => `<li>${typeof x === 'object' ? kv(x, depth + 1) : esc(x)}</li>`).join('')}</ul>`;
  if (typeof o !== 'object') return esc(o);
  return `<dl class="kv">${Object.entries(o).filter(([k, v]) => v != null && k !== 'title' && k !== 'raw_input').map(([k, v]) => `<dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${typeof v === 'object' ? kv(v, depth + 1) : esc(v)}</dd>`).join('')}</dl>`;
}

export function renderDocument(p, params, ctx) {
  const parts = p.split('/').filter(Boolean); // documents, ...
  const nf = { status: 404, body: docHtml('Not found', '<h1>Document not found</h1>') };
  if (parts[1] === 'ipid' && TIERS[parts[2]]) { const m = getMarket(params.get('country') || 'IE') || getMarket('IE'); return { status: 200, body: docHtml('IPID', `<h1>Insurance Product Information Document</h1>${pre(ipidText(parts[2], m))}`) }; }
  if (parts[1] === 'wording') { const m = getMarket(params.get('country') || 'IE') || getMarket('IE'); return { status: 200, body: docHtml('Policy wording', `<h1>Policy wording</h1>${pre(wordingText(m))}`) }; }
  if (parts[1] === 'quote' && parts[3] === 'demands_and_needs') {
    if (!verifyQuoteDocSig(parts[2], params.get('sig'))) return nf;
    const q = store.quotes.get(parts[2]);
    return q ? { status: 200, body: docHtml('Demands and needs', `<h1>Demands-and-needs statement</h1><p>${esc(q.demands_and_needs?.statement)}</p>${kv(q.demands_and_needs)}`) } : nf;
  }
  if (parts[1] === 'policy') {
    const [, , pid, doc] = parts;
    if (!verifyDocSig(pid, doc, params.get('sig'))) return nf;
    const pol = store.policies.get(pid);
    if (!pol) return nf;
    const d = buildDocument(pol, doc);
    return { status: 200, body: docHtml(d.title, `<h1>${esc(d.title)}</h1>${d.text ? pre(d.text) : kv(d)}`) };
  }
  return nf;
}
