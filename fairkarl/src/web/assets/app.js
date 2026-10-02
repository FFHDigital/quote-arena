// FairKarl web app: progressive enhancement over the same public API agents use.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (a, c) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: c, maximumFractionDigits: ['JPY', 'KRW', 'VND', 'IDR', 'CLP'].includes(c) ? 0 : 2 }).format(a); } catch { return `${c} ${a}`; } };
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  async function api(method, path, body, token) {
    const r = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.detail || `Error ${r.status}`); e.body = j; throw e; }
    return j;
  }
  const errHtml = (e) => `<div class="err" role="alert"><p><strong>${esc(e.message)}</strong></p>${(e.body?.errors || []).map((x) => `<p>${esc(x.field)}: ${esc(x.message)} ${esc(x.fix || '')}</p>`).join('')}${e.body?.fix ? `<p>${esc(e.body.fix)}</p>` : ''}</div>`;
  const busy = (btn, on) => { if (btn) { btn.disabled = on; } };

  // ---------- quote (home) ----------
  function initQuote() {
    const form = $('#quote-form'); if (!form) return;
    const out = $('#quote-result');
    let current = null;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const body = { country: f.country, vehicle: { make: f.make || undefined, model: f.model || undefined, year: f.year ? Number(f.year) : undefined, value: f.value ? Number(f.value) : undefined, registration: f.registration || undefined },
        drivers: [{ age: Number(f.age), years_licensed: f.years_licensed === '' ? undefined : Number(f.years_licensed), claims_last_5y: Number(f.claims_last_5y || 0), major_convictions_5y: 0, minor_convictions_5y: 0 }] };
      const btn = form.querySelector('button'); busy(btn, true);
      try { current = await api('POST', '/v1/quotes', body); renderQuote(current); } catch (e) { out.innerHTML = errHtml(e); } finally { busy(btn, false); }
    });
    function renderQuote(q) {
      if (q.status !== 'quoted') { out.innerHTML = `<div class="card"><h3>We can't give an instant price</h3><p>${esc(q.explanation)}</p><p><button class="btn" id="human">Ask a person to help</button></p></div>`; $('#human').onclick = () => askHuman(q); return; }
      const rec = q.demands_and_needs.recommended_tier;
      out.innerHTML = `<p class="muted">${esc(q.vehicle.year)} ${esc(q.vehicle.make)} ${esc(q.vehicle.model)}: <span class="pill">${esc(q.vehicle.category_name)}</span> · Driver band <span class="pill">${esc(q.driver_band)} ${esc(q.driver_band_name)}</span> · Prices fixed until ${esc(q.valid_until)}</p>
      ${q.assumptions?.length ? `<details><summary>We assumed ${q.assumptions.length} thing(s) - check them</summary><ul>${q.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></details>` : ''}
      <div class="tiers">${q.alternatives.map((a) => `<div class="tier${a.cover_tier === rec ? ' rec' : ''}">${a.cover_tier === rec ? '<span class="pill">Recommended for you</span>' : ''}<h3>${esc(a.name)}</h3><div class="price">${fmt(a.total_annual, a.currency)}<small class="muted"> /year</small></div><div class="muted">or ${fmt(a.monthly, a.currency)} a month, 0% interest</div><p>${esc(a.summary)}</p><button class="btn ${a.cover_tier === rec ? 'primary' : ''}" data-tier="${a.cover_tier}">Choose ${esc(a.name)}</button></div>`).join('')}</div>
      <p class="muted">${esc(q.demands_and_needs.recommendation_reason)} Price includes tax, no fees. <a href="/products">Compare what's included</a>.</p><div id="buy"></div>`;
      out.querySelectorAll('[data-tier]').forEach((b) => (b.onclick = () => choose(b.dataset.tier)));
    }
    async function choose(tier) {
      let q = current;
      if (q.cover_tier !== tier) q = current = await api('POST', `/v1/quotes/${q.id}/requote`, { changes: { cover_tier: tier } });
      const buy = $('#buy');
      buy.innerHTML = `<div class="card"><h3>${esc(q.cover.tier)}: ${fmt(q.price.total_annual, q.price.currency)} a year</h3>
      <p class="muted">${esc(q.price.sums_check)}. Key documents: ${q.links ? `<a href="${q.links.ipid}" target="_blank">IPID</a> · <a href="${q.links.wording}" target="_blank">Policy wording</a>` : ''}</p>
      <p>${esc(q.demands_and_needs.statement)}</p>
      <form id="buy-form" class="grid"><label>Full name <input name="name" required autocomplete="name"></label><label>Email <input name="email" type="email" required autocomplete="email"></label>
      <label>Pay <select name="plan"><option value="annual">Annually ${fmt(q.price.total_annual, q.price.currency)}</option><option value="monthly">Monthly 12 × ${fmt(q.price.monthly_option.amount, q.price.currency)} (0% APR)</option></select></label>
      <label>Start date <input name="start" type="date" value="${esc(q.start_date)}"></label>
      <label>Card number <small>(sandbox: any number)</small><input name="card" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242" required></label>
      <button class="btn primary">Buy - we'll email you to confirm</button></form><div id="buy-out" aria-live="polite"></div></div>`;
      $('#buy-form').onsubmit = async (ev) => {
        ev.preventDefault();
        const f = Object.fromEntries(new FormData(ev.target));
        const btn = ev.target.querySelector('button'); busy(btn, true);
        try {
          const r = await api('POST', '/v1/policies', { quote_id: q.id, policyholder: { name: f.name, email: f.email }, payment_plan: f.plan, start_date: f.start, payment_method: { type: 'card', token: /0002$/.test(f.card.replace(/\s/g, '')) ? 'tok_card_fail' : 'tok_visa' } });
          $('#buy-out').innerHTML = `<p class="ok"><strong>Nearly done.</strong> ${esc(r.human_message || '')}</p>${r.sandbox ? `<p><a class="btn" href="/confirm/${r.id}?c=${r.sandbox.code}">Open the confirmation link (sandbox shortcut)</a></p>` : ''}`;
        } catch (e) { $('#buy-out').innerHTML = errHtml(e); } finally { busy(btn, false); }
      };
      buy.scrollIntoView({ behavior: 'smooth' });
    }
    async function askHuman(q) {
      const email = prompt('Your email, so a person can reply:'); if (!email) return;
      try { const c = await api('POST', '/v1/cases', { reason: 'underwriting_referral', quote_id: q.id, contact: { email }, context_summary: q.explanation }); out.insertAdjacentHTML('beforeend', `<p class="ok">${esc(c.human_message)}</p>`); } catch (e) { out.insertAdjacentHTML('beforeend', errHtml(e)); }
    }
  }

  // ---------- confirm ----------
  async function initConfirm() {
    const el = $('#confirm-app'); if (!el) return;
    const idv = el.dataset.id; const code = new URLSearchParams(location.search).get('c') || '';
    let c;
    try { c = await api('GET', `/v1/confirmations/${idv}?code=${encodeURIComponent(code)}`); } catch (e) { el.innerHTML = errHtml(e); return; }
    if (c.status !== 'pending') { el.innerHTML = `<div class="card"><h2>This request is ${esc(c.status)}</h2>${c.result ? resultHtml(c) : ''}</div>`; return; }
    const pay = c.options?.needs_payment_method;
    const agent = c.requested_by?.type === 'agent' ? c.requested_by.name : null;
    el.innerHTML = `<div class="card"><h2>${esc(c.action_text)}</h2>${agent ? `<p>Requested by your agent <strong>${esc(agent)}</strong>.</p>` : ''}
      <ul>${c.summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      ${c.disclosures?.length ? `<p><strong>Please read before confirming:</strong> ${c.disclosures.map((d) => `<a href="${d.url}" target="_blank">${esc(d.title)}</a>`).join(' · ')}</p>` : ''}
      <form id="cf" class="stack">${code ? '' : '<label>6-digit code <input name="code" inputmode="numeric" required></label>'}
      ${pay ? '<label>Card number <small>(sandbox: any)</small><input name="card" inputmode="numeric" required></label>' : ''}
      ${agent && c.options?.grant_agent_access ? `<fieldset class="choice"><legend>Should ${esc(agent)} keep helping with this policy?</legend><label class="radio"><input type="radio" name="grant" value="yes" required> Yes: it can view the policy, make claims and suggest changes (you still confirm purchases, cancellations and payouts)</label><label class="radio"><input type="radio" name="grant" value="no"> No, just this purchase</label></fieldset>` : ''}
      <div class="inline"><button class="btn primary" name="d" value="approve">Confirm</button><button class="btn" name="d" value="reject" formnovalidate>No, cancel this</button></div></form><div id="cfo" aria-live="polite"></div></div>`;
    $('#cf').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      const decision = ev.submitter?.value || 'approve';
      try {
        const r = await api('POST', `/v1/confirmations/${idv}`, { code: code || f.code, decision, grant_agent_access: f.grant === 'yes', ...(pay && decision === 'approve' ? { payment_method: { type: 'card', token: 'tok_visa' } } : {}) });
        el.innerHTML = `<div class="card"><h2>${r.status === 'approved' ? 'Done' : 'Cancelled'}</h2>${resultHtml(r)}</div>`;
      } catch (e) { $('#cfo').innerHTML = errHtml(e); }
    };
  }
  function resultHtml(c) {
    const p = c.result?.policy;
    if (p) return `<p class="ok">You're covered. Policy <strong>${esc(p.number)}</strong>, ${esc(p.start_date)} to ${esc(p.end_date)}.</p><p>${(c.result.documents || p.documents || []).map((d) => `<a href="${d.url}" target="_blank">${esc(d.title)}</a>`).join(' · ')}</p><p><a href="/account">Go to my account</a></p>`;
    if (c.result?.mandate) return `<p class="ok">Access granted to ${esc(c.result.mandate.agent?.name)} until ${esc(c.result.mandate.expires_at?.slice(0, 10))}. Revoke any time in <a href="/account">your account</a>.</p>`;
    return `<pre>${esc(JSON.stringify(c.result, null, 2))}</pre>`;
  }

  // ---------- account ----------
  async function initAccount() {
    const el = $('#account-app'); if (!el) return;
    const tok = store.get('fk_cus');
    if (!tok) return login(el);
    let me;
    try { me = await api('GET', '/v1/me', null, tok); } catch { store.set('fk_cus', null); return login(el); }
    const [pols, claims, mandates, act, cmps] = await Promise.all([api('GET', '/v1/policies', null, tok), api('GET', '/v1/claims', null, tok), api('GET', '/v1/mandates', null, tok), api('GET', '/v1/activity?limit=30', null, tok), api('GET', '/v1/complaints', null, tok)]);
    el.innerHTML = `<p>Signed in as <strong>${esc(me.customer.email)}</strong> <button class="btn" id="out">Sign out</button></p>
    <section class="card"><h2>Policies</h2><div class="list">${pols.policies.map((p) => `<div><strong>${esc(p.number)}</strong> ${esc(p.vehicle)} · ${esc(p.cover_tier.replace(/_/g, ' '))} · <span class="pill">${esc(p.status)}</span> · ${esc(p.start_date)} to ${esc(p.end_date)} · ${fmt(p.annual_premium, p.currency)}/yr
      <div class="inline"><button class="btn" data-act="docs" data-id="${p.id}">Documents</button><button class="btn" data-act="renew" data-id="${p.id}">Renewal</button><button class="btn" data-act="claim" data-id="${p.id}">Make a claim</button><button class="btn danger" data-act="cancel" data-id="${p.id}">Cancel</button></div><div id="x-${p.id}"></div></div>`).join('') || '<p>No policies yet. <a href="/">Get a quote</a>.</p>'}</div></section>
    <section class="card"><h2>Claims</h2><div class="list">${claims.claims.map((c) => `<div><strong>${esc(c.number)}</strong> ${esc(c.incident.name)} · <span class="pill">${esc(c.status.replace(/_/g, ' '))}</span><br>${esc(c.next_step)}
      ${c.missing_evidence.length ? `<form class="inline ev" data-id="${c.id}"><label>Upload <select name="kind">${c.missing_evidence.map((m) => `<option value="${m.kind}">${esc(m.label)}</option>`).join('')}</select></label><input type="file" name="file"><label>Amount <input name="amount" type="number" size="6"></label><button class="btn">Upload</button></form>` : ''}
      ${c.offer && c.status === 'offer_made' ? `<p>Offer: <strong>${fmt(c.offer.net_payable, c.offer.currency)}</strong>. ${esc(c.offer.explanation)}</p><div class="inline"><button class="btn primary" data-act="accept" data-id="${c.id}">Accept</button><button class="btn" data-act="dispute" data-id="${c.id}">Dispute</button></div>` : ''}</div>`).join('') || '<p>No claims.</p>'}</div></section>
    <section class="card"><h2>Agents with access</h2><div class="list">${mandates.mandates.map((m) => `<div><strong>${esc(m.agent?.name)}</strong> ${m.agent?.verified ? '<span class="pill">verified</span>' : ''} · ${esc(m.status)} · can: ${esc(m.scopes.join(', '))}${m.premium_cap ? ` · cap ${fmt(m.premium_cap.amount, m.premium_cap.currency)}` : ''} · until ${esc(m.expires_at?.slice(0, 10))} ${m.status === 'active' ? `<button class="btn danger" data-act="revoke" data-id="${m.id}">Revoke now</button>` : ''}</div>`).join('') || '<p>No agents have access.</p>'}</div></section>
    <section class="card"><h2>Complaints</h2>${cmps.complaints.map((c) => `<p>${esc(c.reference)} · ${esc(c.status)} · final response by ${esc(c.deadlines.final_response_by.slice(0, 10))}</p>`).join('') || '<p>None.</p>'}<button class="btn" data-act="complain">Make a complaint</button> <button class="btn" data-act="human">Talk to a person</button></section>
    <section class="card"><h2>Everything done on your account</h2><div class="scroll"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${act.activity.map((a) => `<tr><td>${esc(a.at.replace('T', ' ').slice(0, 16))}</td><td>${esc(a.actor.type)}${a.actor.name ? ': ' + esc(a.actor.name) : ''}${a.mandate_id ? ' (mandate)' : ''}</td><td>${esc(a.action)}</td></tr>`).join('')}</tbody></table></div></section>`;
    $('#out').onclick = () => { store.set('fk_cus', null); location.reload(); };
    el.querySelectorAll('form.ev').forEach((f) => (f.onsubmit = async (ev) => {
      ev.preventDefault();
      const d = new FormData(f); const file = d.get('file');
      const b64 = file && file.size ? await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(file); }) : null;
      try { await api('POST', `/v1/claims/${f.dataset.id}/evidence`, { kind: d.get('kind'), content_base64: b64 || undefined, filename: file?.name, text: b64 ? undefined : 'Provided via account page', metadata: d.get('amount') ? { amount: Number(d.get('amount')) } : undefined }, tok); location.reload(); } catch (e) { f.insertAdjacentHTML('afterend', errHtml(e)); }
    }));
    el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
      const idv = b.dataset.id; const box = $(`#x-${idv}`) || b.parentElement;
      try {
        if (b.dataset.act === 'docs') { const d = await api('GET', `/v1/policies/${idv}/documents`, null, tok); box.innerHTML = d.documents.map((x) => `<a href="${x.html_url}" target="_blank">${esc(x.title)}</a>`).join(' · '); }
        if (b.dataset.act === 'renew') { const r = await api('GET', `/v1/policies/${idv}/renewal`, null, tok); box.innerHTML = r.status === 'offered' ? `<p>Renewal: <strong>${fmt(r.new_annual, r.currency)}</strong> (last year ${fmt(r.prior_annual, r.currency)}). ${r.reasons.map(esc).join(' ')} <em>${esc(r.fairness_statement)}</em></p><button class="btn primary" id="ar">Renew</button>` : `<p>${esc(r.explanation || r.status)}</p>`; const ar = $('#ar'); if (ar) ar.onclick = async () => { await api('POST', `/v1/policies/${idv}/renewal/accept`, {}, tok); location.reload(); }; }
        if (b.dataset.act === 'cancel') { const q = await api('GET', `/v1/policies/${idv}/cancellation-quote`, null, tok); box.innerHTML = `<p>${esc(q.explanation)}</p><button class="btn danger" id="cc">Cancel and refund ${fmt(q.refund, q.currency)}</button>`; $('#cc').onclick = async () => { await api('POST', `/v1/policies/${idv}/cancel`, { reason: 'Customer request' }, tok); location.reload(); }; }
        if (b.dataset.act === 'claim') {
          box.innerHTML = `<form class="grid" id="cl"><label>What happened <select name="t"><option value="collision">Accident (my car damaged)</option><option value="collision_not_at_fault">Accident - not my fault</option><option value="windscreen">Windscreen / glass</option><option value="theft">Car stolen</option><option value="vandalism">Vandalism</option><option value="weather">Storm / flood</option><option value="fire">Fire</option><option value="breakdown">Breakdown</option><option value="lost_keys">Lost keys</option><option value="third_party_damage">I damaged someone's property</option></select></label><label>When <input type="date" name="d" required></label><label>Rough cost <input type="number" name="a"></label><label>Tell us briefly <textarea name="desc" required></textarea></label><label><input type="checkbox" name="inj"> Anyone hurt?</label><button class="btn primary">Start claim</button></form>`;
          $('#cl').onsubmit = async (ev) => { ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); await api('POST', '/v1/claims', { policy_id: idv, incident_type: f.t, incident_date: f.d, description: f.desc, estimated_amount: f.a ? Number(f.a) : undefined, injuries: !!f.inj }, tok); location.reload(); };
        }
        if (b.dataset.act === 'accept') { await api('POST', `/v1/claims/${idv}/settlement`, { decision: 'accept' }, tok); location.reload(); }
        if (b.dataset.act === 'dispute') { const reason = prompt('Why do you disagree?'); if (reason) { await api('POST', `/v1/claims/${idv}/settlement`, { decision: 'dispute', reason }, tok); location.reload(); } }
        if (b.dataset.act === 'revoke') { await api('POST', `/v1/mandates/${idv}/revoke`, {}, tok); location.reload(); }
        if (b.dataset.act === 'complain') { const d = prompt('What went wrong?'); if (d) { const c = await api('POST', '/v1/complaints', { description: d }, tok); alertBox(b, `Complaint ${c.reference} received. Final response by ${c.deadlines.final_response_by.slice(0, 10)}.`); } }
        if (b.dataset.act === 'human') { const d = prompt('How can a person help?'); if (d) { const c = await api('POST', '/v1/cases', { reason: 'customer_request', message: d }, tok); alertBox(b, c.human_message); } }
      } catch (e) { box.insertAdjacentHTML('beforeend', errHtml(e)); }
    }));
  }
  const alertBox = (el, msg) => el.insertAdjacentHTML('afterend', `<p class="ok" role="status">${esc(msg)}</p>`);
  function login(el) {
    el.innerHTML = `<div class="card"><form id="lf" class="inline"><label>Email <input type="email" name="email" required autocomplete="email"></label><button class="btn primary">Email me a code</button></form><div id="lo" aria-live="polite"></div></div>`;
    $('#lf').onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        const r = await api('POST', '/v1/auth/login', { email: new FormData(ev.target).get('email') });
        $('#lo').innerHTML = `<form id="vf" class="inline"><label>Code <input name="code" inputmode="numeric" value="${esc(r.sandbox_code || '')}" required></label><button class="btn primary">Sign in</button></form>${r.sandbox_code ? '<p class="muted">Sandbox: code pre-filled.</p>' : ''}`;
        $('#vf').onsubmit = async (e2) => { e2.preventDefault(); try { const v = await api('POST', '/v1/auth/verify', { login_id: r.login_id, code: new FormData(e2.target).get('code') }); store.set('fk_cus', v.customer_token); location.reload(); } catch (e) { $('#lo').insertAdjacentHTML('beforeend', errHtml(e)); } };
      } catch (e) { $('#lo').innerHTML = errHtml(e); }
    };
  }

  // ---------- staff ----------
  async function initStaff() {
    const el = $('#staff-app'); if (!el) return;
    const key = store.get('fk_staff');
    if (!key) { el.innerHTML = '<form id="sk" class="inline card"><label>Staff key <input name="k" type="password" required></label><button class="btn primary">Open</button></form>'; $('#sk').onsubmit = (e) => { e.preventDefault(); store.set('fk_staff', new FormData(e.target).get('k')); location.reload(); }; return; }
    let q; try { q = await api('GET', '/v1/staff/queue', null, key); } catch (e) { store.set('fk_staff', null); el.innerHTML = errHtml(e); return; }
    el.innerHTML = `<section class="card"><h2>Claims needing a decision (${q.claims.length})</h2><div class="list">${q.claims.map((c) => `<div><strong>${esc(c.number)}</strong> ${esc(c.incident.name)} · ${esc(c.status)} · ${esc(c.incident.description)}<br><small>${esc(c.timeline.at(-1).note)}</small><br>Evidence: ${c.evidence.map((e) => esc(e.kind) + (e.metadata?.amount ? ` (${e.metadata.amount})` : '')).join(', ') || 'none'}<form class="inline sd" data-id="${c.id}"><label>Gross amount <input name="amount" type="number"></label><label>Reason <input name="reason" required></label><button class="btn primary" name="d" value="offer">Offer</button><button class="btn danger" name="d" value="decline">Decline</button></form></div>`).join('') || '<p>Nothing waiting.</p>'}</div></section>
    <section class="card"><h2>Cases (${q.cases.length})</h2><div class="list">${q.cases.map((k) => `<div><strong>${esc(k.subject)}</strong> · ${esc(k.priority)} · due ${esc(k.expected_response_by.slice(0, 16))}<br>${esc(k.context_summary || '')}<br>${Object.entries(k.refs).map(([a, b]) => `${esc(a)}: ${esc(b)}`).join(' · ')}<ul>${k.messages.map((m) => `<li>${esc(m.from.type)}: ${esc(m.text)}</li>`).join('')}</ul><form class="inline sc" data-id="${k.id}"><input name="text" required placeholder="Reply"><button class="btn">Send</button><button class="btn" name="d" value="resolved">Send &amp; resolve</button></form></div>`).join('') || '<p>No open cases.</p>'}</div></section>
    <section class="card"><h2>Complaints (${q.complaints.length})</h2><div class="list">${q.complaints.map((c) => `<div><strong>${esc(c.reference)}</strong> ${esc(c.description)} · final by ${esc(c.deadlines.final_response_by.slice(0, 10))}<form class="inline sp" data-id="${c.id}"><input name="response" required placeholder="Response"><label><input type="checkbox" name="upheld"> Upheld</label><button class="btn">Update</button><button class="btn primary" name="d" value="final">Final response</button></form></div>`).join('') || '<p>None.</p>'}</div></section>`;
    const go = async (fn) => { try { await fn(); location.reload(); } catch (e) { el.insertAdjacentHTML('afterbegin', errHtml(e)); } };
    el.querySelectorAll('form.sd').forEach((f) => (f.onsubmit = (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); go(() => api('POST', `/v1/staff/claims/${f.dataset.id}/decision`, { decision: e.submitter.value, amount: d.amount ? Number(d.amount) : undefined, reason: d.reason }, key)); }));
    el.querySelectorAll('form.sc').forEach((f) => (f.onsubmit = (e) => { e.preventDefault(); go(() => api('POST', `/v1/cases/${f.dataset.id}/messages`, { text: new FormData(f).get('text'), status: e.submitter.value === 'resolved' ? 'resolved' : undefined }, key)); }));
    el.querySelectorAll('form.sp').forEach((f) => (f.onsubmit = (e) => { e.preventDefault(); const d = Object.fromEntries(new FormData(f)); go(() => api('POST', `/v1/staff/complaints/${f.dataset.id}/response`, { response: d.response, upheld: !!d.upheld, final: e.submitter.value === 'final' }, key)); }));
  }

  const page = document.body.dataset.page;
  ({ home: initQuote, confirm: initConfirm, account: initAccount, staff: initStaff })[page]?.();
})();
