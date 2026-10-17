  // ---------- collezione ----------
  let coll = null;
  /** Copie possedute di una carta (tutte le lingue e condizioni), per il badge "Ce l'ho" negli elenchi. */
  function ownedQty(bp) {
    if (!coll || !coll.items) return 0;
    return coll.items.filter((it) => String(it.bp) === String(bp)).reduce((t, it) => t + it.qty, 0);
  }
  function ownedBadge(bp, cls = 'own-badge') {
    const n = ownedQty(bp);
    return n ? el('span', { class: cls, title: `Ce l'hai: ${n} ${n === 1 ? 'copia' : 'copie'}`, text: n > 1 ? `✓ ×${n}` : '✓ Ce l\'ho' }) : null;
  }
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

  let collRange = 30;
  try { collRange = Number(localStorage.getItem('snipe.collRange')) || 30; } catch {}

  /** Grafico del valore della collezione: linea con area, punto finale, e al passaggio del dito data e valore. */
  function valueChart(points) {
    const ns = 'http://www.w3.org/2000/svg';
    const W = 300, H = 120, top = 8, bot = 112;
    const vals = points.map((p) => p.value).filter((v) => v > 0);
    const wrap = el('div', { class: 'vchart' });
    if (vals.length < 2) return wrap;
    const min = Math.min(...vals), max = Math.max(...vals), pad = (max - min) * 0.15 || max * 0.05 || 100;
    const lo = min - pad, hi = max + pad;
    const X = (i) => 2 + (i * (W - 4)) / (points.length - 1);
    const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * (bot - top);
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Valore della collezione nel tempo');
    const mk = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); return n; };
    for (const f of [0.25, 0.5, 0.75]) mk('line', { x1: 0, x2: W, y1: top + f * (bot - top), y2: top + f * (bot - top), class: 'vc-grid' });
    const pts = points.map((p, i) => (p.value > 0 ? `${X(i).toFixed(1)},${Y(p.value).toFixed(1)}` : null)).filter(Boolean);
    mk('polygon', { points: `${X(0)},${bot} ${pts.join(' ')} ${X(points.length - 1)},${bot}`, class: 'vc-area' });
    mk('polyline', { points: pts.join(' '), class: 'vc-line' });
    const lastI = points.length - 1;
    mk('circle', { cx: X(lastI), cy: Y(points[lastI].value || vals[vals.length - 1]), r: 4, class: 'vc-dot' });
    const xh = mk('line', { x1: 0, x2: 0, y1: top, y2: bot, class: 'vc-xh', visibility: 'hidden' });
    const tip = el('div', { class: 'vc-tip', hidden: '' });
    const fmtDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const move = (e) => {
      const r = svg.getBoundingClientRect();
      const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      const i = Math.max(0, Math.min(lastI, Math.round((cx / r.width) * lastI)));
      const p = points[i];
      if (!(p.value > 0)) return;
      xh.setAttribute('x1', X(i)); xh.setAttribute('x2', X(i)); xh.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.textContent = `${p.d ? fmtDay(p.d) : ''} · ${money(p.value)}`;
      tip.style.left = `${Math.max(56, Math.min(r.width - 56, (X(i) / W) * r.width))}px`;
      tip.style.top = `${(Y(p.value) / H) * r.height}px`;
    };
    const hide = () => { tip.hidden = true; xh.setAttribute('visibility', 'hidden'); };
    svg.addEventListener('mousemove', move);
    svg.addEventListener('touchstart', move, { passive: true });
    svg.addEventListener('touchmove', move, { passive: true });
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('touchend', () => setTimeout(hide, 1500));
    wrap.append(svg, tip);
    return wrap;
  }

  /** Mini linea degli ultimi 30 giorni di una carta: verde se sale, rossa se scende. */
  function miniSpark(vals) {
    const v = (vals || []).filter((x) => x > 0);
    if (v.length < 3) return null;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 64 22');
    svg.setAttribute('class', 'mini-spark ' + (v[v.length - 1] >= v[0] ? 'up' : 'dn'));
    svg.setAttribute('aria-hidden', 'true');
    const lo = Math.min(...v), hi = Math.max(...v);
    const pl = document.createElementNS(ns, 'polyline');
    pl.setAttribute('points', v.map((x, i) => `${((i * 62) / (v.length - 1) + 1).toFixed(1)},${(hi === lo ? 11 : 20 - ((x - lo) * 18) / (hi - lo)).toFixed(1)}`).join(' '));
    svg.append(pl);
    return svg;
  }

  function renderCollection() {
    if (!coll) return;
    $('collList').classList.remove('loading');
    $('collZero').checked = !!coll.zeroOnly;
    $('collTypical').checked = !!coll.typical;
    const { items, summary: sm, history } = coll;
    const hist = history || [];
    const days = Math.min(collRange, hist.length - 1);
    const old = hist.length > 1 ? hist[Math.max(0, hist.length - 1 - collRange)] : null;
    const ch = old && old.value ? sm.value / old.value - 1 : null;
    const chEur = old && old.value ? sm.value - old.value : null;
    const pct = (v) => `${v >= 0 ? '▲ +' : '▼ '}${(v * 100).toFixed(1).replace('.', ',')}%`;
    const gain = sm.known ? (sm.valueKnown ?? sm.value) - sm.paidPriced : null;
    $('collHero').replaceChildren(...[
      el('div', { class: 'cv-k', text: `Valore attuale (prezzo ${coll.typical ? 'tipico' : 'più basso'} CardTrader${coll.zeroOnly ? ' Zero' : ''})` }),
      el('div', { class: 'cv-row' },
        el('span', { class: 'cv-v', text: money(sm.value) }),
        ch != null ? el('span', { class: ch >= 0 ? 'up' : 'dn', text: `${chEur >= 0 ? '+' : '−'}${money(Math.abs(chEur))} (${pct(ch).replace(/^[▲▼] /, '')}) in ${days} ${days === 1 ? 'giorno' : 'giorni'}` }) : null,
      ),
      hist.length > 1 ? el('div', { class: 'chips cv-range' }, ...[[7, '7 giorni'], [30, '30 giorni'], [90, '90 giorni']].map(([d, l]) =>
        el('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(collRange === d), text: l, onclick: () => { collRange = d; try { localStorage.setItem('snipe.collRange', String(d)); } catch {} renderCollection(); } }))) : null,
      hist.length > 1 ? valueChart(hist.slice(-1 - collRange)) : el('p', { class: 'small muted', text: items.length ? 'Il grafico del valore compare dal secondo giorno.' : 'La collezione è vuota: aggiungi la prima carta.' }),
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
    const g = (it) => (it.price && it.paidCents != null ? (it.price.cents - it.paidCents) * it.qty : -Infinity);
    const list = [...items].sort((a, b) =>
      sort === 'gain' ? g(b) - g(a)
      : sort === 'set' ? (a.expName || '').localeCompare(b.expName || '') || val(b) - val(a)
      : sort === 'change' ? (b.change7 ?? -9) - (a.change7 ?? -9)
      : val(b) - val(a));
    $('collList').replaceChildren(
      ...list.map((it) => {
        const step = (d) => el('button', { type: 'button', 'aria-label': d > 0 ? 'Una copia in più' : 'Una copia in meno', text: d > 0 ? '+' : '−',
          onclick: async () => {
            if (it.qty + d <= 0 && !(await askConfirm('Puoi sempre aggiungerla di nuovo.', { title: `Togliere ${it.name} dalla collezione?`, ok: 'Togli', danger: true }))) return;
            saveOwn({ ...it, qty: it.qty + d });
          } });
        const g = it.price && it.paidCents != null ? (it.price.cents - it.paidCents) * it.qty : null;
        return el('div', { class: 'ci' + (g == null ? '' : g > 0 ? ' gain' : g < 0 ? ' loss' : '') },
          thumb(it.image),
          el('div', { class: 'ci-main' },
            el('button', { class: 't linklike', type: 'button', text: it.name, onclick: () => openCard({ id: it.bp, name: it.name, image: it.image, expansionId: it.expansionId, expName: it.expName, currency: 'EUR', cmId: it.cmId }) }),
            el('div', { class: 's', text: [it.expName, it.cond && condShort(it.cond), it.lang && it.lang.toUpperCase()].filter(Boolean).join(' · ') }),
            el('div', { class: 'qty' }, step(-1), el('b', { text: String(it.qty) }), step(1),
              it.paidCents != null ? el('span', { class: 's', text: it.paidCents === 0 ? (it.qty > 1 ? 'trovate (0 €)' : 'trovata (0 €)') : it.qty > 1 ? `pagate ${money(it.paidCents)} l'una` : `pagata ${money(it.paidCents)}` }) : null),
          ),
          el('div', { class: 'r' },
            el('b', { text: it.price ? money(it.price.cents * it.qty) : '…' }),
            it.qty > 1 && it.price ? el('span', { class: 's', text: `${money(it.price.cents)} l'una` }) : null,
            gainPill(it),
            miniSpark(it.spark30),
            it.change7 != null && Math.abs(it.change7) >= 0.005 ? el('span', { class: 'trend ' + (it.change7 >= 0 ? 'up' : 'dn'), text: `${it.change7 >= 0 ? '▲' : '▼'} ${Math.round(Math.abs(it.change7) * 100)}% 7g` }) : null,
            it.price && it.price.approx ? el('span', { class: 's', title: 'Nessun annuncio nella tua lingua e condizione: prezzo più basso in assoluto', text: '≈ altra lingua' }) : null,
          ),
        );
      }),
    );
  }

  /** Guadagno o perdita rispetto al prezzo pagato: importo e percentuale in una pillola colorata. */
  function gainPill(it) {
    if (!it.price || it.paidCents == null) return null;
    const diff = (it.price.cents - it.paidCents) * it.qty;
    const pct = it.paidCents ? (it.price.cents / it.paidCents - 1) * 100 : null; // pagata 0: tutto guadagno, senza percentuale
    const cls = diff > 0 ? 'up' : diff < 0 ? 'dn' : 'eq';
    const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
    return el('span', { class: `gain-pill ${cls}`, title: `Pagata ${money(it.paidCents * it.qty)}` },
      el('b', { text: `${sign}${money(Math.abs(diff))}` }),
      pct == null ? el('span', { text: 'gratis' }) : el('span', { text: `${sign}${Math.abs(pct).toFixed(0)}%` }),
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
      document.createTextNode(` ${condShort(it.cond)} · ${(it.lang || '').toUpperCase()}${it.paidCents != null ? ` · ${money(it.paidCents)}` : ''}`),
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
    const btn = $('ownAdd');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Aggiungo…';
    try {
      await saveOwn({
        bp: current.id, name: current.name + (current.version ? ` (${current.version})` : ''), image: current.image,
        expansionId: current.expansionId || (dlgExp && dlgExp.id), expName: current.expName || (dlgExp && dlgExp.name), cmId: current.cmId,
        lang: own.lang, cond: own.cond, qty: own.qty, add: true,
        paidCents: $('ownPaid').value.trim() !== '' && paid >= 0 ? Math.round(paid * 100) : null,
      });
      $('ownPaid').value = '';
      $('ownDialog').close();
      toast(`✓ Aggiunta alla collezione${own.qty > 1 ? ` (${own.qty} copie)` : ''}`);
    } catch (e) {
      $('ownError').textContent = e.message;
      $('ownError').hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

