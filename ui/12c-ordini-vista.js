  // ---------- scheda "Ordini": i tuoi acquisti su CardTrader, in corso e conclusi (sola lettura) ----------
  const ORDER_STATES = {
    pending: ['In attesa', 'wait'], hub_pending: ['In attesa del magazzino CardTrader', 'wait'], paid: ['Pagato, da spedire', 'wait'], sent: ['Spedito', 'go'],
    arrived: ['Arrivato', 'ok'], done: ['Concluso', 'ok'], request_for_cancel: ['Annullamento richiesto', 'bad'], canceled: ['Annullato', 'bad'], cancelled: ['Annullato', 'bad'], refunded: ['Rimborsato', 'bad'], expired: ['Scaduto', 'bad'], lost: ['Smarrito', 'bad'],
  };
  const ORDER_CLOSED = ['done', 'canceled', 'cancelled', 'lost', 'refunded', 'expired']; // tutto il resto, anche uno stato mai visto, è "in corso"

  /** Una carta dell'ordine: miniatura, nome, quanto l'hai pagata, quanto vale ora e il tasto per metterla in collezione. */
  function orderItemRow(it, ctx) {
    const tags = [it.condition && condShort(it.condition), it.lang && (ORD_LANG[it.lang] || it.lang.toUpperCase()), it.reverse && 'Reverse', it.first && '1ª ed.', it.graded && 'gradata'].filter(Boolean).join(' · ');
    const paid = it.paidCents != null ? it.paidCents : it.cents != null ? it.cents : null; // la lista porta "cents", i dettagli "paidCents"
    const now = it.nowCents;
    const diff = paid && now != null ? now / paid - 1 : null;
    const add = it.inColl || it.imported
      ? el('span', { class: 'oi-in', text: '✓ In collezione' })
      : !it.iid || it.graded ? null
      : el('button', { class: 'oi-add', type: 'button', text: '＋ Collezione', onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        b.textContent = 'Aggiungo…';
        try {
          await api('/api/orders/import', { method: 'POST', body: JSON.stringify({ iids: [it.iid] }) });
          it.imported = true;
          ctx.redraw();
          toast('✓ Aggiunta alla collezione');
          loadCollection();
        } catch (err) { b.disabled = false; b.textContent = '＋ Collezione'; alert(err.message); }
      } });
    return el('div', { class: 'oi-row' },
      thumb(it.image),
      el('div', { class: 'oi-main' },
        el('b', { text: `${it.qty > 1 ? it.qty + '× ' : ''}${it.name}` }),
        el('small', { text: [it.expansion, it.number && `#${it.number}`, tags].filter(Boolean).join(' · ') }),
        ...(add ? [add] : [])),
      el('div', { class: 'oi-prices' },
        paid != null ? el('span', { class: 'oi-paid' }, el('i', { text: 'Pagata' }), el('b', { text: money(paid * (it.qty || 1)) })) : null,
        now != null ? el('span', { class: 'oi-now' }, el('i', { text: 'Ora' }), el('b', { text: money(now * (it.qty || 1)) }), ...(diff != null && Math.abs(diff) >= 0.005 ? [el('em', { class: diff > 0 ? 'up' : 'down', text: `${diff > 0 ? '▲ +' : '▼ '}${Math.round(diff * 100)}%` })] : [])) : null));
  }

  function orderCard(o, autoOpen) {
    const [label, kind] = ORDER_STATES[o.state] || [o.state || 'Stato sconosciuto', 'wait'];
    const d = (t) => { const x = t ? new Date(t) : null; return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString('it-IT') : null; };
    const when = o.sentAt ? `spedito il ${d(o.sentAt)}` : o.paidAt ? `pagato il ${d(o.paidAt)}` : null;
    const body = el('div', { class: 'oc-body' });
    let open = !!autoOpen;
    let det = null; // dettagli letti (miniature, prezzi attuali)
    let tries = 0;
    const ctx = { redraw: () => draw() };
    const toggle = el('button', { class: 'btn mini oc-toggle', type: 'button' });
    function draw() {
      // Righe dell'elenco e dei dettagli unite (per codice riga): se una delle due ne ha di più, nessuna carta sparisce.
      const base = new Map((o.items || []).map((it) => [it.iid, it]));
      for (const it of (det ? det.items : [])) base.set(it.iid, { ...(base.get(it.iid) || {}), ...it });
      const rows = [...base.values()];
      const qty = rows.reduce((t, it) => t + (it.qty || 1), 0);
      const fresh = rows.filter((it) => !it.inColl && !it.imported && !it.graded && it.iid);
      toggle.textContent = open ? 'Nascondi le carte' : `Mostra le carte (${o.size || rows.length})`;
      body.hidden = !open;
      body.replaceChildren(
        ...(open ? [
          ...rows.map((it) => orderItemRow(it, ctx)),
          ...((o.size || 0) > qty ? [el('div', { class: 'small muted', text: `Mostro ${qty} carte su ${o.size} dell'ordine: le altre non mi arrivano da CardTrader.` })] : []),
          ...(!det ? [el('div', { class: 'small muted', text: 'Carico miniature e prezzi attuali…' })] : []),
          ...(det && det.pending && tries < 4 ? [el('div', { class: 'small muted', text: 'Prezzi attuali in arrivo…' })] : []),
          ...(fresh.length > 1 ? [el('button', { class: 'btn mini', type: 'button', text: `＋ Aggiungi le ${fresh.length} nuove alla collezione`, onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              const r = await api('/api/orders/import', { method: 'POST', body: JSON.stringify({ iids: fresh.map((it) => it.iid) }) });
              fresh.forEach((it) => { it.imported = true; });
              toast(`✓ ${r.added} ${r.added === 1 ? 'carta aggiunta' : 'carte aggiunte'}${r.skipped ? `, ${r.skipped} sotto ${money(r.min)} non aggiunte` : ''}`);
              draw();
              loadCollection();
            } catch (err) { e.currentTarget.disabled = false; alert(err.message); }
          } })] : []),
        ] : []));
    }
    async function loadDetails() {
      try {
        det = await api(`/api/orders/details?id=${o.id}`);
        draw();
        if (det.pending && tries++ < 4) setTimeout(() => { if (open && document.body.contains(body)) loadDetails(); }, 7000);
      } catch (e) {
        det = { items: o.items || [], pending: 0 };
        draw();
      }
    }
    toggle.onclick = () => { open = !open; draw(); if (open && !det) loadDetails(); };
    draw();
    if (open) loadDetails();
    return el('div', { class: 'order-card' },
      el('div', { class: 'oc-head' }, el('b', { text: `Ordine ${o.code || o.id}` }), el('span', { class: `oc-state ${kind}`, text: label })),
      el('div', { class: 'small muted', text: [o.seller && `da ${o.seller}`, when, o.zero && 'CardTrader Zero', o.totalCents != null && `totale ${money(o.totalCents, o.currency)}`].filter(Boolean).join(' · ') }),
      body, toggle,
      ...(o.shipping && o.shipping.name ? [el('div', { class: 'small', text: `Spedizione: ${o.shipping.name}${o.shipping.cents != null ? ` (${money(o.shipping.cents)})` : ''}${o.shipping.days && !ORDER_CLOSED.includes(o.state) && o.state !== 'arrived' ? ` · consegna stimata entro ${o.shipping.days} giorni` : ''}` })] : []),
      ...(o.tracking ? [o.trackingUrl ? el('a', { class: 'small', href: o.trackingUrl, target: '_blank', rel: 'noopener noreferrer', text: `Segui il pacco: ${o.tracking} ↗` }) : el('div', { class: 'small', text: `Tracciamento: ${o.tracking}` })] : []),
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
        ...(open.length ? [el('h3', { class: 'oc-h', text: `In corso (${open.length})` }), ...open.map((o) => orderCard(o, true))] : [el('p', { class: 'muted', text: 'Nessun ordine in corso visibile.' })]),
        el('p', { class: 'small muted', text: 'Gli ordini CardTrader Zero ancora in arrivo al magazzino (prima del pagamento finale) non vengono restituiti da CardTrader a questa app: compaiono qui quando passano a “Pagato”. Fino ad allora li vedi sul sito.' }),
        ...(closed.length ? [el('h3', { class: 'oc-h', text: `Conclusi (${closed.length})` }), ...closed.map((o, i) => orderCard(o, i < 2))] : []));
    } catch (e) {
      box.replaceChildren(el('p', { class: 'error', text: e.message }));
    }
  }
  $('ordersReload').addEventListener('click', loadOrdersView);
