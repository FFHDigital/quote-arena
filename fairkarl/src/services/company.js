// Company facts, published commitments, live transparency metrics, legal statements and sandbox personas.
import { store } from '../db.js';
import { config, isSandbox } from '../config.js';
import { daysBetween, nowIso } from '../util.js';
import { CATEGORIES } from '../catalog/categories.js';
import { TIERS } from '../catalog/products.js';
import { DRIVER_BANDS } from '../catalog/pricing.js';

export function companyInfo(baseUrl) {
  return {
    name: config.company.name, legal_name: config.company.legalName, tagline: config.company.tagline, environment: config.env, api_version: config.apiVersion,
    regulator: config.company.regulator, support_email: config.company.supportEmail,
    what_we_sell: 'Annual private car insurance for any car in any country (except sanctioned countries), in four cover tiers.',
    how_pricing_works: `Every car falls into one of ${CATEGORIES.length} categories, every driver into one of ${Object.keys(DRIVER_BANDS).length} bands, and there are ${Object.keys(TIERS).length} cover tiers: ${CATEGORIES.length * 4 * 4} prices in total, published in full. A country only changes the currency, local price level and tax. No hidden profiling, no loyalty penalty, no fees, 0% interest monthly payments.`,
    quick_start_for_agents: [
      '1. create_quote with country, vehicle {make, model, year} and drivers [{age}] - you get a firm price for all 4 tiers in one call.',
      '2. requote to try variations (tier, drivers, car) - instant, no restart.',
      '3. bind_policy with quote_id and policyholder {name, email} - the customer confirms on their own device (code by email).',
      '4. get_confirmation until approved - you get the policy, documents and (if they allowed it) a mandate token to service the policy.',
      '5. Service with the mandate token: get_policy, create_claim, quote_adjustment, get_renewal_offer, quote_cancellation, create_complaint, request_human.',
    ],
    authentication: { anonymous: 'Catalogue, pricing, eligibility, quotes and coverage checks need no key.', agent_key: 'POST /v1/agents (register_agent) returns a key instantly.', mandate: 'request_mandate: the customer approves scoped, time-limited, revocable access on their own device.', customer: 'start_login + verify_login (email code).' },
    interfaces: {
      rest: `${baseUrl}/v1`, openapi: `${baseUrl}/openapi.json`, mcp_streamable_http: `${baseUrl}/mcp`, mcp_stdio: 'npx fairkarl-mcp (set FK_BASE_URL)', a2a_agent_card: `${baseUrl}/.well-known/agent-card.json`,
      a2a_endpoint: `${baseUrl}/a2a`, llms_txt: `${baseUrl}/llms.txt`, ucp_profile: `${baseUrl}/.well-known/ucp`, status: `${baseUrl}/status`, docs: `${baseUrl}/developers`,
    },
    commitments: COMMITMENTS,
    versioning: VERSIONING,
  };
}

export const COMMITMENTS = [
  'Firm quotes: the quoted price is the price you pay for 30 days.',
  'Same price for new and existing customers at renewal. No price walking.',
  'No fees for anything: buying, paying monthly (0% APR), changing or cancelling.',
  'Never auto-renew without your opt-in. Renewal price shown 30 days ahead, with reasons.',
  'Claims under the fast-track limit decided automatically the moment evidence is complete; every automated decline can be reviewed by a person.',
  'Every action by an agent is logged and visible to the customer; access can be revoked instantly.',
  'Legal documents always go directly to the policyholder, not just their agent.',
];

export const VERSIONING = {
  current: 'v1', api_version_header: 'FK-API-Version', current_api_version: config.apiVersion,
  policy: 'Additive changes ship any time. Breaking changes only in a new major version (/v2). Deprecated versions keep working for at least 12 months after notice, with a Sunset header and an email to registered agents.',
  minimum_notice_months: 12,
  changelog: [{ version: '2026-10-01', changes: ['Initial release of v1 REST, MCP and A2A interfaces.'] }],
  deprecations: [],
};

