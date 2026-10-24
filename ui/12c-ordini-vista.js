  // ---------- scheda "Ordini": i tuoi acquisti su CardTrader, in corso e conclusi (sola lettura) ----------
  const ORDER_STATES = {
    pending: ['In attesa', 'wait'], hub_pending: ['In attesa del magazzino CardTrader', 'wait'], paid: ['Pagato, da spedire', 'wait'], sent: ['Spedito', 'go'],
    arrived: ['Arrivato', 'ok'], done: ['Concluso', 'ok'], request_for_cancel: ['Annullamento richiesto', 'bad'], canceled: ['Annullato', 'bad'], lost: ['Smarrito', 'bad'],
  };
  const ORDER_CLOSED = ['done', 'canceled', 'lost'];

  function orderItemLine(it) {
    const tags = [it.condition && condShort(it.condition), it.lang && (ORD_LANG[it.lang] || it.lang.toUpperCase()), it.reverse && 'Reverse', it.first && '1ª ed.', it.graded && 'gradata'].filter(Boolean).join(' · ');
    return el('div', { class: 'oc-item' },
      el('span', { class: 'oi-n' }, el('b', { text: `${it.qty > 1 ? it.qty + '× ' : ''}${it.name}` }), el('small', { text: [it.expansion, tags].filter(Boolean).join(' · ') })),
      ...(it.cents != null ? [el('span', { class: 'oi-p', text: money(it.cents * (it.qty || 1)) })] : []));
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
      ...((o.items || []).length > shown.length || (o.size || 0) > (o.items || []).length ? [el('div', { class: 'small muted', text: `e altre ${Math.max((o.items || []).length, o.size || 0) - shown.length} carte` })] : []),
      ...(o.shipping && o.shipping.name ? [el('div', { class: 'small', text: `Spedizione: ${o.shipping.name}${o.shipping.cents != null ? ` (${money(o.shipping.cents)})` : ''}${o.shipping.days && !ORDER_CLOSED.includes(o.state) && o.state !== 'arrived' ? ` · consegna stimata entro ${o.shipping.days} giorni` : ''}` })] : []),
      ...(o.tracking ? [el('div', { class: 'small', text: `Tracciamento: ${o.tracking}` })] : []),
    );
  }

  async function loadOrdersView() {
    const box = $('ordersList');
    box.replaceChildren(el('p', { class: 'muted', text: 'Leggo gli ordini…' }));
    try {
      const { orders } = await api('/api/orders');
      if (!orders.length) { box.replaceChildren(el('p', { class: 'muted', text: 'Nessun ordine trovato su CardTrader.' })); return; }
      const open = orders.filter((o) => !ORDER_CLOSED.includes(o.state));
      const closed = orders.filter((o) => ORDER_CLOSED.includes(o.state));
      box.replaceChildren(
        ...(open.length ? [el('h3', { class: 'oc-h', text: `In corso (${open.length})` }), ...open.map(orderCard)] : [el('p', { class: 'muted', text: 'Nessun ordine in corso visibile.' })]),
        el('p', { class: 'small muted', text: 'Gli ordini CardTrader Zero ancora in arrivo al magazzino (prima del pagamento finale) non vengono restituiti da CardTrader a questa app: compaiono qui quando passano a “Pagato”. Fino ad allora li vedi sul sito.' }),
        ...(closed.length ? [el('h3', { class: 'oc-h', text: `Conclusi (${closed.length})` }), ...closed.map(orderCard)] : []));
    } catch (e) {
      box.replaceChildren(el('p', { class: 'error', text: e.message }));
    }
  }
  $('ordersReload').addEventListener('click', loadOrdersView);
