# FairKarl against the Agent-Readiness Scorecard

Self-assessment against `agent-readiness-scorecard-insurers.md` (57 sub-criteria, 5 gates). Evidence is the automated test `test/e2e.test.js`, which runs scripts T1–T8 plus MCP, A2A, OAuth and lifecycle tests, so most items are **verified by our own agent test (×1.0)**.

**Built** means the capability is complete in this codebase. **Needs launch** means code alone can't reach 4. That needs operating history, third parties or a regulator, and those items are listed honestly at the end.

## Knock-out gates: 5 of 5 pass

| Gate | How | Test |
| --- | --- | --- |
| G1 Personalised price | `create_quote` returns a firm, bindable price with no key and no phone call | T3 |
| G2 Cover legibility | Typed limits/excesses, structured exclusions with IDs, IPID and wording as text | T2 |
| G3 Permitted access | `/legal` terms explicitly permit agents; `robots.txt` allows AI bots; no CAPTCHA | T1 |
| G4 Delegated authority | Mandates (scopes, cap, pre-authorised actions, expiry, revocation) + OAuth 2.0 device grant | T4, T8, OAuth |
| G5 Disclosure reaches the human | IPID, wording and demands-and-needs emailed to the policyholder at confirmation and at bind, with `disclosures_delivered` proof | T4 |

## Category by category

