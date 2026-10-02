// Model Context Protocol server (JSON-RPC 2.0). Served over Streamable HTTP at /mcp and over
// stdio by bin/mcp-stdio.js. Tools are generated from the operation registry.
import { OPERATIONS, OPS_BY_NAME, runOperation } from './operations.js';
import { config, isSandbox } from '../config.js';
import { ApiError } from '../util.js';
import { localiseTier, TIER_CODES, PRODUCT, EXCLUSIONS } from '../catalog/products.js';
import { getMarket } from '../catalog/markets.js';
import { marketTable } from '../catalog/pricing.js';
import { legalStatements, companyInfo } from '../services/company.js';
import { llmsTxt } from './wellknown.js';

export const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const clean = (s) => JSON.parse(JSON.stringify(s, (k, v) => (k === 'x-lenient' || k === 'examples' ? undefined : v)));

export function toolList(actor) {
  return OPERATIONS.filter((o) => (!o.internal || actor?.type === 'staff') && (!o.sandboxOnly || isSandbox())).map((o) => ({
    name: o.name,
    title: o.summary,
    description: `${o.summary}. ${o.description}${o.auth === 'public' ? ' (No key needed.)' : o.auth === 'agent' ? ' (Needs an agent key.)' : o.auth === 'user' ? ` (Needs a mandate token or customer login${o.scope ? `; scope "${o.scope}"` : ''}.)` : ' (Staff only.)'}`,
    inputSchema: clean(o.input),
    annotations: { title: o.summary, readOnlyHint: !!o.readOnly, destructiveHint: !!o.destructive, idempotentHint: !!(o.readOnly || o.idempotent), openWorldHint: false },
  }));
}

const RESOURCES = [
  { uri: 'fairkarl://guide', name: 'guide', title: 'How to use FairKarl (for agents)', mimeType: 'text/markdown', description: 'Read first: the quote -> bind -> confirm -> service flow.' },
  { uri: 'fairkarl://products', name: 'products', title: 'Cover tiers, limits, excesses, exclusions', mimeType: 'application/json', description: 'Structured product data in EUR (Ireland).' },
  { uri: 'fairkarl://legal', name: 'legal', title: 'Terms, AI use, privacy, vulnerability', mimeType: 'application/json' },
  { uri: 'fairkarl://company', name: 'company', title: 'Company, commitments, interfaces', mimeType: 'application/json' },
];
const TEMPLATES = [
  { uriTemplate: 'fairkarl://price-table/{country}', name: 'price-table', title: 'All 192 prices for a country', mimeType: 'application/json' },
  { uriTemplate: 'fairkarl://products/{country}', name: 'products-local', title: 'Cover tiers in local currency', mimeType: 'application/json' },
];

function readResource(uri, baseUrl) {
  const json = (o) => ({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(o, null, 2) }] });
  if (uri === 'fairkarl://guide') return { contents: [{ uri, mimeType: 'text/markdown', text: llmsTxt(baseUrl) }] };
  if (uri === 'fairkarl://legal') return json(legalStatements(baseUrl));
  if (uri === 'fairkarl://company') return json(companyInfo(baseUrl));
  let m = uri.match(/^fairkarl:\/\/products(?:\/(\w+))?$/);
  if (m) { const mk = getMarket(m[1] || 'IE'); return json({ product: PRODUCT, tiers: TIER_CODES.map((t) => localiseTier(t, mk)), exclusions: EXCLUSIONS }); }
  m = uri.match(/^fairkarl:\/\/price-table\/(\w+)$/);
  if (m) { const mk = getMarket(m[1]); return json({ market: mk.code, currency: mk.currency, rows: [...marketTable(mk).values()] }); }
  throw new ApiError(404, 'not_found', `Unknown resource ${uri}`);
}

