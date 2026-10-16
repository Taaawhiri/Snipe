  // ---------- collezione ----------
  let coll = null;
  let hviewChosen = false;

  let collPoll = null;
  async function loadCollection() {
    try {
      coll = await api('/api/collection');
      renderCollection();
      // Prezzi in ricalcolo sul server: ricontrolliamo tra qualche secondo.
      clearTimeout(collPoll);
      if (coll.refreshing) collPoll = setTimeout(() => { if (!$('collView').hidden) loadCollection(); }, 5000);
    } catch (e) {
      $('collHero').replaceChildren(el('p', { class: 'error', text: e.message }));
    }
  }

  function spark(points, keys) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 300 70');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'spark');
    const vals = points.flatMap((p) => keys.map(([k]) => p[k])).filter((v) => v > 0);
    if (points.length < 2 || !vals.length) return svg;
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const x = (i) => (i * 300) / (points.length - 1);
    const y = (v) => (hi === lo ? 35 : 64 - ((v - lo) * 58) / (hi - lo));
    for (const [k, cls] of keys) {
      const pts = points.map((p, i) => (p[k] > 0 ? `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}` : null)).filter(Boolean);
      if (pts.length < 2) continue;
      const pl = document.createElementNS(ns, 'polyline');
      pl.setAttribute('points', pts.join(' '));
      pl.setAttribute('class', cls);
      svg.append(pl);
    }
    return svg;
  }

  function renderCollection() {
    if (!coll) return;
    $('collList').classList.remove('loading');
    $('collZero').checked = !!coll.zeroOnly;
    $('collTypical').checked = !!coll.typical;
    const { items, summary: sm, history } = coll;
    const hist = history || [];
    const old = hist.length > 1 ? hist[Math.max(0, hist.length - 31)] : null;
    const ch = old && old.value ? sm.value / old.value - 1 : null;
    const pct = (v) => `${v >= 0 ? '▲ +' : '▼ '}${(v * 100).toFixed(1).replace('.', ',')}%`;
    const gain = sm.paidPriced ? sm.value - sm.paidPriced : null;
    $('collHero').replaceChildren(...[
      el('div', { class: 'cv-k', text: `Valore attuale (prezzo ${coll.typical ? 'tipico' : 'più basso'} CardTrader${coll.zeroOnly ? ' Zero' : ''})` }),
      el('div', { class: 'cv-row' },
        el('span', { class: 'cv-v', text: money(sm.value) }),
        ch != null ? el('span', { class: ch >= 0 ? 'up' : 'dn', text: `${pct(ch)} in ${Math.min(30, hist.length - 1)} giorni` }) : null,
      ),
      hist.length > 1 ? spark(hist, [['cm', 'cm'], ['value', 'ct']]) : el('p', { class: 'small muted', text: items.length ? 'Il grafico del valore compare dal secondo giorno.' : 'La collezione è vuota: aggiungi la prima carta.' }),
      sm.cm ? el('div', { class: 'small muted legend' }, el('span', { class: 'lg-ct', text: 'CardTrader' }), el('span', { class: 'lg-cm', text: `Cardmarket (tendenza ${money(sm.cm)})` })) : null,
      el('div', { class: 'cv-stats' },
        el('div', null, el('b', { text: String(sm.qty) }), el('span', { text: `carte (${sm.distinct} diverse)` })),
        el('div', null, el('b', { text: sm.paid ? money(sm.paid) : '—' }), el('span', { text: 'spesi' })),
        el('div', null, el('b', { class: gain == null ? '' : gain >= 0 ? 'up' : 'dn', text: gain == null ? '—' : `${gain >= 0 ? '+' : ''}${money(gain)}` }), el('span', { text: 'guadagno teorico' })),
      ),
      coll.refreshing ? el('div', { class: 'scan-wait small' }, el('span', { class: 'spinner' }), el('span', { text: `Ricalcolo i prezzi di ${coll.refreshing} ${coll.refreshing === 1 ? 'carta' : 'carte'}…` })) : null,
      sm.missing && !coll.refreshing ? el('p', { class: 'small muted', text: coll.zeroOnly
        ? `${sm.missing} ${sm.missing === 1 ? 'copia' : 'copie'} senza un prezzo Zero: nessun venditore Zero la offre ora, oppure il prezzo arriva entro un'ora.`
        : `${sm.missing} ${sm.missing === 1 ? 'copia' : 'copie'} ancora senza prezzo: arriva entro un'ora.` }) : null,
      coll.limit < coll.unlimited ? el('p', { class: 'small muted', text: `${items.length} su ${coll.limit} carte diverse incluse nel tuo piano.` }) : null,
    ].filter(Boolean)); // replaceChildren(null) scriverebbe la parola "null"
    const sort = (document.querySelector('input[name="csort"]:checked') || {}).value || 'value';
    const val = (it) => (it.price ? it.price.cents * it.qty : -1);
    const g = (it) => (it.price && it.paidCents ? (it.price.cents - it.paidCents) * it.qty : -Infinity);
    const list = [...items].sort((a, b) =>
      sort === 'gain' ? g(b) - g(a)
      : sort === 'set' ? (a.expName || '').localeCompare(b.expName || '') || val(b) - val(a)
      : sort === 'change' ? (b.change7 ?? -9) - (a.change7 ?? -9)
      : val(b) - val(a));
    $('collList').replaceChildren(
      ...list.map((it) => {
        const step = (d) => el('button', { type: 'button', 'aria-label': d > 0 ? 'Una copia in più' : 'Una copia in meno', text: d > 0 ? '+' : '−',
          onclick: () => {
            if (it.qty + d <= 0 && !window.confirm(`Togliere ${it.name} dalla collezione?`)) return;
            saveOwn({ ...it, qty: it.qty + d });
          } });
        const g = it.price && it.paidCents ? (it.price.cents - it.paidCents) * it.qty : null;
        return el('div', { class: 'ci' + (g == null ? '' : g > 0 ? ' gain' : g < 0 ? ' loss' : '') },
          thumb(it.image),
          el('div', { class: 'ci-main' },
            el('button', { class: 't linklike', type: 'button', text: it.name, onclick: () => openCard({ id: it.bp, name: it.name, image: it.image, expansionId: it.expansionId, expName: it.expName, currency: 'EUR', cmId: it.cmId }) }),
            el('div', { class: 's', text: [it.expName, it.cond && condShort(it.cond), it.lang && it.lang.toUpperCase()].filter(Boolean).join(' · ') }),
            el('div', { class: 'qty' }, step(-1), el('b', { text: String(it.qty) }), step(1),
              it.paidCents ? el('span', { class: 's', text: it.qty > 1 ? `pagate ${money(it.paidCents)} l'una` : `pagata ${money(it.paidCents)}` }) : null),
          ),
          el('div', { class: 'r' },
            el('b', { text: it.price ? money(it.price.cents * it.qty) : '…' }),
            it.qty > 1 && it.price ? el('span', { class: 's', text: `${money(it.price.cents)} l'una` }) : null,
            gainPill(it),
            it.change7 != null && Math.abs(it.change7) >= 0.005 ? el('span', { class: 'trend ' + (it.change7 >= 0 ? 'up' : 'dn'), text: `${it.change7 >= 0 ? '▲' : '▼'} ${Math.round(Math.abs(it.change7) * 100)}% 7g` }) : null,
            it.price && it.price.approx ? el('span', { class: 's', title: 'Nessun annuncio nella tua lingua e condizione: prezzo più basso in assoluto', text: '≈ altra lingua' }) : null,
            it.cmCents ? el('span', { class: 's', text: `CM ${money(it.cmCents)}` }) : null,
          ),
        );
      }),
    );
  }

  /** Guadagno o perdita rispetto al prezzo pagato: importo e percentuale in una pillola colorata. */
  function gainPill(it) {
    if (!it.price || !it.paidCents) return null;
    const diff = (it.price.cents - it.paidCents) * it.qty;
    const pct = (it.price.cents / it.paidCents - 1) * 100;
    const cls = diff > 0 ? 'up' : diff < 0 ? 'dn' : 'eq';
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
    return el('span', { class: `gain-pill ${cls}`, title: `Pagata ${money(it.paidCents * it.qty)}` },
      el('b', { text: `${sign}${money(Math.abs(diff))}` }),
      el('span', { text: `${sign}${Math.abs(pct).toFixed(0)}%` }),
    );
  }

  const condShort = (c) => ({ Mint: 'M', 'Near Mint': 'NM', 'Slightly Played': 'SP', 'Moderately Played': 'MP', Played: 'PL', 'Heavily Played': 'HP', Poor: 'PO' })[c] || c;

  async function saveOwn(b) {
    coll = await api('/api/collection', { method: 'POST', body: JSON.stringify(b) });
    renderCollection();
    renderOwnBox();
  }

  function setHview(v) {
    document.querySelector(`input[name="hview"][value="${v}"]`).checked = true;
    $('collView').hidden = v !== 'coll';
    $('alertsView').hidden = v !== 'alerts';
    if (v === 'coll') loadCollection();
  }
  document.querySelectorAll('input[name="hview"]').forEach((r) => r.addEventListener('change', () => { hviewChosen = true; setHview(r.value); }));
  document.querySelectorAll('input[name="csort"]').forEach((r) => r.addEventListener('change', renderCollection));
  $('collTypical').addEventListener('change', async () => {
    $('collList').classList.add('loading');
    await saveSettings({ collTypical: $('collTypical').checked });
    loadCollection();
  });
  $('collZero').addEventListener('change', async () => {
    $('collList').classList.add('loading');
    await saveSettings({ collZero: $('collZero').checked });
    loadCollection();
  });

  /** "Ce l'ho": pulsante nel dettaglio carta e pannello per aggiungere copie. */
  const OWN_LANGS = [['en', 'EN'], ['jp', 'JP'], ['it', 'IT'], ['fr', 'FR'], ['de', 'DE'], ['es', 'ES'], ['pt', 'PT'], ['ko', 'KO'], ['zh', 'ZH']];
  const OWN_CONDS = [['Mint', 'M'], ['Near Mint', 'NM'], ['Slightly Played', 'SP'], ['Moderately Played', 'MP'], ['Played', 'PL'], ['Heavily Played', 'HP'], ['Poor', 'PO']];
  const own = { qty: 1, lang: 'en', cond: 'Near Mint' };

  function pills(box, items, value, onPick) {
    box.replaceChildren(...items.map(([v, label]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), class: 'pill' + (v === value ? ' on' : ''), text: label, onclick: () => onPick(v) })));
  }

  function renderOwnSheet() {
    $('ownQtyOut').textContent = String(own.qty);
    pills($('ownLangs'), OWN_LANGS, own.lang, (v) => { own.lang = v; renderOwnSheet(); });
    pills($('ownConds'), OWN_CONDS, own.cond, (v) => { own.cond = v; renderOwnSheet(); });
  }

  function renderOwnBox() {
    if (!current) return;
    const mine = ((coll && coll.items) || []).filter((it) => it.bp === current.id);
    const n = mine.reduce((t, it) => t + it.qty, 0);
    $('ownTitle').textContent = n ? `✓ Ce l'ho · ${n}` : "＋ Ce l'ho";
    $('ownOpen').classList.toggle('on', n > 0);
    $('ownList').replaceChildren(...mine.map((it) => el('span', { class: 'own-chip' },
      el('b', { text: `${it.qty}×` }),
      document.createTextNode(` ${condShort(it.cond)} · ${(it.lang || '').toUpperCase()}${it.paidCents ? ` · ${money(it.paidCents)}` : ''}`),
      el('button', { type: 'button', 'aria-label': 'Togli', text: '✕', onclick: () => saveOwn({ ...it, qty: 0 }) }),
    )));
  }

  $('ownOpen').addEventListener('click', () => {
    if (!current) return;
    $('ownName').textContent = "Ce l'ho";
    $('ownCardName').textContent = current.name + (current.version ? ` (${current.version})` : '');
    $('ownCardSet').textContent = current.expName || (dlgExp && dlgExp.name) || '';
    $('ownImg').src = current.image || '';
    $('ownError').hidden = true;
    own.qty = 1;
    const lf = $('cardLang').value;
    if (lf && OWN_LANGS.some(([v]) => v === lf)) own.lang = lf;
    renderOwnSheet();
    renderOwnBox();
    openSheet($('ownDialog'));
  });
  $('ownMinus').addEventListener('click', () => { own.qty = Math.max(1, own.qty - 1); renderOwnSheet(); });
  $('ownPlus').addEventListener('click', () => { own.qty = Math.min(999, own.qty + 1); renderOwnSheet(); });

  $('ownAdd').addEventListener('click', async () => {
    if (!current) return;
    $('ownError').hidden = true;
    const paid = Number($('ownPaid').value);
    try {
      await saveOwn({
        bp: current.id, name: current.name + (current.version ? ` (${current.version})` : ''), image: current.image,
        expansionId: current.expansionId || (dlgExp && dlgExp.id), expName: current.expName || (dlgExp && dlgExp.name), cmId: current.cmId,
        lang: own.lang, cond: own.cond, qty: own.qty, add: true,
        paidCents: paid > 0 ? Math.round(paid * 100) : null,
      });
      $('ownPaid').value = '';
      $('ownDialog').close();
    } catch (e) {
      $('ownError').textContent = e.message;
      $('ownError').hidden = false;
    }
  });

