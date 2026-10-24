  // ---------- i miei acquisti (Opzioni): sola lettura degli ordini CardTrader ----------
  const ORDER_STATES = {
    hub_pending: ['In attesa del magazzino CardTrader', 'wait'], paid: ['Pagato, da spedire', 'wait'], sent: ['Spedito', 'go'],
    arrived: ['Arrivato', 'ok'], done: ['Concluso', 'ok'], request_for_cancel: ['Annullamento richiesto', 'bad'], canceled: ['Annullato', 'bad'], lost: ['Smarrito', 'bad'],
  };
  let ordersAll = [];
  let ordersPage = 1;

  const LANG_SHORT = { en: 'EN', jp: 'JP', it: 'IT', fr: 'FR', de: 'DE', es: 'ES', pt: 'PT', ko: 'KO', zh: 'ZH', cn: 'CN' };
  function orderItemLine(it) {
    const tags = [it.condition && condShort(it.condition), it.lang && (LANG_SHORT[it.lang] || it.lang.toUpperCase()), it.reverse && 'Reverse', it.first && '1ª ed.', it.graded && 'gradata'].filter(Boolean).join(' · ');
    return el('div', { class: 'oc-item' },
      el('span', { class: 'oi-n' }, el('b', { text: `${it.qty > 1 ? it.qty + '× ' : ''}${it.name}` }), el('small', { text: [it.expansion, tags].filter(Boolean).join(' · ') })),
      it.cents != null ? el('span', { class: 'oi-p', text: money(it.cents * (it.qty || 1)) }) : null);
  }

  function orderCard(o) {
    const [label, kind] = ORDER_STATES[o.state] || [o.state || 'Stato sconosciuto', 'wait'];
    const d = (t) => { const x = t ? new Date(t) : null; return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString('it-IT') : null; };
    const when = o.sentAt ? `spedito il ${d(o.sentAt)}` : o.paidAt ? `pagato il ${d(o.paidAt)}` : null;
    const shown = (o.items || []).slice(0, 6);
    return el('div', { class: 'order-card' },
      el('div', { class: 'oc-head' }, el('b', { text: `Ordine ${o.code || o.id}` }), el('span', { class: `oc-state ${kind}`, text: label })),
      el('div', { class: 'small muted', text: [o.seller && `da ${o.seller}`, when, o.zero && 'CardTrader Zero', o.totalCents != null && `totale ${money(o.totalCents, o.currency)}`].filter(Boolean).join(' · ') }),
      ...shown.map(orderItemLine),
      ...((o.items || []).length > shown.length ? [el('div', { class: 'small muted', text: `e altre ${o.items.length - shown.length} carte` })] : []),
      ...(o.shipping && o.shipping.name ? [el('div', { class: 'small', text: `Spedizione: ${o.shipping.name}${o.shipping.cents != null ? ` (${money(o.shipping.cents)})` : ''}${o.shipping.days && !['arrived', 'done'].includes(o.state) ? ` · consegna stimata entro ${o.shipping.days} giorni` : ''}` })] : []),
      ...(o.tracking ? [el('div', { class: 'small', text: `Tracciamento: ${o.tracking}` })] : []),
    );
  }

  function renderOrders(more) {
    const box = $('ordersBody');
    box.hidden = false;
    const open = ordersAll.filter((o) => !['done', 'canceled', 'lost'].includes(o.state));
    const closed = ordersAll.filter((o) => ['done', 'canceled', 'lost'].includes(o.state));
    box.replaceChildren(
      ...(open.length ? [el('h3', { class: 'oc-h', text: `In corso (${open.length})` }), ...open.map(orderCard)] : [el('p', { class: 'muted', text: 'Nessun ordine in corso.' })]),
      ...(closed.length ? [el('h3', { class: 'oc-h', text: `Conclusi (${closed.length})` }), ...closed.map(orderCard)] : []),
      ...(more ? [el('button', { class: 'btn mini', type: 'button', text: 'Mostra altri', onclick: () => loadOrders(ordersPage + 1) })] : []),
    );
  }

  async function loadOrders(page = 1) {
    const box = $('ordersBody');
    box.hidden = false;
    if (page === 1) box.replaceChildren(el('p', { class: 'muted', text: 'Leggo gli ordini…' }));
    try {
      const r = await api(`/api/orders?page=${page}`);
      ordersAll = page === 1 ? r.orders : [...ordersAll, ...r.orders];
      ordersPage = page;
      if (page === 1 && !r.orders.length) { box.replaceChildren(el('p', { class: 'muted', text: 'Nessun ordine trovato su CardTrader.' })); return; }
      renderOrders(!!r.more);
      if (r.debug) box.append(el('p', { class: 'small muted', text: `Richieste (solo proprietario): ${r.debug.join(' · ')}` }));
      if (r.sample) box.append(el('details', { class: 'small muted' }, el('summary', { text: 'Dati grezzi del primo ordine (solo proprietario)' }), el('pre', { class: 'diag-pre', text: JSON.stringify(r.sample, null, 2).slice(0, 4000) })));
    } catch (e) {
      box.replaceChildren(el('p', { class: 'error', text: e.message }));
    }
  }
  $('ordersLoad').addEventListener('click', () => loadOrders(1));