| ID | Implementation | Status |
| --- | --- | --- |
| 1.1 Agent endpoints | MCP `/mcp` + stdio; OpenAPI 3.1; `/.well-known/` agent-card, mcp.json, ucp, oauth metadata, ai-plugin | Built |
| 1.2 Agent surfaces | Server card and registry metadata ready | **Needs launch**: submit to MCP registry, ChatGPT, Claude and Gemini directories |
| 1.3 Structured web data | JSON-LD: InsuranceAgency, FinancialProduct + AggregateOffer, FAQPage, WebSite | Built (validate on the live URL) |
| 1.4 AI-readable site | `llms.txt`, `llms-full.txt`; all prices and cover server-rendered HTML text (192 prices verified) | Built |
| 1.5 Bot policy | robots.txt allows named AI agents; signed agent requests (`FK-Agent-Signature`) | Built |
| 2.1 Catalogue | `list_products`, stable tier/section/exclusion IDs | Built |
| 2.2 Limits/excesses | Typed numbers + currency per section, per market | Built |
| 2.3 Exclusions | Structured, linked to sections; `check_coverage` cites clause IDs | Built |
| 2.4 Eligibility | Published rules EL01–EL09; `check_eligibility` pre-screens | Built |
| 2.5 Wording/IPID | Text, versioned, effective date, changelog | Built |
| 2.6 Consistency | One registry and one catalogue feed web, REST, MCP, A2A and documents | Built |
| 3.1 Programmatic quote | Minimal required fields, number-plate pre-fill, defaults listed as `assumptions` | Built |
| 3.2 Firmness | 30-day guaranteed price, conditions listed | Built |
| 3.3 Itemised | Base, taxes, fees (0), monthly at 0% APR, `sums_check` | Built |
| 3.4 What-if | `requote` merges changes, returns `price_change`; all 4 tiers in every quote | Built |
| 3.5 Renewal transparency | Prior vs new price, reasons, equals new-customer price | Built |
| 3.6 Discounts/terms | No discounts by design (price table is the deal); payment plans as parameters | Built (scored on the published model) |
| 4.1 Bind in-flow | `bind_policy` + human confirmation, no redirects needed | Built |
| 4.2 Agent payments | Card token, SEPA, AP2 mandate, wallet behind a provider interface | Built; **production provider needed** |
| 4.3 Instant documents | Schedule, certificate, IPID, wording, D&N, receipts as JSON + HTML at bind | Built |
| 4.4 Adjustments | `quote_adjustment` prices pro-rata before `apply_adjustment` | Built |
| 4.5 Renew/cancel | Accept renewal, opt-in auto-renew, cancel with refund calculation | Built |
| 4.6 Receipts/idempotency | Signed receipts + `verify_receipt`; Idempotency-Key on every POST | Built |
| 5.1 FNOL | `create_claim` with instant reference | Built |
| 5.2 Evidence | Typed kinds + metadata, explicit missing list | Built |
| 5.3 Status | Status, next step, owner, expected date; webhooks + event feed | Built |
| 5.4 Settlement | Breakdown, accept (human-confirmed) or dispute, payout tracking | Built |
| 5.5 Servicing | Live policy answers + `servicing` block | Built |
| 5.6 Complaints | Deadlines + ombudsman by country | Built |
| 6.1 Agent ID | Registered agents, verification flag, HMAC request signing | Built (production verification process needed) |
| 6.2 Consent | Scoped, time-limited, revocable; revocation immediate (T8) | Built |
| 6.3 Mandate limits | Scopes, premium cap, pre-authorised actions; out-of-scope refused with reason (T5) | Built |
| 6.4 Identity | Verified once, reused | Built at "basic" level; **add eIDAS/EUDI wallet for strong KYC** |
| 6.5 Audit | Every action with actor, mandate, time; visible to the customer | Built |
| 6.6 Fraud controls | Risk flags route to humans; no CAPTCHA; rate limits | Built |
| 7.1 Docs | OpenAPI + model-oriented tool descriptions, examples, `get_started`, MCP prompts | Built |
| 7.2 Sandbox | Self-serve, personas, test tokens, outbox, clock travel | Built |
| 7.3 Availability | `/status` + `/v1/status`, SLA target | **Needs launch**: 90 days of real history |
| 7.4 Latency/limits | Quotes ~ms; RateLimit headers; 1,200/min for agents | Built |
| 7.5 Errors | RFC 9457 with `errors[].fix`, `retryable`, `next_actions`; MCP errors returned as readable tool results | Built |
| 7.6 Versioning | `/v1`, FK-API-Version header, 12-month deprecation policy | Built |
| 8.1 Demands and needs | In every quote; sent to the human | Built |
| 8.2 Disclosure | Sent to the policyholder directly, with delivery proof | Built |
| 8.3 Fair design | No pre-ticked add-ons, no fees, no drip pricing; agent access is an explicit choice | Built |
| 8.4 AI transparency | `/legal` AI-use statement + human review route | Built |
| 8.5 Vulnerability/data | Vulnerability flag routes to humans; data minimisation and retention stated | Built (legal review needed) |
| 9.1 Price competitiveness | Table is tunable per cell and per market | **Needs launch**: benchmark against market personas |
| 9.2 Value for cover | Broad cover, low excesses, no fees | **Needs launch**: benchmark |
| 9.3 Claims performance | Live `/v1/transparency` computed from records | Built; **needs claims volume** |
| 9.4 Complaints record | Live complaints and upheld rate | Built; **needs ombudsman history** |
| 9.5 Financial strength | Placeholder, stated honestly | **Needs launch**: rating + SFCR |
| 9.6 Independent satisfaction | Placeholder, stated honestly | **Needs launch**: verified reviews |
| 10.1 Escalation with context | `request_human` attaches quote/policy/claim + summary | Built |
| 10.2 Checkpoints | Bind, cancel and settlement confirmed on the human's own device | Built |
| 10.3 Relayable explanations | Plain-language reasons on declines, price changes, claims | Built |
| 10.4 Dual notification | Every event goes to the policyholder (email) and all mandated agents (webhook + feed) | Built |
| 10.5 Shared case state | One case thread for customer, agent and staff | Built |

## What stands between this and 100

Code can't reach 4 on these items. The work after launch:

1. **1.2**: list the MCP server and apps in the agent directories.
2. **7.3**: run in production with public uptime history.
3. **9.1, 9.2**: benchmark the price table against competitors with fixed personas, then tune cells.
4. **9.3–9.6**: these need operating history, a financial strength rating and an SFCR, and independent reviews. The live endpoints are already in place to publish them.
5. Production verification of agents (6.1), strong identity (6.4), a real payment provider (4.2), and legal sign-off on the documents (2.5, 8.x).
