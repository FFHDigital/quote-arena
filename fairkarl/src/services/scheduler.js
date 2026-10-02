// Daily jobs: start scheduled policies, offer renewals 30 days out, auto-renew or expire,
// collect monthly instalments (with a 14-day grace period), expire quotes and confirmations.
import { store } from '../db.js';
import { config } from '../config.js';
import { today, addDays, nowIso, now } from '../util.js';
import { generateRenewal, executeRenewal } from './policies.js';
import { charge } from './payments.js';
import { emit, audit } from './notify.js';

const sysCtx = (baseUrl) => ({ actor: { type: 'system', id: 'scheduler', name: 'FairKarl scheduler' }, baseUrl: baseUrl || config.baseUrl || `http://localhost:${config.port}` });

export async function runScheduler({ baseUrl } = {}) {
  const ctx = sysCtx(baseUrl);
  const t = today();
  const report = { as_of: t, started: 0, renewals_offered: 0, auto_renewed: 0, expired: 0, instalments_collected: 0, instalments_failed: 0, lapsed: 0, quotes_expired: 0, confirmations_expired: 0 };

  for (const q of store.quotes.where(`json_extract(data,'$.status') = 'quoted' AND json_extract(data,'$.valid_until') < ?`, [t], { limit: 10000 })) {
    store.quotes.update(q.id, { status: 'expired' }); report.quotes_expired++;
  }
  for (const c of store.confirmations.where(`json_extract(data,'$.status') = 'pending' AND json_extract(data,'$.expires_at') < ?`, [nowIso()], { limit: 10000 })) {
    store.confirmations.update(c.id, { status: 'expired' }); report.confirmations_expired++;
  }

  for (const p of store.policies.where(`json_extract(data,'$.status') IN ('active','scheduled')`, [], { limit: 100000, desc: false })) {
    let pol = p;
    if (pol.status === 'scheduled' && pol.start_date <= t) { pol = store.policies.update(pol.id, { status: 'active' }); report.started++; }
    // instalments
    for (const inst of pol.premium.instalments.filter((i) => ['scheduled', 'failed'].includes(i.status) && i.due <= t)) {
      const pay = await charge({ policy_id: pol.id, customer_id: pol.customer_id, amount: inst.amount, currency: pol.currency, method: pol.payment_method, description: `Instalment ${inst.n} of 12` });
      pol = store.policies.update(pol.id, (d) => {
        d.premium.instalments = d.premium.instalments.map((i) => (i.n === inst.n ? { ...i, status: pay.status === 'succeeded' ? 'paid' : 'failed', payment_id: pay.id, attempts: (i.attempts || 0) + 1, first_failed_on: pay.status === 'succeeded' ? i.first_failed_on : i.first_failed_on || t } : i));
        return d;
      });
      if (pay.status === 'succeeded') report.instalments_collected++;
      else {
        report.instalments_failed++;
        const failedOn = pol.premium.instalments.find((i) => i.n === inst.n).first_failed_on;
        if (addDays(failedOn, 14) <= t) {
          pol = store.policies.update(pol.id, (d) => { d.status = 'lapsed'; d.cover_ends = t; d.history.push({ at: nowIso(), type: 'lapsed', detail: 'Instalment unpaid after 14-day grace period' }); return d; });
          emit('policy.lapsed', { customer_id: pol.customer_id, data: { policy_id: pol.id }, human: { subject: `Policy ${pol.number} has ended`, text: 'We could not collect your instalment after 14 days, so your cover has ended. Driving uninsured is illegal. Contact us to restart cover.' } });
          report.lapsed++;
          break;
        }
        emit('payment.failed', { customer_id: pol.customer_id, data: { policy_id: pol.id, instalment: inst.n, amount: inst.amount, currency: pol.currency, grace_until: addDays(failedOn, 14) },
          human: { subject: `Payment failed for ${pol.number}`, text: `We could not collect instalment ${inst.n} (${inst.amount} ${pol.currency}). You are still covered. Please update your payment method by ${addDays(failedOn, 14)} to keep your cover.` } });
      }
    }
    if (pol.status !== 'active' && pol.status !== 'scheduled') continue;
    // renewal offer 30 days before the end
    if (!pol.renewal && !pol.renewed_to && addDays(pol.end_date, -config.renewalOfferDaysBefore) <= t) { generateRenewal(pol, ctx); report.renewals_offered++; pol = store.policies.get(pol.id); }
    // end of term
    if (pol.end_date <= t && !pol.renewed_to) {
      if (pol.auto_renew && pol.renewal?.status === 'offered') {
        try { await executeRenewal({ policy_id: pol.id }, {}, ctx); report.auto_renewed++; } catch (e) {
          emit('policy.renewal_failed', { customer_id: pol.customer_id, data: { policy_id: pol.id, error: e.message }, human: { subject: `We could not auto-renew ${pol.number}`, text: `${e.message} Your cover ends on ${pol.end_date}. Renew from your account to stay insured.` } });
        }
      } else if (pol.end_date < t) {
        store.policies.update(pol.id, (d) => { d.status = 'expired'; d.history.push({ at: nowIso(), type: 'expired', detail: 'Term ended without renewal' }); return d; });
        emit('policy.expired', { customer_id: pol.customer_id, data: { policy_id: pol.id }, human: { subject: `Policy ${pol.number} has ended`, text: 'Your cover has ended. Get a new quote any time.' } });
        report.expired++;
      }
    }
    if (pol.renewed_to && pol.end_date < t) store.policies.update(pol.id, { status: 'renewed' });
  }
  audit(ctx, 'scheduler.run', { detail: report });
  return report;
}

export function startScheduler(baseUrl) {
  const tick = () => runScheduler({ baseUrl }).catch((e) => console.error('[scheduler]', e));
  setTimeout(tick, 2000).unref();
  return setInterval(tick, 60 * 60 * 1000).unref();
}