export function transparencyMetrics() {
  const claims = store.claims.find({}, { limit: 1e6 });
  const decided = claims.filter((c) => c.decision);
  const accepted = decided.filter((c) => c.decision.outcome === 'offer');
  const paid = claims.filter((c) => c.payment);
  const days = paid.map((c) => daysBetween(c.created_at, c.payment.at));
  const complaints = store.complaints.find({}, { limit: 1e6 });
  const finals = complaints.filter((c) => c.outcome);
  const cases = store.cases.find({}, { limit: 1e6 }).filter((k) => k.first_response_at);
  const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return {
    generated_at: nowIso(), method: 'Computed live from our production records every time you call this endpoint. No sampling, no rounding up.', environment: config.env,
    policies: { active: store.policies.count({ status: 'active' }), total_ever: store.policies.count() },
    claims: {
      reported: claims.length, decided: decided.length, acceptance_rate: decided.length ? Math.round((accepted.length / decided.length) * 1000) / 10 : null,
      paid: paid.length, average_days_report_to_payment: avg(days), fast_track_share: claims.length ? Math.round((claims.filter((c) => c.owner?.type === 'automated' && c.offer).length / claims.length) * 1000) / 10 : null,
      decline_reasons: Object.entries(decided.filter((c) => c.decision.outcome === 'declined').reduce((m, c) => { const k = c.coverage?.exclusions_triggered?.[0]?.id || 'not_in_tier_or_period'; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([reason, count]) => ({ reason, count })),
    },
    complaints: { received: complaints.length, final_responses: finals.length, upheld_rate: finals.length ? Math.round((finals.filter((c) => c.outcome.upheld).length / finals.length) * 1000) / 10 : null, ombudsman_referrals: 'Published quarterly from ombudsman decisions.' },
    human_support: { cases_answered: cases.length, average_first_response_minutes: avg(cases.map((k) => (new Date(k.first_response_at) - new Date(k.created_at)) / 60000)) },
    targets: { claim_acknowledgement: 'instant', fast_track_decision: 'instant once evidence complete', human_claim_decision: '3 business days', settlement_payment: '2 business days after acceptance', complaint_final_response: '40 business days (target 10)' },
    financial_strength: { rating: 'Not yet rated: new insurer. We will publish our AM Best / S&P rating and Solvency II SFCR here as soon as they exist.', sfcr_url: null, solvency_ratio: null },
    independent_reviews: { status: 'Collecting. We will link independent, verified-purchase reviews once we have at least 100.', sources: [] },
  };
}

export function legalStatements(baseUrl) {
  return {
    terms_of_use: {
      automated_access: 'PERMITTED. AI agents, assistants and automated tools are welcome to discover, quote, buy and service policies through our website, REST API, MCP server and A2A endpoint, on behalf of a customer who has asked them to. Please identify your agent (register_agent) and stay within published rate limits. No CAPTCHA walls for registered agents.',
      robots: `${baseUrl}/robots.txt allows reputable AI crawlers and agents.`,
      prohibited: 'Scraping personal data of other customers, testing stolen payment details, impersonating a customer without their mandate, or attempting to overload our systems.',
    },
    ai_use_statement: {
      where_ai_is_used: ['Vehicle categorisation (deterministic published rules; optionally AI-assisted for unusual cars)', 'Coverage checks against structured policy terms', 'Claims triage and fast-track settlement under the published limit', 'Drafting plain-language explanations'],
      where_ai_is_not_used: ['Setting prices: prices come from a published 192-cell table, not individual profiling', 'Final decisions on declined claims if you ask for review', 'Complaint outcomes'],
      human_review: 'You can ask for a person to review any automated decision at any time: request_human (POST /v1/cases) or email. We respond within the published times.',
      eu_ai_act: 'Motor insurance pricing is not a high-risk use under the EU AI Act. We keep logs, human oversight and explanations for every automated decision regardless.',
    },
    privacy: {
      controller: config.company.legalName, data_we_need_for_a_quote: ['country', 'car make, model and year', 'driver age (or date of birth), years licensed, claims and convictions in the last 5 years'],
      data_we_do_not_need: ['gender', 'occupation', 'credit score', 'browsing history', 'social media', 'postcode-level location'],
      agent_supplied_data: 'Data an agent sends is used only to quote, sell and service the policy for the customer it acts for. It is never used to train models or sold.',
      retention: { quotes_not_bought: '90 days', policies_and_claims: '7 years after the policy ends (legal requirement)', audit_logs: '7 years', evidence_files: '7 years after claim closes' },
      rights: 'Access, correction, deletion (where the law allows) and portability: ask via your account, your agent or email.',
    },
    vulnerability_and_support: {
      how_to_tell_us: 'Pass "vulnerability": {"flag": true, "needs": "e.g. bereavement, illness, financial difficulty, prefers phone calls"} on a quote, claim or case, or tell any staff member.',
      what_we_do: 'Your case is prioritised, a person handles it rather than automation, we adapt how we communicate, and we never close anything for missing a deadline without speaking to you first.',
    },
    consumer_protection: {
      demands_and_needs: 'Every quote includes a demands-and-needs statement, also sent directly to the policyholder at purchase.',
      fair_design: 'No pre-ticked add-ons, no drip pricing, no countdown timers, no fees. The cheapest suitable option is always shown alongside the others.',
      cooling_off: `${config.coolingOffDays} days`,
      complaints: 'Lodge any way you like (create_complaint). Acknowledged instantly, update every 20 business days, final response within 40 business days, then the ombudsman for your country.',
    },
    accessibility: 'Our website meets WCAG 2.2 AA. Every document is available as accessible HTML text and as structured data.',
  };
}

export function sandboxPersonas() {
  return {
    note: isSandbox() ? 'Sandbox personas: use them as-is with create_quote. Card tokens: any value works; tokens containing "fail" are declined.' : 'Personas are only available in the sandbox.',
    payment_tokens: { success: 'tok_visa', declined: 'tok_card_fail' },
    registrations: ['IE 241D12345 (Toyota Corolla 2024)', 'IE 191D5555 (VW Golf 2019)', 'GB AB12CDE (Ford Fiesta 2012)', 'US 7ABC123 (Tesla Model 3 2023)'],
    personas: [
      { id: 'A', description: 'Experienced driver, family car, Dublin', quote: { country: 'IE', vehicle: { make: 'Skoda', model: 'Octavia', year: 2020, value: 18000, body_type: 'estate' }, drivers: [{ age: 45, years_licensed: 25, claims_last_5y: 0 }] } },
      { id: 'B', description: 'New young driver, city car, London', quote: { country: 'GB', vehicle: { make: 'Toyota', model: 'Aygo', year: 2018, value: 6000 }, drivers: [{ age: 19, years_licensed: 1 }] } },
      { id: 'C', description: 'EV owner with one claim, California', quote: { country: 'US', vehicle: { make: 'Tesla', model: 'Model 3', year: 2023, value: 32000 }, drivers: [{ age: 33, years_licensed: 12, claims_last_5y: 1 }] } },
      { id: 'D', description: 'Two drivers, large SUV, Germany', quote: { country: 'DE', vehicle: { make: 'Volvo', model: 'XC90', year: 2022, value: 55000, body_type: 'suv' }, drivers: [{ age: 50, years_licensed: 30 }, { age: 22, years_licensed: 3, name: 'Jonas' }] } },
      { id: 'E', description: 'Classic car, India', quote: { country: 'IN', vehicle: { make: 'Mercedes-Benz', model: 'W123', year: 1982, value: 900000, annual_km: 3000 }, drivers: [{ age: 60, years_licensed: 40 }] } },
      { id: 'F', description: 'Declined: ride-hailing use', quote: { country: 'IE', vehicle: { make: 'Toyota', model: 'Prius', year: 2019, use: 'rideshare' }, drivers: [{ age: 40, years_licensed: 20 }] } },
    ],
  };
}
