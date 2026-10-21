  // ---------- piano ----------
  const PLAN_ROWS = [
    ['Alert su una carta', (p) => p.maxRules],
    ['Alert su tutto un set', (p) => (p.maxSetRules >= p.unlimited ? 'illimitati' : p.maxSetRules || '—')],
    ['Lista dei desideri', (p) => (p.maxWish >= p.unlimited ? 'illimitata' : `${p.maxWish} carte`)],
    ['Collezione', (p) => (p.maxColl >= p.unlimited ? 'illimitata' : `${p.maxColl} carte`)],
    ['Scansioni al mese', (p) => (p.maxScans >= p.unlimited ? 'illimitate' : String(p.maxScans))],
    ['Velocità degli alert', (p) => (p.scanSec >= 60 ? `ogni ${p.scanSec / 60} min` : `ogni ${p.scanSec} s`)],
    ['Storico prezzi', (p) => `${p.historyDays} giorni`],
    ['Spedizione nell’avviso', (p) => (p.shipping ? '✓' : '—')],
    ['Alert con la stella', (p) => (p.priority ? `fino a ${p.maxPriority}` : '—')],
  ];
  const PLAN_INFO = {
    free: { label: 'Gratuito', price: '0 €', maxScans: 5, maxColl: 20, maxRules: 3, maxSetRules: 0, maxWish: 10, scanSec: 300, historyDays: 7, shipping: false, priority: false, maxPriority: 0 },
    pro: { label: 'Pro', price: '4,99 €/mese', maxScans: 200, maxColl: 500, maxRules: 30, maxSetRules: 1, maxWish: 200, scanSec: 30, historyDays: 120, shipping: true, priority: true, maxPriority: 5 },
    sniper: { label: 'Sniper', price: '9,99 €/mese', maxScans: 1000, maxColl: 100000, maxRules: 100, maxSetRules: 10, maxWish: 100000, scanSec: 10, historyDays: 120, shipping: true, priority: true, maxPriority: 12 },
  };

  /** Righe della tabella di confronto dei piani (usata in Impostazioni e nella pagina di accesso). */
  function planTable(curId) {
    const ids = Object.keys(PLAN_INFO);
    const cls = (id) => (id === curId ? 'cur' : '');
    return [
      el('div', { class: 'pt-row pt-head' }, el('span'), ...ids.map((id) => el('b', { class: cls(id), text: PLAN_INFO[id].label }))),
      el('div', { class: 'pt-row' }, el('span', { text: 'Prezzo' }), ...ids.map((id) => el('span', { class: cls(id), text: PLAN_INFO[id].price }))),
      ...PLAN_ROWS.map(([label, f]) => el('div', { class: 'pt-row' }, el('span', { text: label }), ...ids.map((id) => el('span', { class: cls(id), text: String(f({ ...PLAN_INFO[id], unlimited: 100000 })) })))),
    ];
  }

  function renderPlan() {
    const raw = state.account && state.account.plan;
    if (!raw) return;
    // Se il server dati non è ancora aggiornato mancano dei campi: valgono quelli del piano più vicino.
    const p = { unlimited: 100000, ...(PLAN_INFO[raw.id] || PLAN_INFO.sniper), ...raw };
    $('planBadge').textContent = p.label;
    const cards = state.rules.filter((r) => r.blueprintId).length;
    const sets = state.rules.length - cards;
    const lim = (n, max) => (max >= p.unlimited ? `${n}` : `${n} su ${max}`);
    const ratio = (n, max) => (max >= p.unlimited || !max ? null : n / max);
    const out = (state.outOfPlan || []).length;
    $('planUsage').replaceChildren(
      kvRow('Alert su una carta', lim(cards, p.maxRules), cards > p.maxRules ? 'bad' : '', ratio(cards, p.maxRules)),
      ...(p.priority ? [kvRow('Alert con la stella', lim(state.rules.filter((r) => r.priority).length, p.maxPriority))] : []),
      kvRow('Alert su un set', p.maxSetRules ? lim(sets, p.maxSetRules) : sets ? `${sets} (non inclusi)` : 'non inclusi', sets > p.maxSetRules ? 'bad' : '', p.maxSetRules ? ratio(sets, p.maxSetRules) : null),
      kvRow('Lista dei desideri', lim((state.wish || []).length, p.maxWish), '', ratio((state.wish || []).length, p.maxWish)),
      kvRow('Collezione', coll ? `${lim(coll.items.length, p.maxColl)} carte diverse` : lim('—', p.maxColl), '', coll ? ratio(coll.items.length, p.maxColl) : null),
      kvRow('Velocità degli alert', p.scanSec >= 60 ? `ogni ${p.scanSec / 60} minuti` : `fino a ogni ${p.scanSec} secondi`),
      kvRow('Storico prezzi', `${p.historyDays} giorni`),
      ...(out ? [kvRow('Alert fermi', `${out} oltre il limite del piano`, 'bad')] : []),
    );
    $('planTable').replaceChildren(...planTable(p.id));
    renderBilling(p.id);
    // Frequenze più veloci di quella del piano: visibili ma non selezionabili.
    for (const o of $('setScan').options) o.disabled = Number(o.value) < p.scanSec;
  }


  /** Pulsanti per abbonarsi (Lemon Squeezy) e link per gestire l'abbonamento. */
  let billingLinks = null;
  async function renderBilling(planId) {
    const box = $('planBuy');
    if (!box) return;
    if (planId === 'owner') return box.replaceChildren();
    if (!billingLinks) billingLinks = await api('/api/billing/links').catch(() => ({}));
    const L = billingLinks || {};
    const btn = (href, text) => (href ? el('a', { class: 'btn', href, target: '_blank', rel: 'noopener', 'data-direct': '1', text }) : null);
    const rows = [];
    for (const id of ['pro', 'sniper']) {
      if (id === planId) continue;
      const l = L[id] || {};
      const b = [btn(l.monthly, `${PLAN_INFO[id].label} mensile`), btn(l.yearly, `${PLAN_INFO[id].label} annuale`)].filter(Boolean);
      if (b.length) rows.push(el('div', { class: 'buy-row' }, el('b', { text: `Passa a ${PLAN_INFO[id].label}` }), ...b));
    }
    const bill = L.billing;
    if (bill && bill.portalUrl) {
      const when = bill.status === 'cancelled' && bill.endsAt ? `Disdetto: attivo fino al ${new Date(bill.endsAt).toLocaleDateString()}` : bill.renewsAt ? `Si rinnova il ${new Date(bill.renewsAt).toLocaleDateString()}` : '';
      rows.push(el('div', { class: 'buy-row' }, when ? el('span', { class: 'muted small', text: when }) : null, btn(bill.portalUrl, 'Gestisci abbonamento')));
    }
    box.replaceChildren(...rows);
  }