const PROMPTS = [
  { name: 'buy_car_insurance', title: 'Get the customer insured', description: 'Guided flow: gather the minimum details, quote all tiers, recommend, bind with confirmation.', arguments: [{ name: 'country', required: false }, { name: 'car', required: false }] },
  { name: 'make_a_claim', title: 'Report and follow a claim', description: 'Guided FNOL: check cover, lodge, upload evidence, follow to payment.', arguments: [{ name: 'what_happened', required: false }] },
  { name: 'review_my_renewal', title: 'Check a renewal is fair', description: 'Compare the renewal to last year and to alternatives, then accept, change or cancel.', arguments: [{ name: 'policy_id', required: false }] },
];
function getPrompt(name, args = {}) {
  const t = {
    buy_car_insurance: `Help me insure my car${args.car ? ` (${args.car})` : ''}${args.country ? ` in ${args.country}` : ''} with FairKarl.
1. Ask only for what is missing: country, car make/model/year (or number plate), and each driver's age, years licensed and at-fault claims in 5 years.
2. Call create_quote. Show all 4 tiers from "alternatives" with price, excess and what each adds, and the recommended tier from demands_and_needs.
3. Use requote for any what-if. Use check_coverage for specific "am I covered if" questions.
4. When I choose, call bind_policy with my name and email. Tell me to check my email for the confirmation link/code. Poll get_confirmation.
5. When approved, give me the policy number and document links.`,
    make_a_claim: `Help me make a car insurance claim${args.what_happened ? `: ${args.what_happened}` : ''}.
1. If anyone is hurt or in danger, tell me to call emergency services first.
2. Call get_claims_guide, then check_coverage with my policy_id to tell me if it is covered and my excess.
3. Call create_claim. Read back the claim number and the evidence still needed.
4. Help me upload each item with add_claim_evidence. Follow get_claim until there is an offer, then explain it and let me accept or dispute (respond_settlement).`,
    review_my_renewal: `Review my renewal${args.policy_id ? ` for ${args.policy_id}` : ''}: call get_renewal_offer, explain each reason for the change, show cheaper tiers from alternatives, then help me accept_renewal, change cover (quote_adjustment) or let it lapse.`,
  }[name];
  if (!t) throw new ApiError(404, 'not_found', `Unknown prompt ${name}`);
  return { description: PROMPTS.find((p) => p.name === name).description, messages: [{ role: 'user', content: { type: 'text', text: t } }] };
}

/** Handle one JSON-RPC message. Returns a response object, or null for notifications. */
export async function handleMcpMessage(msg, ctx) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message, data) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message, ...(data ? { data } : {}) } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid Request');
  const isNotification = msg.id === undefined;
  try {
    switch (msg.method) {
      case 'initialize': {
        const v = SUPPORTED_VERSIONS.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : SUPPORTED_VERSIONS[0];
        return reply({
          protocolVersion: v,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false }, logging: {} },
          serverInfo: { name: 'fairkarl', title: `${config.company.name} Car Insurance`, version: config.apiVersion, websiteUrl: ctx.baseUrl },
          instructions: `${config.company.name}: car insurance for any car in any country. Start with get_started. Flow: create_quote (country, vehicle make/model/year, drivers[].age) -> requote for what-ifs -> bind_policy (customer confirms by email code) -> get_confirmation -> service with the mandate token you receive. Public tools need no key; register_agent gives a key instantly. Every error includes a "fix". Never invent a confirmation code: only the customer has it.`,
        });
      }
      case 'notifications/initialized': case 'notifications/cancelled': case 'notifications/roots/list_changed': return null;
      case 'ping': return reply({});
      case 'logging/setLevel': return reply({});
      case 'tools/list': return reply({ tools: toolList(ctx.actor) });
      case 'tools/call': {
        const op = OPS_BY_NAME[msg.params?.name];
        if (!op || (op.internal && ctx.actor.type !== 'staff')) return fail(-32602, `Unknown tool: ${msg.params?.name}. Call tools/list.`);
        try {
          const result = await runOperation(op, msg.params.arguments || {}, ctx);
          return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result, isError: false });
        } catch (e) {
          const err = e instanceof ApiError ? e.toJSON() : { status: 500, code: 'internal_error', detail: 'Something went wrong on our side. It is safe to retry.', retryable: true };
          if (!(e instanceof ApiError)) console.error(e);
          return reply({ content: [{ type: 'text', text: JSON.stringify(err, null, 2) }], structuredContent: { error: err }, isError: true });
        }
      }
      case 'resources/list': return reply({ resources: RESOURCES });
      case 'resources/templates/list': return reply({ resourceTemplates: TEMPLATES });
      case 'resources/read': return reply(readResource(msg.params?.uri, ctx.baseUrl));
      case 'prompts/list': return reply({ prompts: PROMPTS });
      case 'prompts/get': return reply(getPrompt(msg.params?.name, msg.params?.arguments));
      case 'completion/complete': return reply({ completion: { values: [], hasMore: false } });
      default: return isNotification ? null : fail(-32601, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    return fail(e instanceof ApiError ? -32602 : -32603, e.message);
  }
}
