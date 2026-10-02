// OpenAPI 3.1 generated from the operation registry.
import { OPERATIONS } from './operations.js';
import { config } from '../config.js';

const ERROR = {
  type: 'object', description: 'RFC 9457 problem details. "errors" lists each field to fix and how; "fix" says what to do next.',
  properties: {
    type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, code: { type: 'string' }, detail: { type: 'string' }, retryable: { type: 'boolean' }, fix: { type: 'string' },
    errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, code: { type: 'string' }, message: { type: 'string' }, fix: { type: 'string' } } } },
    next_actions: { type: 'array', items: { type: 'object' } },
  },
};

const clean = (s) => JSON.parse(JSON.stringify(s, (k, v) => (k === 'x-lenient' ? undefined : v)));

export function openapi(baseUrl) {
  const paths = {};
  for (const op of OPERATIONS) {
    const oaPath = op.path;
    const pathParams = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const props = op.input.properties || {};
    const required = op.input.required || [];
    const params = pathParams.map((p) => ({ name: p, in: 'path', required: true, description: props[p]?.description, schema: { type: 'string' } }));
    let requestBody;
    const rest = Object.fromEntries(Object.entries(props).filter(([k]) => !pathParams.includes(k)));
    if (op.method === 'GET') {
      for (const [k, s] of Object.entries(rest)) params.push({ name: k, in: 'query', required: required.includes(k), description: s.description, schema: clean({ ...s, description: undefined }) });
    } else if (Object.keys(rest).length) {
      requestBody = { required: required.some((r) => !pathParams.includes(r)), content: { 'application/json': { schema: clean({ type: 'object', properties: rest, required: required.filter((r) => !pathParams.includes(r)) }), ...(op.examples ? { example: op.examples[0] } : {}) } } };
    }
    if (op.method !== 'GET') params.push({ name: 'Idempotency-Key', in: 'header', required: false, description: 'Repeat-safe: the same key returns the original result.', schema: { type: 'string' } });
    paths[oaPath] ||= {};
    paths[oaPath][op.method.toLowerCase()] = {
      operationId: op.name, summary: op.summary, description: `${op.description}\n\nAuth: ${{ public: 'none needed', agent: 'agent API key', user: 'agent key with mandate, mandate token, or customer token', staff: 'staff key' }[op.auth]}.${op.scope ? ` Mandate scope: ${op.scope}.` : ''} MCP tool: \`${op.name}\`.`,
      tags: [op.tag], parameters: params.length ? params : undefined, requestBody,
      security: op.auth === 'public' ? [{}, { bearer: [] }] : [{ bearer: [] }],
      'x-mcp-tool': op.name, 'x-scope': op.scope, 'x-read-only': !!op.readOnly, 'x-internal': !!op.internal,
      responses: {
        [op.status || 200]: { description: 'Success', content: { 'application/json': { schema: { type: 'object' } } } },
        400: { description: 'Invalid request - see errors[].fix', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        401: { description: 'Authentication needed', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        403: { description: 'Not permitted (e.g. mandate scope missing)', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        404: { description: 'Not found', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        422: { description: 'Valid request but not possible (with reason)', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        429: { description: 'Rate limited - see RateLimit and Retry-After headers', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: `${config.company.name} Car Insurance API`, version: config.apiVersion,
      description: `Agent-native car insurance for any car in any country. Quote, buy, service, claim, renew, cancel and complain - all by API.\n\nThe same operations are available as MCP tools at ${baseUrl}/mcp and as A2A skills at ${baseUrl}/a2a. Start with GET /v1/start.\n\nErrors are RFC 9457 problem details with a "fix" for every field. Rate limits are returned in RateLimit-* headers. Every POST accepts an Idempotency-Key.`,
      contact: { email: config.company.supportEmail, url: `${baseUrl}/developers` }, termsOfService: `${baseUrl}/legal`,
      'x-versioning-policy': 'Breaking changes only in a new major path version; at least 12 months notice with Sunset/Deprecation headers.',
    },
    servers: [{ url: baseUrl, description: config.env }],
    tags: [...new Set(OPERATIONS.map((o) => o.tag))].map((t) => ({ name: t })),
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Agent key (fk_agt_...), mandate token (fk_mdt_...), customer token (fk_cus_...) or staff key. Mandate tokens can also be obtained via OAuth 2.0 device authorization grant.' } },
      schemas: { Problem: ERROR },
    },
  };
}
