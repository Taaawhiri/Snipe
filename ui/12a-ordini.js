  // ---------- i miei acquisti (Opzioni): sola lettura degli ordini CardTrader ----------
  const ORDER_STATES = {
    hub_pending: ['In attesa del magazzino CardTrader', 'wait'], paid: ['Pagato, da spedire', 'wait'], sent: ['Spedito', 'go'],
    arrived: ['Arrivato', 'ok'], done: ['Concluso', 'ok'], request_for_cancel: ['Annullamento richiesto', 'bad'], canceled: ['Annullato', 'bad'], lost: ['Smarrito', 'bad'],
  };
  let ordersAll = [];
  let ordersPage = 1;

  function orderCard(o) {
    const [label, kind] = ORDER_STATES[o.state] || [o.state || 'Stato sconosciuto', 'wait'];
    const names = (o.items || []).map((it) => `${it.qty > 1 ? it.qty + '× ' : ''}${it.name || 'Carta'}`);
    const date = o.date ? new Date(o.date) : null;
    return el('div', { class: 'order-card' },
      el('div', { class: 'oc-head' },
        el('b', { text: `Ordine ${o.id}` }),
        el('span', { class: `oc-state ${kind}`, text: label })),
      el('div', { class: 'small muted', text: [o.seller && `da ${typeof o.seller === 'string' ? o.seller : o.seller.username || ''}`, date && !Number.isNaN(date.getTime()) && date.toLocaleDateString('it-IT'), o.zero && 'CardTrader Zero', o.totalCents != null && money(o.totalCents, o.currency)].filter(Boolean).join(' · ') }),
      ...(names.length ? [el('div', { class: 'oc-items', text: names.slice(0, 6).join(', ') + (names.length > 6 ? ` e altre ${names.length - 6}` : '') })] : []),
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
