// Discovery files: llms.txt, robots.txt, A2A agent card, MCP server card, UCP profile,
// OAuth metadata, ai-plugin manifest, security.txt. All generated from the same registry.
import { OPERATIONS } from './operations.js';
import { config } from '../config.js';
import { CATEGORIES } from '../catalog/categories.js';
import { TIERS } from '../catalog/products.js';
import { COMMITMENTS } from '../services/company.js';

const publicOps = () => OPERATIONS.filter((o) => !o.internal);

export function llmsTxt(base) {
  const ops = publicOps();
  return `# ${config.company.name}

> ${config.company.tagline} Car insurance for any car in any country, sold and serviced entirely by API, MCP or A2A. AI agents are explicitly welcome.

${config.company.name} prices every car with ONE published table: ${CATEGORIES.length} vehicle categories x 4 driver bands x 4 cover tiers = 192 prices. A country only changes currency, local price level and tax. Quotes are firm for 30 days, itemised, with no fees and 0% APR monthly payments.

## Fastest path for an agent

1. \`create_quote\` (POST ${base}/v1/quotes) - needs only: country, vehicle {make, model, year}, drivers [{age}]. No key needed. Returns all 4 tiers.
2. \`requote\` - change anything, instant new firm price.
3. \`bind_policy\` - quote_id + policyholder {name, email}. The customer confirms on their own device (email link + 6-digit code). Poll \`get_confirmation\`.
4. On approval you get the policy, documents and (if allowed) a mandate token: send it as \`Authorization: Bearer fk_mdt_...\` to service the policy.
5. Servicing: \`get_policy\`, \`get_policy_documents\`, \`create_claim\`, \`add_claim_evidence\`, \`quote_adjustment\`, \`get_renewal_offer\`, \`quote_cancellation\`, \`create_complaint\`, \`request_human\`.

Example create_quote body:
\`\`\`json
{"country":"IE","vehicle":{"make":"Toyota","model":"Corolla","year":2021,"value":22000},"drivers":[{"age":38,"years_licensed":15}]}
\`\`\`

## Interfaces

- [MCP server (Streamable HTTP)](${base}/mcp): all tools below. stdio: \`npx fairkarl-mcp\` with FK_BASE_URL=${base}
- [OpenAPI 3.1](${base}/openapi.json)
- [A2A agent card](${base}/.well-known/agent-card.json) and endpoint ${base}/a2a
- [UCP profile](${base}/.well-known/ucp)
- [OAuth 2.0 device flow for customer consent](${base}/.well-known/oauth-authorization-server)
- [Developer guide](${base}/developers)
- [Status](${base}/status)

## Rules agents should know

- Never invent a confirmation code. Only the customer receives it.
- Legal documents (IPID, demands-and-needs) are always also sent to the policyholder directly.
- Errors are RFC 9457 JSON with a \`fix\` for each field. 429 responses include Retry-After.
- Every POST accepts \`Idempotency-Key\` (or \`idempotency_key\` in MCP arguments).
- Sandbox: payment token \`tok_visa\` succeeds, \`tok_card_fail\` fails; \`sandbox_outbox\` shows the customer's emails.

## Cover tiers

${Object.values(TIERS).map((t) => `- **${t.name}** (\`${t.code}\`): ${t.summary}`).join('\n')}

## Vehicle categories

${CATEGORIES.map((c) => `- \`${c.code}\` ${c.name}: ${c.examples.slice(0, 3).join(', ')}`).join('\n')}

## Our commitments

${COMMITMENTS.map((c) => `- ${c}`).join('\n')}

## All tools

${ops.map((o) => `- \`${o.name}\` (${o.method} ${o.path}): ${o.summary}`).join('\n')}

## Pages

- [Products and cover](${base}/products)
- [Full price table](${base}/pricing)
- [Transparency: live claims and complaints figures](${base}/transparency)
- [Legal: terms (agents welcome), AI use, privacy](${base}/legal)
`;
}

export const robotsTxt = (base) => `# ${config.company.name} welcomes AI agents and crawlers.
User-agent: *
Allow: /
Disallow: /account
Disallow: /confirm/
Disallow: /staff

User-agent: GPTBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: Claude-SearchBot
Allow: /
User-agent: anthropic-ai
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Perplexity-User
Allow: /
User-agent: Applebot-Extended
Allow: /
User-agent: Amazonbot
Allow: /
User-agent: meta-externalagent
Allow: /
User-agent: CCBot
Allow: /

Sitemap: ${base}/sitemap.xml
# Agent guide: ${base}/llms.txt
`;

export const sitemap = (base) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', '/products', '/pricing', '/developers', '/transparency', '/legal', '/status', '/llms.txt', '/llms-full.txt', '/openapi.json'].map((p) => `  <url><loc>${base}${p}</loc></url>`).join('\n')}
</urlset>`;

