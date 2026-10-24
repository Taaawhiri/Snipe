  // ---------- collezione ----------
  let coll = null;
  let collPaid = 'all'; // filtro provenienza: acquistate (prezzo > 0), trovate (0 €), senza prezzo pagato
  let collEra = 'all'; // filtro epoca: moderne o vintage (WOTC ed EX, come nel selettore delle espansioni)
  let collType = 'all'; // filtro per tipo: Pokémon, allenatori, energie
  let collRev = 'all'; // filtro variante: tutte, reverse holo, non reverse
  let collKind = 'all'; // filtro rapido: tutte, non gradate, gradate
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

  /** "Cosa è cambiato": le copie il cui valore è cambiato nelle ultime 24 ore, dalle variazioni più grandi. */
  function recentChanges(items) {
    const ch = items.filter((it) => it.delta && it.delta.cents).map((it) => ({ it, d: it.delta.cents * it.qty }))
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    if (!ch.length) return null;
    const tot = ch.reduce((t, x) => t + x.d, 0);
    const row = ({ it, d }) => el('button', { class: 'rc-row', type: 'button', onclick: () => {
      const n = document.querySelector(`#collList .ci[data-key="${CSS.escape(it.key)}"]`);
      if (n) { n.scrollIntoView({ behavior: 'smooth', block: 'center' }); n.classList.add('flash'); setTimeout(() => n.classList.remove('flash'), 1600); }
    } }, el('span', { class: 'rc-n', text: it.name.replace(/\s*\(.*\)\s*$/, '') + (it.qty > 1 ? ` ×${it.qty}` : '') }),
      el('b', { class: d >= 0 ? 'up' : 'dn', text: `${d >= 0 ? '+' : '−'}${money(Math.abs(d))}` }));
    const box = el('details', { class: 'recent-ch' },
      el('summary', null, el('span', { text: `Cambiati nelle ultime 24 ore: ${ch.length}` }), el('b', { class: tot >= 0 ? 'up' : 'dn', text: `${tot >= 0 ? '+' : '−'}${money(Math.abs(tot))}` })),
      el('div', { class: 'rc-list' }, ...ch.slice(0, 15).map(row)));
    return box;
  }

  /** Spiegazione del prezzo di una copia: da quale annuncio parte e quali rapporti di mercato usa. */
  function explainPrice(it) {
    const p = it.price;
    const lines = [];
    const LN = { en: 'EN', jp: 'JP', it: 'IT', fr: 'FR', de: 'DE', es: 'ES', pt: 'PT', ko: 'KO', zh: 'ZH' };
    if (p.cmCapped) {
      lines.push(`Hai scelto di usare la tendenza Cardmarket per questa copia: ${money(p.cents)}. Su CardTrader ci sono pochi annunci e il più basso è ${money(p.ctCents)}.`);
      lines.push('Attenzione: il prezzo Cardmarket è uno solo per carta e NON dipende dalla condizione né dalla lingua della tua copia. È solo un riferimento indicativo.');
    } else if (p.est && p.est.from) {
      const f = p.est.from;
      lines.push(`Nessun annuncio uguale alla tua copia (${[it.first ? '1ª ed.' : '', it.reverse ? 'Reverse' : '', isGradeLabel(it.cond) ? it.cond : condShort(it.cond), (it.lang || '').toUpperCase()].filter(Boolean).join(' · ')}).`);
      if (it.reverse) lines.push('Per una reverse holo si guardano solo gli annunci reverse; la condizione si converte con i rapporti di mercato (per esempio Slightly Played → Near Mint).');
      lines.push(`Si parte dall'annuncio più vicino: ${money(f.cents)} · ${[f.first ? '1ª ed.' : '', f.q, LN[f.lang] || f.lang.toUpperCase()].filter(Boolean).join(' · ')}.`);
      for (const x of p.est.parts) lines.push(`× ${String(x.r).replace('.', ',')}  ${x.label} (${x.scope}, ${x.n} carte)`);
      lines.push(`= ${money(p.cents)}. Stima di mercato (badge ambra): i rapporti sono le mediane dei prezzi delle stesse carte in vendita su CardTrader e si aggiornano da soli.`);
    } else if (p.estimated) {
      lines.push('Stima con regole fisse (badge grigio): i rapporti di mercato per questo caso si basano ancora su meno di 20 carte.');
      lines.push(p.fromCm ? 'Nessun annuncio su CardTrader: si parte dalla tendenza Cardmarket della carta. Attenzione: il prezzo Cardmarket è uno solo per carta e NON dipende dalla condizione né dalla lingua della tua copia.' : `Nessun annuncio ${it.cond}: si parte da ${p.how || 'copie non gradate'}.`);
      if (p.rawCents != null && isGradeLabel(it.cond)) lines.push(`Valore di base: ${money(p.rawCents)} × premio fisso del voto ${it.cond}, mai meno della carta più una quota del costo di gradazione.`);
    } else {
      if (p.approx) lines.push('Stima semplice (badge grigio): i rapporti di mercato per questo caso si basano ancora su meno di 20 carte.');
      if (p.revApprox) lines.push(it.reverse ? 'Nessun annuncio reverse holo: è il prezzo delle copie normali.' : 'Ci sono solo annunci reverse holo: è il loro prezzo.');
      if (p.edApprox) lines.push('Nessun annuncio 1ª edizione: è il prezzo delle copie normali.');
      if (p.approx && !p.edApprox && !p.revApprox) lines.push(`Nessun annuncio nella tua lingua (${(it.lang || '').toUpperCase()}) e condizione: prezzo più basso tra tutti${p.lowLang ? `, in ${p.lowLang.toUpperCase()}` : ''}.`);
      if (p.histAnomaly) lines.push(`Oggi l'annuncio più basso è ${money(p.histAnomaly.low)}, meno della metà del solito per questa copia. Si usa la mediana degli ultimi ${p.histAnomaly.days} giorni: ${money(p.histAnomaly.med)}.`);
      else if (!p.approx && p.skipped && p.skipped.length) lines.push(`Annuncio con la stessa combinazione della tua copia: il più basso affidabile. Ignorat${p.skipped.length > 1 ? 'i' : 'o'} ${p.skipped.map((c) => money(c)).join(' e ')}, molto sotto gli altri (circa ${money(p.skipRef)}): probabile errore, copia rovinata o svendita.`);
      else if (!p.approx) lines.push('Annuncio con la stessa combinazione della tua copia: il più basso.');
    }
    if (p.notZero) lines.push('Nessun annuncio Zero adatto: prezzo tra tutti i venditori.');
    if (p.ts) lines.push(`Annunci letti: ${new Date(p.ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${p.v ? ` · calcolo v${p.v}` : ' · calcolo vecchio, in aggiornamento'}.`);
    if (p.cmCapped) dialog({ title: 'Come è calcolato', text: lines.join('\n\n'), ok: 'Torna a CardTrader', cancel: 'Chiudi' }).then((v) => { if (v) saveOwn({ ...it, cmPrice: false, add: false }); });
    else dialog({ title: 'Come è calcolato', text: lines.join('\n\n') });
  }
  const isEstimate = (p) => !!(p && (p.cmCapped || p.estimated || p.approx || p.histAnomaly || (p.skipped && p.skipped.length)));

  /** Scritta sotto il prezzo (stima, altra edizione/lingua, non Zero): si tocca per sapere come è calcolato. */
  function collPriceNote(it) {
    const p = it.price;
    if (!p) return null;
    const text = p.cmCapped ? '≈ Cardmarket (generico)'
      : p.est ? '≈ stima di mercato'
      : p.estimated ? (p.fromCm ? '≈ Cardmarket (generico)' : '≈ stima dal voto')
      : p.revApprox ? '≈ altra variante'
      : p.edApprox ? '≈ altra edizione'
      : p.approx ? `≈ altra lingua${p.lowLang && p.lowLang !== it.lang ? ` (${p.lowLang.toUpperCase()})` : ''}`
      : p.histAnomaly ? '≈ prezzo insolito, uso lo storico'
      : p.skipped && p.skipped.length ? '≈ prezzo anomalo ignorato'
      : p.notZero ? '≈ non Zero' : '';
    if (!text) return null;
    return el('button', { class: 's linklike', type: 'button', text, onclick: () => explainPrice(it) });
  }


  const cmCappableUi = (it) => !isGradeLabel(it.cond) && !it.first && !it.reverse;

  /** "Da verificare": pochi annunci, o prezzo molto lontano dalla tendenza Cardmarket (solo dove il confronto ha senso). */
  function collCheckNote(it) {
    const p = it.price;
    if (!p || p.estimated || p.cmCapped || p.approx) return null;
    const why = [];
    if (p.listings > 0 && p.listings <= 2) why.push(`Per la tua combinazione ${p.listings === 1 ? "c'è un solo annuncio" : 'ci sono solo 2 annunci'}: il prezzo più basso può essere un caso isolato.`);
    const comparable = !isGradeLabel(it.cond) && !it.first && !it.reverse && it.lang === 'en' && it.cmCents > 0;
    if (comparable) {
      const r = p.cents / it.cmCents - 1;
      if (Math.abs(r) > 0.4) why.push(`Il prezzo su CardTrader (${money(p.cents)}) è ${r < 0 ? 'molto sotto' : 'molto sopra'} la tendenza Cardmarket (${money(it.cmCents)}), il ${Math.round(Math.abs(r) * 100)}% in ${r < 0 ? 'meno' : 'più'}. Il prezzo Cardmarket non dipende da condizione né lingua, ma conviene dare un'occhiata.`);
    }
    if (!why.length) return null;
    // Con 1 o 2 annunci si può scegliere, a mano, di usare la tendenza Cardmarket per questa copia.
    const canCm = p.listings > 0 && p.listings <= 2 && cmCappableUi(it) && it.cmCents > 0;
    if (canCm) why.push(`Se preferisci, per questa copia puoi usare la tendenza Cardmarket: ${money(it.cmCents)} (indicativa: non dipende da condizione né lingua).`);
    return el('button', { class: 's linklike', type: 'button', text: '⚠ da verificare', onclick: () => {
      if (!canCm) { dialog({ title: 'Da verificare', text: why.join('\n\n') }); return; }
      dialog({ title: 'Da verificare', text: why.join('\n\n'), ok: 'Usa Cardmarket', cancel: 'Chiudi' }).then((v) => { if (v) saveOwn({ ...it, cmPrice: true, add: false }); });
    } });
  }

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

  // ---------- selezione multipla (tieni premuto su una carta) ----------
  const collSel = new Set(); // chiavi delle carte selezionate
  let collSelMode = false;
  function setSelMode(on) {
    closeSwipe();
    collSelMode = on;
    if (!on) collSel.clear();
    document.documentElement.classList.toggle('coll-selecting', on);
    if (!on && $('collSelBar')) $('collSelBar').hidden = true;
    renderCollection();
  }
  function toggleSel(key) {
    if (collSel.has(key)) collSel.delete(key); else collSel.add(key);
    if (!collSel.size) { setSelMode(false); return; }
    renderCollection();
  }
  /** Tieni premuto mezzo secondo: entra in selezione. In selezione un tocco seleziona o deseleziona. */
  function bindLongPress(row, it) {
    let timer = null;
    let start = null;
    let fired = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    row.addEventListener('pointerdown', (e) => {
      if (collSelMode) return;
      fired = false;
      start = [e.clientX, e.clientY];
      timer = setTimeout(() => {
        fired = true;
        if (navigator.vibrate) try { navigator.vibrate(15); } catch {}
        collSel.add(it.key);
        setSelMode(true);
      }, 500);
    });
    row.addEventListener('pointermove', (e) => { if (timer && start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) cancel(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) row.addEventListener(ev, cancel);
    row.addEventListener('contextmenu', (e) => e.preventDefault()); // niente menu del browser con la pressione lunga
    // In selezione i tocchi non aprono la carta né cambiano le copie: selezionano.
    row.addEventListener('click', (e) => {
      if (fired) { fired = false; e.preventDefault(); e.stopPropagation(); return; }
      if (!collSelMode) return;
      e.preventDefault();
      e.stopPropagation();
      toggleSel(it.key);
    }, true);
  }
  // ---------- scorri a sinistra per eliminare una carta ----------
  const SWIPE_OPEN = 104; // larghezza del pulsante Elimina
  let openSwipe = null;
  function closeSwipe() {
    if (!openSwipe) return;
    openSwipe.style.transform = '';
    openSwipe.closest('.ci-wrap').classList.remove('swiped');
    openSwipe = null;
  }
  function bindSwipe(wrap, row) {
    let x0 = null, y0 = null, dx = 0, dragging = false, base = 0;
    row.addEventListener('pointerdown', (e) => {
      if (collSelMode || e.pointerType === 'mouse') return; // sul computer basta ✎ o la selezione
      x0 = e.clientX; y0 = e.clientY; dx = 0; dragging = false;
      base = openSwipe === row ? -SWIPE_OPEN : 0;
      if (openSwipe && openSwipe !== row) closeSwipe();
    });
    row.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!dragging) {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { x0 = null; return; } // sta scorrendo la lista
        if (Math.abs(mx) < 12) return;
        dragging = true;
        row.classList.add('dragging');
      }
      dx = Math.max(-SWIPE_OPEN - 30, Math.min(0, base + mx));
      row.style.transform = `translateX(${dx}px)`;
      wrap.classList.toggle('swiped', dx < -8);
    });
    const end = () => {
      if (x0 == null) return;
      x0 = null;
      row.classList.remove('dragging');
      if (!dragging) return;
      // Bloccare il click che segue il trascinamento (non deve aprire la carta).
      row.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); }, { capture: true, once: true });
      if (dx < -SWIPE_OPEN / 2) { row.style.transform = `translateX(${-SWIPE_OPEN}px)`; wrap.classList.add('swiped'); openSwipe = row; }
      else { row.style.transform = ''; wrap.classList.remove('swiped'); if (openSwipe === row) openSwipe = null; }
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
  }
  document.addEventListener('pointerdown', (e) => { if (openSwipe && !e.target.closest('.ci-wrap.swiped')) closeSwipe(); });

  function renderSelBar() {
    let bar = $('collSelBar');
    if (!bar) { bar = el('div', { id: 'collSelBar', class: 'sel-bar', role: 'toolbar', 'aria-label': 'Carte selezionate' }); document.body.append(bar); }
    const visibleKeys = [...document.querySelectorAll('#collList .ci[data-key]')].map((x) => x.dataset.key);
    bar.hidden = !collSelMode;
    if (!collSelMode) return;
    const all = visibleKeys.length && visibleKeys.every((k) => collSel.has(k));
    bar.replaceChildren(
      el('button', { class: 'sb-x', type: 'button', 'aria-label': 'Annulla selezione', text: '✕', onclick: () => setSelMode(false) }),
      el('b', { class: 'sb-n', text: `${collSel.size} ${collSel.size === 1 ? 'selezionata' : 'selezionate'}` }),
      el('button', { class: 'sb-all', type: 'button', text: all ? 'Nessuna' : 'Tutte', onclick: () => { if (all) visibleKeys.forEach((k) => collSel.delete(k)); else visibleKeys.forEach((k) => collSel.add(k)); if (!collSel.size) setSelMode(false); else renderCollection(); } }),
      el('button', { class: 'sb-del', type: 'button', text: '🗑 Elimina', onclick: deleteSelected }),
    );
  }
  async function deleteSelected() {
    const items = ((coll && coll.items) || []).filter((it) => collSel.has(it.key));
    if (!items.length) return;
    const copies = items.reduce((t, it) => t + it.qty, 0);
    const ok = await askConfirm('Puoi sempre aggiungerle di nuovo.', { title: `Togliere ${items.length} ${items.length === 1 ? 'carta' : 'carte'} dalla collezione${copies > items.length ? ` (${copies} copie)` : ''}?`, ok: 'Elimina', danger: true });
    if (!ok) return;
    // Si esce subito dalla selezione e le carte spariscono dalla lista: l'eliminazione è una sola richiesta al server.
    const keys = items.map((it) => it.key);
    setSelMode(false);
    if (coll && coll.items) { coll = { ...coll, items: coll.items.filter((it) => !keys.includes(it.key)) }; try { renderCollection(); } catch {} }
    toast(`Elimino ${items.length} ${items.length === 1 ? 'carta' : 'carte'}…`);
    try {
      const res = await api('/api/collection/remove', { method: 'POST', body: JSON.stringify({ keys }) });
      if (res && res.items) coll = res;
      toast(`✓ ${items.length} ${items.length === 1 ? 'carta tolta' : 'carte tolte'} dalla collezione`);
    } catch (e) {
      toast(`Eliminazione non riuscita: ${e.message}`, 'err');
    }
    await loadCollection(); // valore e grafico ricalcolati dal server
    renderOwnBox();
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && collSelMode) setSelMode(false); });

  function renderCollection() {
    if (!coll) return;
    $('collList').classList.remove('loading');
    $('collZero').checked = !!coll.zeroOnly;
    $('collTypical').checked = !!coll.typical;
    $('collReliable').checked = coll.reliable !== false;
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
      recentChanges(items),
      coll.refreshing ? el('div', { class: 'scan-wait small' }, el('span', { class: 'spinner' }), el('span', { text: `Ricalcolo i prezzi di ${coll.refreshing} ${coll.refreshing === 1 ? 'carta' : 'carte'}…` })) : null,
      sm.missing && !coll.refreshing ? el('p', { class: 'small muted', text: coll.zeroOnly
        ? `${sm.missing} ${sm.missing === 1 ? 'copia' : 'copie'} senza un prezzo Zero: nessun venditore Zero la offre ora, oppure il prezzo arriva entro un'ora.`
        : `${sm.missing} ${sm.missing === 1 ? 'copia' : 'copie'} ancora senza prezzo: arriva entro un'ora.` }) : null,
      coll.limit < coll.unlimited ? el('p', { class: 'small muted', text: `${items.length} su ${coll.limit} carte diverse incluse nel tuo piano.` }) : null,
    ].filter(Boolean)); // replaceChildren(null) scriverebbe la parola "null"
    const sort = (document.querySelector('input[name="csort"]:checked') || {}).value || 'value';
    const val = (it) => (it.price ? it.price.cents * it.qty : -1);
    const g = (it) => (it.price && it.paidCents != null ? (it.price.cents - it.paidCents) * it.qty : -Infinity);
    // Ricerca per nome della carta o dell'espansione (anche con il numero: "charizard 4").
    const cq = plainText($('collSearch').value).trim();
    $('collSearch').closest('.coll-tools').hidden = !items.length;
    // Filtro rapido gradate / non gradate (compare solo se ci sono entrambe).
    const nG = items.filter((it) => isGradeLabel(it.cond)).length;
    $('collKindG').hidden = !nG || nG === items.length;
    if ($('collKindG').hidden) collKind = 'all';
    $('collKind').replaceChildren(...[['all', `Tutte (${items.length})`], ['raw', `Non gradate (${items.length - nG})`], ['graded', `Gradate (${nG})`]].map(([v, l]) =>
      el('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(collKind === v), text: l, onclick: () => { collKind = v; renderCollection(); } })));
    const kindOk = (it) => collKind === 'all' || (collKind === 'graded') === isGradeLabel(it.cond);
    // Filtro per tipo: compare solo se in collezione ci sono almeno due tipi diversi.
    const nT = { pokemon: 0, trainer: 0, energy: 0 };
    items.forEach((it) => { nT[cardType(it.name)]++; });
    $('collTypeG').hidden = Object.values(nT).filter(Boolean).length < 2;
    if ($('collTypeG').hidden) collType = 'all';
    $('collType').replaceChildren(...[['all', `Tutti i tipi`], ['pokemon', `Pokémon (${nT.pokemon})`], ['trainer', `Allenatori (${nT.trainer})`], ['energy', `Energie (${nT.energy})`]]
      .filter(([v]) => v === 'all' || nT[v]).map(([v, l]) =>
        el('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(collType === v), text: l, onclick: () => { collType = v; renderCollection(); } })));
    const typeOk = (it) => collType === 'all' || cardType(it.name) === collType;
    // Epoca: dall'elenco delle espansioni (vintage = era WOTC o EX).
    const vint = new Map(expansions.map((e) => [e.id, !!e.vintage]));
    const eraOf = (it) => (vint.get(it.expansionId) ? 'vintage' : 'modern');
    const nE = { modern: 0, vintage: 0 };
    items.forEach((it) => { nE[eraOf(it)]++; });
    $('collEraG').hidden = !expansions.length || !nE.modern || !nE.vintage;
    if ($('collEraG').hidden) collEra = 'all';
    $('collEra').replaceChildren(...[['all', 'Tutte le epoche'], ['modern', `Moderne (${nE.modern})`], ['vintage', `🕰️ Vintage (${nE.vintage})`]].map(([v, l]) =>
      el('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(collEra === v), text: l, onclick: () => { collEra = v; renderCollection(); } })));
    const eraOk = (it) => collEra === 'all' || eraOf(it) === collEra;
    // Provenienza: dal prezzo pagato (0 € = trovata, in una busta o regalata).
    const paidOf = (it) => (it.paidCents == null ? 'none' : it.paidCents === 0 ? 'found' : 'bought');
    const nP = { bought: 0, found: 0, none: 0 };
    items.forEach((it) => { nP[paidOf(it)]++; });
    $('collPaidG').hidden = Object.values(nP).filter(Boolean).length < 2;
    if ($('collPaidG').hidden) collPaid = 'all';
    $('collPaid').replaceChildren(...[['all', 'Tutte le provenienze'], ['bought', `Acquistate (${nP.bought})`], ['found', `Trovate (${nP.found})`], ['none', `Senza prezzo pagato (${nP.none})`]]
      .filter(([v]) => v === 'all' || nP[v]).map(([v, l]) =>
        el('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(collPaid === v), text: l, onclick: () => { collPaid = v; renderCollection(); } })));
    const paidOk = (it) => collPaid === 'all' || paidOf(it) === collPaid;
    // Variante: compare solo se in collezione ci sono reverse holo.
    const nR = items.filter((it) => it.reverse).length;
    $('collRevG').hidden = !nR || nR === items.length;
    if ($('collRevG').hidden) collRev = 'all';
    $('collRev').replaceChildren(...[['all', 'Tutte'], ['rev', `Reverse holo (${nR})`], ['normal', `Non reverse (${items.length - nR})`]].map(([v, l]) =>
      el('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(collRev === v), text: l, onclick: () => { collRev = v; renderCollection(); } })));
    const revOk = (it) => collRev === 'all' || (collRev === 'rev') === !!it.reverse;
    // Rarità: dal nome salvato "Charizard ex (Special Illustration Rare | 199/165)".
    const rarOf = (it) => { const m = /\(([^()]*)\)\s*$/.exec(it.name || ''); return m ? rarityFromVersion(m[1]) : ''; };
    const rc = new Map();
    items.forEach((it) => { const r = rarOf(it); if (r) rc.set(r, (rc.get(r) || 0) + 1); });
    const rsel = $('collRarity');
    const rprev = rsel.value;
    rsel.replaceChildren(el('option', { value: '', text: 'Tutte le rarità' }), ...[...rc].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([r, n]) => el('option', { value: r, text: `${r} (${n})` })));
    rsel.value = rc.has(rprev) ? rprev : '';
    cselSync(rsel);
    $('collRarityG').hidden = rc.size < 2 && !rsel.value;
    const rar = rsel.value;
    const rarOk = (it) => !rar || rarOf(it) === rar;
    // Filtri attivi: pillole con × sotto la ricerca e numero sul pulsante (come negli alert).
    const lbl = (box) => { const b = box.querySelector('[aria-pressed="true"]'); return b ? b.textContent.replace(/\s*\(\d+\)$/, '') : ''; };
    const activeF = [
      collType !== 'all' && [lbl($('collType')), () => { collType = 'all'; }],
      rar && [rar, () => { $('collRarity').value = ''; cselSync($('collRarity')); }],
      collEra !== 'all' && [lbl($('collEra')), () => { collEra = 'all'; }],
      collPaid !== 'all' && [lbl($('collPaid')), () => { collPaid = 'all'; }],
      collKind !== 'all' && [lbl($('collKind')), () => { collKind = 'all'; }],
      collRev !== 'all' && [lbl($('collRev')), () => { collRev = 'all'; }],
    ].filter(Boolean);
    $('collFilterCount').hidden = !activeF.length;
    $('collFilterCount').textContent = String(activeF.length);
    $('collActive').hidden = !activeF.length || !$('collFilters').hidden;
    $('collActive').replaceChildren(
      ...activeF.map(([label, clear]) => el('button', { class: 'af-chip', type: 'button', 'aria-label': `Togli il filtro ${label}`, onclick: () => { clear(); renderCollection(); } }, el('span', { text: label }), el('b', { text: '×', 'aria-hidden': 'true' }))),
      ...(activeF.length > 1 ? [el('button', { class: 'af-clear', type: 'button', text: 'Azzera tutti', onclick: resetCollFilters })] : []));
    const shownItems = items.filter((it) => kindOk(it) && typeOk(it) && eraOk(it) && paidOk(it) && revOk(it) && rarOk(it) && (!cq || cq.split(/\s+/).every((w) => plainText(`${it.name} ${it.expName || ''} ${it.cond || ''}`).includes(w))));
    $('collFilterClose').textContent = `Mostra ${shownItems.length} ${shownItems.length === 1 ? 'carta' : 'carte'}`;
    $('collCount').hidden = !cq && collKind === 'all' && collType === 'all' && collEra === 'all' && collPaid === 'all' && collRev === 'all' && !rar;
    $('collCount').textContent = shownItems.length ? `${shownItems.length} ${shownItems.length === 1 ? "carta" : "carte"} su ${items.length}` : `Nessuna carta per “${$('collSearch').value.trim()}”`;
    const list = [...shownItems].sort((a, b) =>
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
        const row = el('div', { class: 'ci' + (g == null ? '' : g > 0 ? ' gain' : g < 0 ? ' loss' : '') + (collSel.has(it.key) ? ' picked' : ''), 'data-key': it.key },
          isGradeLabel(it.cond) ? slabView(it.cond, it.image, it.name, 'slab-sm') : thumb(it.image),
          el('div', { class: 'ci-main' },
            el('button', { class: 't linklike', type: 'button', text: it.name, onclick: () => openCard({ id: it.bp, name: it.name, image: it.image, expansionId: it.expansionId, expName: it.expName, currency: 'EUR', cmId: it.cmId }) }),
            el('div', { class: 's' },
              isGradeLabel(it.cond) ? el('span', { class: 'grade-badge', text: it.cond }) : null,
              document.createTextNode([it.expName, it.first && '1ª ed.', it.reverse && 'Reverse', !isGradeLabel(it.cond) && it.cond && condShort(it.cond), it.lang && it.lang.toUpperCase()].filter(Boolean).join(' · '))),
            el('div', { class: 'qty' }, step(-1), el('b', { text: String(it.qty) }), step(1),
              el('button', { class: 'ci-edit', type: 'button', 'aria-label': `Modifica ${it.name}`, title: 'Modifica prezzo, condizione, lingua', text: '✎', onclick: () => openOwnEdit(it) }),
              el('button', { class: 'ci-more', type: 'button', 'aria-label': `Aggiungi un'altra versione di ${it.name}`, title: 'Aggiungi la stessa carta in un\'altra lingua o condizione', text: '＋ Versione', onclick: () => addVersion(it) }),
              it.paidCents != null ? el('span', { class: 's', text: it.paidCents === 0 ? (it.qty > 1 ? 'trovate (0 €)' : 'trovata (0 €)') : it.qty > 1 ? `pagate ${money(it.paidCents)} l'una` : `pagata ${money(it.paidCents)}` }) : null),
          ),
          el('div', { class: 'r' },
            el('div', { class: 'price-line' },
              // STIMA ambra = calcolata con i rapporti di mercato; STIMA grigia = regole fisse, dati di mercato ancora insufficienti.
              isEstimate(it.price) ? el('button', { class: 'est-badge' + (it.price.est ? '' : ' fallback'), type: 'button', title: 'Valore stimato: tocca per sapere come', text: 'STIMA', onclick: () => explainPrice(it) }) : null,
              el('b', { text: it.price ? `${isEstimate(it.price) ? '≈ ' : ''}${money(it.price.cents * it.qty)}` : it.noListings ? '—' : '…' })),
            it.qty > 1 && it.price ? el('span', { class: 's', text: `${money(it.price.cents)} l'una` }) : null,
            gainPill(it),
            miniSpark(it.spark30),
            it.change7 != null && Math.abs(it.change7) >= 0.005 ? el('span', { class: 'trend ' + (it.change7 >= 0 ? 'up' : 'dn'), text: `${it.change7 >= 0 ? '▲' : '▼'} ${Math.round(Math.abs(it.change7) * 100)}% 7g` }) : null,
            collPriceNote(it),
            collCheckNote(it),
            it.cmCents > 0 ? el('button', { class: 's linklike', type: 'button', text: `Cardmarket ${money(it.cmCents)}`, title: 'Prezzo generico per carta, non per condizione né lingua. Tocca per il confronto.', onclick: () => openCard({ id: it.bp, name: it.name, image: it.image, expansionId: it.expansionId, expName: it.expName, currency: 'EUR', cmId: it.cmId }) }) : null,
            !it.price && isGradeLabel(it.cond) ? el('span', { class: 's', text: `nessun annuncio ${it.cond}` }) : null,
          ),
        );
        bindLongPress(row, it);
        // Scorri a sinistra: compare "Elimina" dietro la carta.
        const del = el('button', { class: 'ci-swipe-del', type: 'button', 'aria-label': `Elimina ${it.name}`, text: '🗑 Elimina', tabindex: '-1',
          onclick: async () => {
            if (!(await askConfirm('Puoi sempre aggiungerla di nuovo.', { title: `Togliere ${it.name} dalla collezione?`, ok: 'Elimina', danger: true }))) { closeSwipe(); return; }
            await saveOwn({ ...it, qty: 0 });
            toast('✓ Carta tolta dalla collezione');
          } });
        const wrap = el('div', { class: 'ci-wrap' }, del, row);
        bindSwipe(wrap, row);
        return wrap;
      }),
    );
    renderSelBar();
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
    $('ordersView').hidden = v !== 'orders';
    if (v === 'coll') loadCollection();
    if (v === 'orders') loadOrdersView();
  }
  document.querySelectorAll('input[name="hview"]').forEach((r) => r.addEventListener('change', () => { hviewChosen = true; try { localStorage.setItem('snipe.hview', r.value); } catch {} setHview(r.value); }));
  document.querySelectorAll('input[name="csort"]').forEach((r) => r.addEventListener('change', renderCollection));
  $('collSearch').addEventListener('input', renderCollection);
  $('collRarity').addEventListener('change', renderCollection);
  // Pannello filtri a scomparsa dal basso (come i selettori): si chiude con Mostra, toccando fuori o con Esc.
  const toggleCollFilters = (open) => {
    $('collFilters').hidden = !open;
    $('collFilterBtn').setAttribute('aria-expanded', String(open));
    $('collFiltersBg').hidden = !open;
    document.documentElement.classList.toggle('noscroll', open);
    renderCollection();
  };
  function resetCollFilters() {
    collType = 'all'; collEra = 'all'; collPaid = 'all'; collKind = 'all'; collRev = 'all';
    $('collRarity').value = ''; cselSync($('collRarity'));
    renderCollection();
  }
  $('collFilterBtn').addEventListener('click', () => toggleCollFilters($('collFilters').hidden));
  $('collFilterClose').addEventListener('click', () => toggleCollFilters(false));
  $('collFiltersBg').addEventListener('click', () => toggleCollFilters(false));
  $('collFiltersX').addEventListener('click', () => toggleCollFilters(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('collFilters').hidden) toggleCollFilters(false); });
  $('collFilterReset').addEventListener('click', resetCollFilters);
  $('collTypical').addEventListener('change', async () => {
    $('collList').classList.add('loading');
    await saveSettings({ collTypical: $('collTypical').checked });
    loadCollection();
  });
  $('collReliable').addEventListener('change', async () => {
    $('collList').classList.add('loading');
    await saveSettings({ collReliable: $('collReliable').checked });
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
  const own = { qty: 1, lang: 'en', cond: 'Near Mint', gco: '', g: '10', first: false, reverse: false };
  const GRADE_COS = [['', 'No'], ['PSA', 'PSA'], ['BGS', 'BGS'], ['CGC', 'CGC'], ['SGC', 'SGC'], ['ACE', 'ACE'], ['TAG', 'TAG'], ['PCG', 'PCG']];
  const GRADES = ['10', '9.5', '9', '8.5', '8', '7.5', '7', '6', '5'].map((g) => [g, g]);
  const isGradeLabel = (c) => /^(PSA|BGS|CGC|SGC|ACE|TAG|PCG) /.test(String(c || ''));
  // Condizione da salvare: per una copia gradata è "PSA 10", e il valore si calcola solo sulle gradate uguali.
  const ownCond = () => (own.gco ? `${own.gco} ${own.g}` : own.cond);
  let ownEditing = null; // carta della collezione che si sta modificando (null = si aggiunge)

  /**
   * Slab disegnata per le copie gradate: custodia trasparente, etichetta con società e voto, e dentro
   * l'immagine della carta di CardTrader. Colori per società, senza loghi ufficiali.
   */
  function slabView(label, image, name, cls = '') {
    const [co, g] = String(label).split(' ');
    const gold = co === 'BGS' && Number(g) >= 9.5;
    return el('div', { class: `slab ${co.toLowerCase()}${gold ? ' gold' : ''} ${cls}`.trim(), role: 'img', 'aria-label': `${name || 'Carta'} gradata ${label}` },
      el('div', { class: 'slab-label' },
        el('span', { class: 'sl-l' }, el('span', { class: 'sl-co', text: co }), el('span', { class: 'sl-nm', text: name || '' })),
        el('span', { class: 'sl-g', text: g })),
      image ? el('img', { class: 'slab-card', src: image, alt: '', loading: 'lazy' }) : el('div', { class: 'slab-card ph' }));
  }

  /** Modifica di una carta già in collezione: copie, lingua, condizione e prezzo pagato nello stesso pannello. */
  function openOwnEdit(it) {
    ownEditing = it;
    current = { id: it.bp, name: it.name, image: it.image, expName: it.expName, expansionId: it.expansionId, cmId: it.cmId };
    $('ownName').textContent = 'Modifica';
    $('ownCardName').textContent = it.name;
    $('ownCardSet').textContent = it.expName || '';
    $('ownImg').src = it.image || '';
    $('ownError').hidden = true;
    own.qty = it.qty;
    own.lang = it.lang || 'en';
    own.first = !!it.first;
    own.reverse = !!it.reverse;
    if (isGradeLabel(it.cond)) { const [co, g] = it.cond.split(' '); own.gco = co; own.g = g; own.cond = 'Near Mint'; }
    else { own.gco = ''; own.cond = it.cond || 'Near Mint'; }
    $('ownPaid').value = it.paidCents != null ? (it.paidCents / 100).toFixed(2) : '';
    $('ownAdd').textContent = 'Salva modifiche';
    $('ownList').replaceChildren();
    renderOwnSheet();
    openSheet($('ownDialog'));
  }
  $('ownDialog').addEventListener('close', () => { ownEditing = null; $('ownAdd').textContent = 'Aggiungi alla collezione'; });

  function pills(box, items, value, onPick) {
    box.replaceChildren(...items.map(([v, label]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), class: 'pill' + (v === value ? ' on' : ''), text: label, onclick: () => onPick(v) })));
  }

  function renderOwnSheet() {
    $('ownQtyOut').textContent = String(own.qty);
    pills($('ownLangs'), OWN_LANGS, own.lang, (v) => { own.lang = v; renderOwnSheet(); });
    pills($('ownConds'), OWN_CONDS, own.cond, (v) => { own.cond = v; renderOwnSheet(); });
    pills($('ownRev'), [['', 'Non reverse'], ['1', 'Reverse holo']], own.reverse ? '1' : '', (v) => { own.reverse = v === '1'; renderOwnSheet(); });
    pills($('ownFirst'), [['', 'Normale'], ['1', '1ª edizione']], own.first ? '1' : '', (v) => { own.first = v === '1'; renderOwnSheet(); });
    pills($('ownGradeCos'), GRADE_COS, own.gco, (v) => { own.gco = v; renderOwnSheet(); });
    pills($('ownGrades'), GRADES, own.g, (v) => { own.g = v; renderOwnSheet(); });
    $('ownGrades').hidden = !own.gco;
    $('ownCondField').hidden = !!own.gco;
    // Anteprima: con una società scelta l'immagine della carta compare dentro la slab.
    const img = $('ownImg');
    const prev = img.parentNode.querySelector('.slab');
    if (prev) prev.remove();
    img.hidden = !!own.gco;
    if (own.gco) img.after(slabView(`${own.gco} ${own.g}`, img.getAttribute('src'), $('ownCardName').textContent, 'slab-own'));
  }

  function renderOwnBox() {
    if (!current) return;
    const mine = ((coll && coll.items) || []).filter((it) => it.bp === current.id);
    const n = mine.reduce((t, it) => t + it.qty, 0);
    $('ownTitle').textContent = n ? `✓ Ce l'ho · ${n}` : "＋ Ce l'ho";
    // Nella scheda della carta: quanto vale la tua copia (lo stesso valore della collezione, con STIMA se stimato).
    const mineBox = $('dlgMine');
    mineBox.hidden = !mine.length;
    mineBox.replaceChildren(...mine.map((it) => el('div', { class: 'dm-row' },
      el('span', { class: 'dm-k', text: `La tua copia · ${[it.first ? '1ª ed.' : '', it.reverse ? 'Reverse' : '', isGradeLabel(it.cond) ? it.cond : condShort(it.cond), (it.lang || '').toUpperCase()].filter(Boolean).join(' · ')}${it.qty > 1 ? ` · ×${it.qty}` : ''}` }),
      el('span', { class: 'dm-v' },
        it.price && isEstimate(it.price) ? el('button', { class: 'est-badge' + (it.price.est ? '' : ' fallback'), type: 'button', text: 'STIMA', onclick: () => explainPrice(it) }) : null,
        el('b', { text: it.price ? `${isEstimate(it.price) ? '≈ ' : ''}${money(it.price.cents)}` : it.noListings ? '—' : '…' })))));
    $('ownOpen').classList.toggle('on', n > 0);
    $('ownList').replaceChildren(...mine.map((it) => el('span', { class: 'own-chip' },
      el('b', { text: `${it.qty}×` }),
      document.createTextNode(` ${it.first ? '1ª ed. · ' : ''}${it.reverse ? 'Reverse · ' : ''}${condShort(it.cond)} · ${(it.lang || '').toUpperCase()}${it.paidCents != null ? ` · ${money(it.paidCents)}` : ''}`),
      el('button', { type: 'button', 'aria-label': 'Togli', text: '✕', onclick: () => saveOwn({ ...it, qty: 0 }) }),
    )));
  }

  /** Apre "Ce l'ho" per una carta qualsiasi (es. dallo scanner), con lingua già proposta; onDone dopo il salvataggio. */
  let ownDone = null;
  function openOwnAdd(c, lang, onDone, slab, first = false, reverse = false) {
    current = c;
    ownDone = onDone || null;
    $('ownName').textContent = "Ce l'ho";
    ownEditing = null;
    own.gco = '';
    $('ownAdd').textContent = 'Aggiungi alla collezione';
    $('ownCardName').textContent = c.name + (c.version ? ` (${c.version})` : '');
    $('ownCardSet').textContent = c.expName || '';
    $('ownImg').src = c.image || '';
    $('ownError').hidden = true;
    $('ownPaid').value = '';
    own.qty = 1;
    if (lang && OWN_LANGS.some(([v]) => v === lang)) own.lang = lang;
    own.cond = 'Near Mint';
    if (slab && GRADE_COS.some(([v]) => v === slab.co)) { own.gco = slab.co; own.g = slab.g; }
    own.first = !!first;
    own.reverse = !!reverse;
    renderOwnSheet();
    renderOwnBox();
    openSheet($('ownDialog'));
  }

  /** Stessa carta in un'altra lingua, condizione o variante: si apre "Ce l'ho" già pronto, senza foto né ricerca. */
  function addVersion(it) {
    const owned = new Set(coll.items.filter((x) => x.bp === it.bp).map((x) => x.lang));
    const lang = (OWN_LANGS.find(([v]) => !owned.has(v)) || ['en'])[0];
    openOwnAdd({ id: it.bp, name: it.name, image: it.image, expansionId: it.expansionId, expName: it.expName, cmId: it.cmId }, lang, null);
  }

  $('ownOpen').addEventListener('click', () => {
    ownDone = null;
    if (!current) return;
    $('ownName').textContent = "Ce l'ho";
    ownEditing = null;
    own.gco = '';
    own.first = false;
    own.reverse = false;
    $('ownAdd').textContent = 'Aggiungi alla collezione';
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
      if (ownEditing) {
        const it = ownEditing;
        const paidCents = $('ownPaid').value.trim() !== '' && paid >= 0 ? Math.round(paid * 100) : null;
        // Lingua o condizione diverse = un'altra riga della collezione: si toglie la vecchia e si scrive la nuova.
        if (own.lang !== (it.lang || '') || ownCond() !== (it.cond || '') || own.first !== !!it.first || own.reverse !== !!it.reverse) await saveOwn({ ...it, qty: 0 });
        await saveOwn({ ...it, lang: own.lang, cond: ownCond(), first: own.first, reverse: own.reverse, qty: own.qty, paidCents, add: false });
        $('ownPaid').value = '';
        $('ownDialog').close();
        toast('✓ Modifiche salvate');
        return;
      }
      await saveOwn({
        bp: current.id, name: current.name + (current.version ? ` (${current.version})` : ''), image: current.image,
        expansionId: current.expansionId || (dlgExp && dlgExp.id), expName: current.expName || (dlgExp && dlgExp.name), cmId: current.cmId,
        lang: own.lang, cond: ownCond(), first: own.first, reverse: own.reverse, qty: own.qty, add: true,
        paidCents: $('ownPaid').value.trim() !== '' && paid >= 0 ? Math.round(paid * 100) : null,
      });
      $('ownPaid').value = '';
      $('ownDialog').close();
      toast(`✓ Aggiunta alla collezione${own.qty > 1 ? ` (${own.qty} copie)` : ''}`);
      if (ownDone) { const f = ownDone; ownDone = null; f(); }
    } catch (e) {
      $('ownError').textContent = e.message;
      $('ownError').hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

