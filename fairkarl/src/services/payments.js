// Payments behind a provider interface. The sandbox provider accepts any token unless it
// contains "fail" or "decline". Swap `provider` for Stripe/Adyen/AP2 settlement in production.
import { store } from '../db.js';
import { id, nowIso, ApiError, roundMoney } from '../util.js';

export const PAYMENT_METHODS = {
  card: 'Tokenised card (e.g. Stripe pm_..., network token, or agent wallet token)',
  sepa_debit: 'SEPA Direct Debit mandate reference (EUR only, good for monthly instalments)',
  ap2_mandate: 'Agent Payments Protocol (AP2) cart/intent mandate id signed by the user',
  wallet: 'Apple Pay / Google Pay / agentic wallet token',
  pay_on_confirmation: 'The customer enters payment details on the confirmation page (default when no method is given)',
};

let provider = {
  async charge({ method, amount }) {
    const t = String(method?.token || '');
    if (/fail|decline/i.test(t)) return { ok: false, code: 'card_declined', message: 'The payment was declined by the issuer.' };
    return { ok: true, provider_ref: `sbx_${Date.now().toString(36)}`, amount };
  },
  async refund({ amount }) { return { ok: true, provider_ref: `sbx_rf_${Date.now().toString(36)}`, amount }; },
  async payout({ amount }) { return { ok: true, provider_ref: `sbx_po_${Date.now().toString(36)}`, amount }; },
};
export const setPaymentProvider = (p) => { provider = p; };

export function normaliseMethod(m) {
  if (!m) return { type: 'pay_on_confirmation' };
  if (typeof m === 'string') return { type: m.startsWith('sepa') ? 'sepa_debit' : m.startsWith('ap2') ? 'ap2_mandate' : 'card', token: m };
  const type = m.type || m.method || 'card';
  if (!PAYMENT_METHODS[type]) throw new ApiError(422, 'invalid_payment_method', `Unknown payment method "${type}".`, { fix: `Use one of: ${Object.keys(PAYMENT_METHODS).join(', ')}.`, allowed: PAYMENT_METHODS });
  return { type, token: m.token || m.mandate_id || m.id || null, last4: m.last4 || null };
}

async function record(kind, fn, { policy_id, claim_id, customer_id, amount, currency, method, description }) {
  const res = await fn({ method, amount, currency });
  const p = store.payments.insert({
    id: id('pay'), kind, policy_id: policy_id || null, claim_id: claim_id || null, customer_id, amount: roundMoney(amount, currency), currency,
    method: method ? { type: method.type, token_hint: method.token ? String(method.token).slice(0, 8) + '...' : null } : null,
    status: res.ok ? 'succeeded' : 'failed', provider_ref: res.provider_ref || null, failure: res.ok ? null : { code: res.code, message: res.message }, description, at: nowIso(),
  });
  return p;
}
export const charge = (o) => record('charge', provider.charge, o);
export const refund = (o) => record('refund', provider.refund, o);
export const payout = (o) => record('payout', provider.payout, o);

export function collectedFor(policyId) {
  return store.payments.find({ policy_id: policyId }, { limit: 1e6 }).filter((p) => p.status === 'succeeded')
    .reduce((s, p) => s + (p.kind === 'charge' ? p.amount : p.kind === 'refund' ? -p.amount : 0), 0);
}

export const publicPayment = (p) => ({ id: p.id, kind: p.kind, amount: p.amount, currency: p.currency, status: p.status, method: p.method, description: p.description, failure: p.failure, at: p.at, receipt_ref: p.provider_ref });