export function agentCard(base) {
  return {
    protocolVersion: '0.3.0',
    name: `${config.company.name} Car Insurance`,
    description: `${config.company.tagline} Quote, buy, service, claim, renew and cancel car insurance for any car in any country. Send a DataPart {"skill": "<tool name>", "input": {...}} - skills are identical to our MCP tools.`,
    url: `${base}/a2a`, preferredTransport: 'JSONRPC',
    additionalInterfaces: [{ url: `${base}/a2a`, transport: 'JSONRPC' }],
    version: config.apiVersion,
    provider: { organization: config.company.legalName, url: base },
    iconUrl: `${base}/assets/icon.svg`, documentationUrl: `${base}/developers`,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
    defaultInputModes: ['application/json', 'text/plain'], defaultOutputModes: ['application/json', 'text/plain'],
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Optional for public skills. Agent key from register_agent, or mandate token.' } },
    security: [{}, { bearer: [] }],
    skills: publicOps().map((o) => ({ id: o.name, name: o.summary, description: o.description, tags: [o.tag.toLowerCase(), 'insurance', 'car'], examples: o.examples ? [JSON.stringify({ skill: o.name, input: o.examples[0] })] : undefined, inputModes: ['application/json'], outputModes: ['application/json'] })),
    supportsAuthenticatedExtendedCard: false,
  };
}

export function mcpServerCard(base) {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json',
    name: 'io.fairkarl/car-insurance', title: `${config.company.name} Car Insurance`, version: config.apiVersion,
    description: 'Quote, buy, service and claim on car insurance for any car in any country.',
    websiteUrl: base,
    remotes: [{ type: 'streamable-http', url: `${base}/mcp`, headers: [{ name: 'Authorization', description: 'Optional: Bearer agent key or mandate token. Public tools work without it.', isRequired: false, isSecret: true }] }],
    packages: [{ registryType: 'npm', identifier: 'fairkarl', transport: { type: 'stdio' }, environmentVariables: [{ name: 'FK_BASE_URL', description: 'API base URL', default: base }, { name: 'FK_API_KEY', description: 'Optional agent key or mandate token', isSecret: true }] }],
    tools: publicOps().map((o) => ({ name: o.name, description: o.summary })),
    authentication: { required: false, schemes: ['bearer', 'oauth2-device-code'], registration: `${base}/v1/agents` },
  };
}

export function ucpProfile(base) {
  return {
    ucp: {
      version: '2026-01-11',
      business: { name: config.company.legalName, url: base, category: 'insurance.motor' },
      services: {
        'dev.ucp.shopping': {
          version: '2026-01-11', spec: 'https://ucp.dev', rest: { schema: `${base}/openapi.json`, endpoint: `${base}/v1` },
          mcp: { schema: `${base}/.well-known/mcp.json`, endpoint: `${base}/mcp` }, a2a: { endpoint: `${base}/.well-known/agent-card.json` },
        },
      },
      capabilities: [
        { name: 'dev.ucp.shopping.catalog', note: 'list_products, get_price_table' },
        { name: 'dev.ucp.shopping.checkout', note: 'create_quote -> bind_policy -> get_confirmation (human confirmation on own device)' },
        { name: 'dev.ucp.shopping.order', note: 'get_policy, get_policy_documents, cancel_policy' },
        { name: 'dev.ucp.common.identity_linking', note: `OAuth 2.0 device grant at ${base}/oauth/device_authorization` },
      ],
      payment: { handlers: [{ id: 'card_token', name: 'Tokenised card / network token' }, { id: 'ap2_mandate', name: 'Agent Payments Protocol mandate' }, { id: 'sepa_debit', name: 'SEPA Direct Debit' }, { id: 'wallet', name: 'Apple Pay / Google Pay / agentic wallet' }] },
    },
  };
}

export const oauthMetadata = (base) => ({
  issuer: base, device_authorization_endpoint: `${base}/oauth/device_authorization`, token_endpoint: `${base}/oauth/token`, revocation_endpoint: `${base}/oauth/revoke`,
  grant_types_supported: ['urn:ietf:params:oauth:grant-type:device_code'], token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
  scopes_supported: ['read', 'quote', 'bind', 'adjust', 'renew', 'cancel', 'claim', 'complaint'],
  service_documentation: `${base}/developers#consent`,
  'x-notes': 'client_id = your agent id (agt_...), client_secret = your agent API key. Send login_hint=<customer email>. The customer approves on their own device; the access_token is a revocable mandate token.',
});

export const protectedResourceMetadata = (base) => ({
  resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: oauthMetadata(base).scopes_supported, bearer_methods_supported: ['header'], resource_documentation: `${base}/developers`,
});

export const aiPlugin = (base) => ({
  schema_version: 'v1', name_for_human: `${config.company.name} Car Insurance`, name_for_model: 'fairkarl',
  description_for_human: 'Insure any car, anywhere, in minutes.',
  description_for_model: 'Car insurance for any country. Use create_quote with country, vehicle make/model/year and driver ages; then bind_policy. The customer confirms purchases themselves.',
  auth: { type: 'none' }, api: { type: 'openapi', url: `${base}/openapi.json` }, logo_url: `${base}/assets/icon.svg`, contact_email: config.company.supportEmail, legal_info_url: `${base}/legal`,
});

export const securityTxt = (base) => `Contact: mailto:security@fairkarl.example
Expires: 2027-10-01T00:00:00.000Z
Preferred-Languages: en
Canonical: ${base}/.well-known/security.txt
Policy: ${base}/legal
`;
