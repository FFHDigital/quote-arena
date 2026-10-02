# FairKarl

AI-first car insurance for any car, anywhere. This is a very light core insurance system with no dependencies (Node 22.13+, built-in SQLite). It covers quoting, buying, documents, mid-term changes, renewals, cancellation, payments and instalments, claims, complaints, handoff to a human, notifications and an audit log.

Every capability is defined once in `src/api/operations.js` and served through:

| Interface | Where |
| --- | --- |
| Website (server-rendered, readable without JavaScript, Schema.org JSON-LD) | `/` |
| REST + OpenAPI 3.1 | `/v1/*`, `/openapi.json` |
| MCP (Streamable HTTP) | `/mcp` |
| MCP (stdio) | `bin/mcp-stdio.js` (set `FK_BASE_URL` to proxy to a hosted server) |
| A2A | `/.well-known/agent-card.json`, `/a2a` |
| UCP profile, OAuth 2.0 device flow, ai-plugin, llms.txt, robots.txt, sitemap | `/.well-known/*`, `/llms.txt` |

## Run

```bash
npm start          # http://localhost:8787  (sandbox)
npm test           # end-to-end: scorecard tasks T1-T8 + MCP + A2A + OAuth + lifecycle
```

Staff console: `/staff` (sandbox key `fk_staff_sandbox`).

Connect an agent (Claude Desktop, Cursor and others):

```json
{ "mcpServers": { "fairkarl": { "type": "http", "url": "http://localhost:8787/mcp" } } }
```

## Pricing (no actuarial model)

- **12 vehicle categories** (`src/catalog/categories.js`), set by deterministic, explained rules from make, model and year, plus optional body type, powertrain, power and value.
- **4 driver bands** (`src/catalog/pricing.js`), set by published points for age, years licensed, claims and convictions.
- **4 cover tiers** (`src/catalog/products.js`).
- That gives **12 × 4 × 4 = 192 prices**. The full table is public at `/pricing` and `GET /v1/pricing/table`.
- **Markets** (`src/catalog/markets.js`): a country only adds its currency, one price index and its premium tax, so each market still has 192 prices, looked up in O(1). Any unlisted country is priced in USD. Sanctioned countries are declined.
- Staff can override any single cell (`staff_set_price`). The change applies equally to new customers and renewals.

## Key flows

1. `create_quote` needs only country, make, model, year and driver age. It returns a firm 30-day price for all 4 tiers, itemised, with a demands-and-needs statement.
2. `requote` handles what-if changes instantly.
3. `bind_policy` sends the customer a confirmation link and code on their own device, along with the IPID and demands-and-needs statement. A mandate can pre-authorise binding within a premium cap.
4. Once the customer approves, the policy, documents and receipt are issued. If the customer allows it, the agent also receives a scoped, revocable **mandate token**.
5. Servicing:
   - Documents, claims (FNOL → evidence checklist → automatic fast-track or a human → offer → customer-confirmed settlement → payout)
   - Priced mid-term changes
   - Renewal with reasons and no loyalty penalty, plus opt-in auto-renew
   - Pro-rata cancellation with no fees
   - Complaints with deadlines and the ombudsman route
   - `request_human` with full context

The daily scheduler (`src/services/scheduler.js`) handles renewal offers 30 days out, auto-renewal, expiry, monthly instalments with a 14-day grace period, and expiry of stale quotes and confirmations. In the sandbox, `sandbox_advance_clock` moves time forward.

## Production checklist (things code can't do)

- Licensing or a fronting/MGA arrangement per market. `markets.js` holds per-country config; refresh FX and confirm local tax and legal minimums.
- Swap the sandbox providers:
  - payments (`setPaymentProvider`): Stripe, Adyen, AP2
  - email/SMS (`setTransport`)
  - number-plate lookup (`lookupVehicle`)
- Set `FK_ENV=production`, `FK_SECRET`, `FK_STAFF_KEY` and `FK_BASE_URL`, and run behind TLS.
- Get listed in the MCP registry, the ChatGPT app directory, the Claude connector directory and the Gemini directory.
- Publish the financial strength rating and SFCR, and collect independent reviews.

See `docs/SCORECARD.md` for the self-assessment against the agent-readiness scorecard.
