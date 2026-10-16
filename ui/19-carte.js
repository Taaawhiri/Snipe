  // ---------- carte ----------
  let cards = [];
  let currentExp = null;
  let dlgExp = null; // espansione della carta aperta nel dettaglio
  let searchMode = false; // ricerca per nome su tutte le espansioni
  let searchSets = [];
  let searchTotal = 0;
  let searchIndex = null;
  let shownSets = 0;
  let searchRun = 0;
  let busyRun = 0;
  let searchTimer = null;
  let priceNote = '';
  const SETS_PER_PAGE = 8;
  let current = null;

  const LANG_NAMES = { en: 'Inglese', it: 'Italiano', jp: 'Giapponese', fr: 'Francese', de: 'Tedesco', es: 'Spagnolo', pt: 'Portoghese', ko: 'Coreano', zh: 'Cinese', ru: 'Russo', th: 'Thailandese', sconosciuta: 'Lingua non indicata' };
  // Il menu dell'alert usa "ja" per il giapponese, il server normalizza in "jp".
  const toRuleLang = (code) => (code === 'jp' ? 'ja' : code);

  /** Prezzi più bassi di una carta, per la lingua scelta nel filtro (o in totale). */
  function view(c) {
    const lang = $('cardLang').value;
    const min = $('cardCond').value === '' ? null : Number($('cardCond').value);
    if (!lang && min == null) return { lowest: c.lowest, lowestZero: c.lowestZero };
    // lc: "lingua|condizione" -> [prezzo più basso, prezzo più basso Zero]
    let lowest = null;
    let lowestZero = null;
    for (const [key, cell] of Object.entries(c.lc || {})) {
      const [code, rank] = key.split('|');
      if (lang && code !== lang) continue;
      if (min != null && Number(rank) >= 0 && Number(rank) < min) continue; // condizione ignota: non la scartiamo
      if (cell[0] != null && (lowest == null || cell[0] < lowest)) lowest = cell[0];
      if (cell[1] != null && (lowestZero == null || cell[1] < lowestZero)) lowestZero = cell[1];
    }
    return { lowest, lowestZero };
  }

  /** Quanto il prezzo mostrato è sotto la tendenza Cardmarket (0,25 = 25% in meno). null se manca uno dei due. */
  function cmDelta(c) {
    if ($('cardLang').value) return null; // il listino Cardmarket mescola le lingue: con un filtro lingua il confronto sarebbe sbagliato
    const p = $('cardPriceMode').value === 'zero' ? view(c).lowestZero : view(c).lowest;
    if (p == null || !c.cm || !(c.cm.trend > 0)) return null;
    return 1 - p / (c.cm.trend * 100);
  }

  function priceText(c) {
    const v = view(c);
    const n = $('cardPriceMode').value === 'zero' ? v.lowestZero : v.lowest;
    return n == null ? '—' : money(n, c.currency);
  }

  /** Lingue presenti nel set, ricavate dalle carte ricevute, dalla più frequente. */
  function languagesOf(list) {
    const count = {};
    for (const c of list) for (const code of Object.keys(c.langs || {})) count[code] = (count[code] || 0) + 1;
    return Object.keys(count).sort((a, b) => count[b] - count[a]);
  }

  function fillLanguages(codes) {
    const sel = $('cardLang');
    const prev = sel.value || savedLang();
    sel.replaceChildren(
      el('option', { value: '', text: codes.length ? 'Tutte le lingue' : 'Tutte (lingue non indicate)' }),
      ...codes.map((c) => el('option', { value: c, text: LANG_NAMES[c] || c.toUpperCase() })),
    );
    sel.value = codes.includes(prev) ? prev : '';
  }
  function savedLang() { try { return localStorage.getItem('snipe.cardLang') || ''; } catch { return ''; } }

  function renderCards() {
    const q = $('cardSearch').value.trim().toLowerCase();
    const zeroMode = $('cardPriceMode').value === 'zero';
    const singlesOnly = $('cardKind').value === 'single';
    const list = cards.filter((c) => (!singlesOnly || c.single !== false) && (searchMode || !q || c.name.toLowerCase().includes(q) || (c.number || '').toLowerCase() === q));
    const sort = $('cardSort').value;
    const price = (c) => (zeroMode ? view(c).lowestZero : view(c).lowest);
    if (sort === 'price-asc' || sort === 'price-desc') {
      list.sort((a, b) => {
        const pa = price(a), pb = price(b);
        if (pa == null && pb == null) return 0;
        if (pa == null) return 1; // senza annunci sempre in fondo
        if (pb == null) return -1;
        return sort === 'price-asc' ? pa - pb : pb - pa;
      });
    } else if (sort === 'cm') {
      // dalle carte più sotto Cardmarket; quelle senza confronto in fondo
      list.sort((a, b) => {
        const da = cmDelta(a), db = cmDelta(b);
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return db - da;
      });
    } else if (sort === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    $('cardGrid').replaceChildren(
      ...list.map((c, i) => {
        const shown = price(c);
        return el('div', { class: 'tile', style: `--i:${Math.min(i, 24)}` },
          el('a', { class: 'tile-go', href: cardUrl(c.id), target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Apri ${c.name} su CardTrader`, title: 'Apri su CardTrader', text: '↗' }),
          el('button', { class: 'tile-main', type: 'button', onclick: () => openCard(c) },
          el('div', { class: 'art' },
            c.image ? el('img', { src: c.image, alt: '', loading: 'lazy' }) : el('div', { class: 'noimg', text: 'Nessuna immagine' }),
            el('span', { class: 'pricepill' + (c.loading || shown == null ? ' none' : ''), text: c.loading ? '…' : priceText(c) }),
            !zeroMode && view(c).lowestZero != null ? el('span', { class: 'zeropill', text: 'Zero ' + money(view(c).lowestZero, c.currency) }) : null,
          ),
          el('div', { class: 'info' },
            el('div', { class: 'nm', text: c.name + (c.version ? ` (${c.version})` : '') }),
            el('div', { class: 'sub', text: [c.number && '#' + c.number, c.rarity].filter(Boolean).join(' · ') || ' ' }),
            c.expName ? el('div', { class: 'sub', text: c.expName }) : null,
            c.cm ? el('div', { class: 'cmtxt', text: `Cardmarket da ${money(Math.round((c.cm.low ?? c.cm.trend) * 100), c.currency)}} · tutte le lingue e condizioni` }) : null,
          ),
          ),
        );
      }),
    );
    const msg = $('cardsMsg');
    if (searchMode) {
      msg.hidden = false;
      msg.textContent = searchMessage(list);
      return;
    }
    msg.hidden = !currentExp;
    msg.textContent = !currentExp
      ? 'Scegli un’espansione per vedere le carte.'
      : list.length
        ? `${list.length} ${list.length === 1 ? 'carta' : 'carte'}${singlesOnly && cards.some((c) => c.single === false) ? ` (${cards.filter((c) => c.single === false).length} prodotti sigillati nascosti)` : ''}`
        : cards.length
          ? `Nessuna carta corrisponde a “${q}” (${cards.length} carte in questa espansione). Nelle espansioni giapponesi i nomi possono essere in giapponese: prova con il numero della carta.`
          : 'CardTrader non ha restituito carte per questa espansione.';
  }

  function splitVersion(v) {
    const parts = String(v || '').split('|').map((x) => x.trim());
    return parts.length > 1 ? { rarity: parts[0], number: parts[1] } : { rarity: null, number: null };
  }

  function searchMessage(list) {
    const q = $('cardSearch').value.trim();
    if (q.replace(/\s/g, '').length < 3) return 'Scrivi il nome di un Pokémon (almeno 3 lettere) per cercarlo in tutte le espansioni.';
    if (searchTotal === 0 && searchIndex && !searchIndex.complete) return `Indice delle carte in preparazione (${searchIndex.done}/${searchIndex.total} espansioni). Riprovo in automatico.`;
    if (searchTotal === 0 && searchIndex) return `Nessuna carta trovata per “${q}”.`;
    const idx = searchIndex && !searchIndex.complete ? ` · indice in preparazione ${searchIndex.done}/${searchIndex.total}` : '';
    const note = priceNote ? ` · ${priceNote}` : '';
    return `${list.length} carte da ${shownSets} di ${searchSets.length} espansioni${note}${idx}`;
  }

  /** Ricerca per nome su tutte le espansioni: i nomi arrivano subito, i prezzi a gruppi di espansioni. */
  async function runSearch() {
    const run = ++searchRun;
    clearTimeout(searchTimer);
    const q = $('cardSearch').value.trim();
    cards = [];
    searchSets = [];
    searchTotal = 0;
    shownSets = 0;
    priceNote = '';
    $('moreSets').hidden = true;
    if (q.replace(/\s/g, '').length < 3) { renderCards(); return; }
    $('cardsMsg').hidden = false;
    $('cardsMsg').textContent = 'Cerco…';
    $('cardGrid').replaceChildren(...Array.from({ length: 6 }, () => el('div', { class: 'skel' })));
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (run !== searchRun || !searchMode) return;
      searchSets = data.sets;
      searchTotal = data.totalCards;
      searchIndex = data.index;
      renderCards();
      await loadNextSets(run);
      if (!data.index.complete) watchIndex(run, q, data.totalCards);
    } catch (e) {
      if (run !== searchRun) return;
      $('cardGrid').replaceChildren();
      $('cardsMsg').textContent = e.message === 'Not found'
        ? 'Il server dei dati si sta ancora aggiornando: riprova tra un minuto.'
        : `Ricerca non riuscita: ${e.message}`;
    }
  }

  /** Mentre l'indice si completa ricontrolla ogni 30 secondi e rilancia la ricerca se compaiono nuove carte. */
  function watchIndex(run, q, total) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (!searchMode || run !== searchRun || $('cardSearch').value.trim() !== q) return;
      try {
        const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
        if (run !== searchRun) return;
        searchIndex = data.index;
        if (data.totalCards !== total) runSearch();
        else if (!data.index.complete) { renderCards(); watchIndex(run, q, total); }
        else renderCards();
      } catch { watchIndex(run, q, total); }
    }, 30000);
  }

  async function loadNextSets(run) {
    busyRun = run;
    $('moreSets').hidden = true;
    const batch = searchSets.slice(shownSets, shownSets + SETS_PER_PAGE);
    shownSets += batch.length;
    for (const set of batch) {
      for (const c of set.cards) {
        const sv = splitVersion(c.version);
        cards.push({ id: c.id, name: c.name, version: c.version, image: c.image, single: true, loading: true, expansionId: set.id, expName: set.name, langs: {}, lowest: null, lowestZero: null, currency: 'EUR', number: sv.number, rarity: sv.rarity });
      }
    }
    renderCards();
    let n = 0;
    for (const set of batch) {
      n++;
      if (run !== searchRun) return;
      priceNote = `carico i prezzi ${n}/${batch.length}`;
      renderCards();
      try {
        const data = await api(`/api/cards?expansion_id=${set.id}`);
        if (run !== searchRun) return;
        const byId = new Map(data.cards.map((x) => [x.id, x]));
        cards = cards.map((c) => {
          if (c.expansionId !== set.id || !c.loading) return c;
          const full = byId.get(c.id);
          return full ? { ...full, expansionId: set.id, expName: set.name, loading: false } : { ...c, loading: false };
        });
      } catch (e) {
        if (run !== searchRun) return;
        cards = cards.map((c) => (c.expansionId === set.id ? { ...c, loading: false } : c));
        priceNote = /429|limit/i.test(e.message) ? 'CardTrader sta limitando le richieste, prezzi parziali' : `prezzi non disponibili per alcune espansioni`;
        if (/429|limit/i.test(e.message)) break;
      }
      fillLanguages(languagesOf(cards));
    }
    if (run !== searchRun) return;
    if (!/limit|parziali|non disponibili/.test(priceNote)) priceNote = '';
    if (busyRun === run) busyRun = 0;
    $('moreSets').hidden = shownSets >= searchSets.length;
    renderCards();
  }
  $('moreSetsBtn').addEventListener('click', () => {
    if (busyRun === searchRun) return;
    priceNote = '';
    loadNextSets(searchRun);
  });

  async function loadCards() {
    const id = $('cardExp').value;
    searchMode = id === 'all';
    clearTimeout(searchTimer);
    searchRun++;
    $('moreSets').hidden = true;
    $('cardSearch').placeholder = searchMode ? 'Nome del Pokémon (es. Pikachu)' : 'es. Charizard';
    if (searchMode) {
      currentExp = null;
      $('setAlertBtn').hidden = true;
      cards = [];
      searchSets = [];
      searchTotal = 0;
      shownSets = 0;
      priceNote = '';
      renderCards();
      if ($('cardSearch').value.trim().length >= 3) runSearch();
      return;
    }
    currentExp = id ? expansions.find((e) => String(e.id) === id) : null;
    $('setAlertBtn').hidden = !currentExp;
    cards = [];
    renderCards();
    if (!currentExp) return;
    $('cardsMsg').hidden = false;
    $('cardsMsg').textContent = 'Carico le carte…';
    $('cardGrid').replaceChildren(...Array.from({ length: 12 }, () => el('div', { class: 'skel' })));
    try {
      const data = await api(`/api/cards?expansion_id=${currentExp.id}`);
      if (!currentExp || String(currentExp.id) !== String(data.expansionId)) return;
      cards = data.cards;
      fillLanguages(languagesOf(cards));
      renderCards();
    } catch (e) {
      $('cardsMsg').hidden = false;
      // CardTrader ha chiesto una pausa: riproviamo da soli allo scadere, con il conto alla rovescia.
      const m = /riprovo tra (\d+)s/.exec(e.message);
      if (m) {
        const exp = currentExp;
        let left = Number(m[1]) + 2;
        clearInterval(cardsRetry);
        cardsRetry = setInterval(() => {
          if (currentExp !== exp) { clearInterval(cardsRetry); return; }
          left--;
          $('cardsMsg').textContent = `CardTrader chiede una pausa: riprovo da solo tra ${Math.max(0, left)}s…`;
          if (left <= 0) { clearInterval(cardsRetry); loadCards(); }
        }, 1000);
        $('cardsMsg').textContent = `CardTrader chiede una pausa: riprovo da solo tra ${left}s…`;
        return;
      }
      $('cardsMsg').textContent = `Impossibile caricare le carte: ${e.message}`;
    }
  }
  let cardsRetry = null;
  $('cardExp').addEventListener('change', loadCards);
  let typing = null;
  $('cardSearch').addEventListener('input', () => {
    if (!searchMode) { renderCards(); return; }
    clearTimeout(typing);
    typing = setTimeout(runSearch, 500);
  });
  $('cardPriceMode').addEventListener('change', renderCards);
  $('cardKind').addEventListener('change', renderCards);
  $('cardCond').addEventListener('change', () => {
    try { localStorage.setItem('snipe.cardCond2', $('cardCond').value); } catch {}
    renderCards();
  });
  try {
    const saved = localStorage.getItem('snipe.cardCond2');
    if (saved !== null && [...$('cardCond').options].some((o) => o.value === saved)) $('cardCond').value = saved;
  } catch {}
  $('cardLang').addEventListener('change', () => {
    try { localStorage.setItem('snipe.cardLang', $('cardLang').value); } catch {}
    renderCards();
  });
  $('cardSort').addEventListener('change', renderCards);

  function renderCmBox(c) {
    const box = $('dlgCm');
    if (!c.cm) { box.hidden = true; box.replaceChildren(); $('amodeCmLabel').hidden = true; return; }
    const d = cmDelta(c);
    box.hidden = false;
    const cell = (label, cents) => (cents == null ? null : el('div', { class: 'cmcell' }, el('span', { text: label }), el('b', { text: money(Math.round(cents * 100), c.currency) })));
    const parts = [
      el('div', { class: 'cmtitle', text: 'Cardmarket · tutte le lingue e condizioni' }),
      el('div', { class: 'cmrow' }, ...[cell('tendenza', c.cm.trend), cell('media 30 giorni', c.cm.avg30), cell('più basso', c.cm.low)].filter(Boolean)),
      d == null ? null : el('div', { class: 'delta ' + (d >= 0.05 ? 'good' : d <= -0.05 ? 'bad' : ''), text: d >= 0 ? `Su CardTrader costa il ${Math.round(d * 100)}% in meno della tendenza` : `Su CardTrader costa il ${Math.round(-d * 100)}% in più della tendenza` }),
      el('div', { class: 'cmwarn', text: 'Il listino pubblico di Cardmarket non distingue lingue e condizioni: il "più basso" può essere una copia rovinata o in un’altra lingua, quindi il confronto è solo indicativo.' }),
      el('a', { href: cmSearchUrl(c), target: '_blank', rel: 'noopener noreferrer', text: 'Cerca su Cardmarket ↗' }),
    ];
    box.replaceChildren(...parts.filter(Boolean)); // replaceChildren(null) scriverebbe la parola "null"
    $('amodeCmLabel').hidden = !c.cmId;
    updateCmHint();
  }

  function updateCmHint() {
    $('alertCmLabel').textContent = `${$('alertCmPct').value}%`;
    const c = current;
    if (c && c.cm) $('alertCmHint').textContent = `Scatta sotto ${money(Math.floor(c.cm.trend * 100 * (1 - Number($('alertCmPct').value) / 100)), c.currency)} (tendenza ${money(Math.round(c.cm.trend * 100), c.currency)}, tutte le lingue e condizioni insieme). Se segui una lingua o una condizione precisa, "Sconto in %" confronta solo annunci con gli stessi filtri.`;
  }

  async function openCard(c) {
    current = c;
    dlgExp = c.expansionId ? { id: c.expansionId, name: c.expName } : currentExp;
    $('dlgName').textContent = c.name + (c.version ? ` (${c.version})` : '');
    $('dlgImg').src = c.image || '';
    if (c.cm) renderCmBox(c); else { $('dlgCm').hidden = true; $('amodeCmLabel').hidden = true; }
    renderHistory(c);
    updateWishBtn();
    if (!coll) api('/api/collection').then((d) => { coll = d; renderOwnBox(); }).catch(() => null); else renderOwnBox();
    $('dlgLink').href = cardUrl(c.id);
    $('dlgMeta').textContent = [dlgExp && dlgExp.name, c.number && '#' + c.number, c.rarity].filter(Boolean).join(' · ');
    const v = view(c);
    const lang = $('cardLang').value;
    const minRank = $('cardCond').value;
    const condNames = ['Poor', 'Heavily Played', 'Played', 'Moderately Played', 'Slightly Played', 'Near Mint', 'Mint'];
    $('alertCond').value = minRank !== '' ? condNames[Number(minRank)] : 'Slightly Played';
    $('dlgLow').textContent = v.lowest == null ? '—' : money(v.lowest, c.currency);
    $('dlgLowZero').textContent = v.lowestZero == null ? '—' : money(v.lowestZero, c.currency);
    $('dlgLangNote').replaceChildren(
      ...(lang ? [chip(`Prezzi in ${LANG_NAMES[lang] || lang.toUpperCase()}`, 'zero')] : []),
      ...(minRank !== '' ? [chip(`${condNames[Number(minRank)]} o migliore`, 'cond')] : []),
    );
    $('alertLang').value = [...$('alertLang').options].some((o) => o.value === toRuleLang(lang)) ? toRuleLang(lang) : '';
    $('alertError').hidden = true;
    $('alertOk').hidden = true;
    document.querySelector('input[name="amode"][value="price"]').checked = true;
    $('amodePrice').hidden = false;
    $('amodePercent').hidden = true;
    $('amodeCm').hidden = true;
    $('amodeDrop').hidden = true;
    $('amodeStock').hidden = true;
    const low = v.lowest;
    const base = low == null ? '' : (Math.floor((low * 0.8) / 50) * 0.5).toFixed(2);
    $('alertMax').value = base && Number(base) > 0 ? base : low == null ? '' : (low / 100).toFixed(2);
    $('dlgListings').replaceChildren(el('p', { class: 'muted', text: 'Carico gli annunci…' }));
    const d = $('cardDialog');
    openSheet(d);
    try {
      const rows = await api(`/api/listings?blueprint_id=${c.id}${dlgExp ? `&expansion_id=${dlgExp.id}` : ''}${lang ? `&lang=${lang}` : ''}${minRank !== '' ? `&minrank=${minRank}` : ''}`);
      if (current !== c) return;
      $('dlgListings').replaceChildren(
        ...(rows.length
          ? rows.map((r) =>
              el('div', { class: 'lrow-wrap' + (r.blocked ? ' blocked' : '') },
                el('a', { class: 'lrow link', href: cardUrl(c.id), target: '_blank', rel: 'noopener noreferrer', title: 'Apri su CardTrader' },
                  el('span', { class: 'p', text: money(r.cents, r.currency) }),
                  el('span', { class: 'd', text: [r.condition, r.language && r.language.toUpperCase(), r.seller && `${r.seller}${r.country ? ' (' + r.country + ')' : ''}`, r.quantity > 1 && `x${r.quantity}`].filter(Boolean).join(' · ') }),
                  r.zero ? el('span', { class: 'zero-tag', text: 'Zero' }) : null,
                  r.blocked ? el('span', { class: 'chip warn', text: 'Escluso' }) : null,
                  el('span', { class: 'go', text: '↗' }),
                ),
                r.seller ? sellerButtons(r.seller, r.country) : null,
              ),
            )
          : [el('p', { class: 'muted', text: 'Nessun annuncio in vendita.' })]),
      );
    } catch (e) {
      $('dlgListings').replaceChildren(el('p', { class: 'error', text: e.message }));
    }
  }

  document.querySelectorAll('input[name="amode"]').forEach((r) =>
    r.addEventListener('change', () => {
      const mode = document.querySelector('input[name="amode"]:checked').value;
      $('amodePrice').hidden = mode !== 'price';
      $('amodePercent').hidden = mode !== 'percent';
      $('amodeCm').hidden = mode !== 'cm';
      $('amodeDrop').hidden = mode !== 'drop';
      $('amodeStock').hidden = mode !== 'stock';
    }),
  );
  $('alertCmPct').addEventListener('input', updateCmHint);
  $('alertPct').addEventListener('input', () => ($('alertPctLabel').textContent = `${$('alertPct').value}%`));

  $('alertForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!current || !dlgExp) return;
    const mode = document.querySelector('input[name="amode"]:checked').value;
    const pct = mode === 'percent';
    $('alertError').hidden = true;
    $('alertOk').hidden = true;
    const body = {
      expansionId: dlgExp.id,
      expansionName: dlgExp.name,
      blueprintId: current.id,
      cardName: current.name + (current.version ? ` (${current.version})` : ''),
      cardImage: current.image,
      zero: $('alertZero').value,
      minCondition: $('alertCond').value,
      language: $('alertLang').value,
      minPrice: 0,
    };
    if (mode === 'cm') {
      if (!current.cmId) { $('alertError').textContent = 'Per questa carta non c’è un riferimento Cardmarket.'; $('alertError').hidden = false; return; }
      body.cmDiscount = Number($('alertCmPct').value);
      body.cmId = current.cmId;
    } else if (mode === 'drop') body.dropPct = Number($('alertDrop').value);
    else if (mode === 'stock') body.stock = true;
    else if (pct) body.minDiscount = Number($('alertPct').value);
    else {
      const v = Number($('alertMax').value);
      if (!(v > 0)) { $('alertError').textContent = 'Inserisci un prezzo maggiore di zero.'; $('alertError').hidden = false; return; }
      body.maxPrice = v;
    }
    try {
      await api('/api/rules', { method: 'POST', body: JSON.stringify(body) });
      await refresh();
      $('alertOk').textContent = 'Alert creato. Lo trovi nella scheda Regole.';
      $('alertOk').hidden = false;
    } catch (e) {
      $('alertError').textContent = e.message;
      $('alertError').hidden = false;
    }
  });

