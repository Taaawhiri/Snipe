  // ---------- render ----------
  /** Stato del controllo di un alert: 'ok' (regolare), 'slow' (in ritardo), 'stop' (fermo, in pausa o fuori piano). */
  function checkState(r) {
    const c = (state.checks || {})[r.id] || {};
    if (!r.enabled) return { st: 'stop', c, why: 'Alert in pausa: non viene controllato' };
    if ((state.outOfPlan || []).includes(r.id)) return { st: 'stop', c, why: 'Oltre il limite del piano: non viene controllato' };
    if (!c.ts) return { st: 'slow', c, why: c.restarted && Date.now() - c.restarted < 15 * 60_000 ? 'App appena aggiornata: il controllo riparte entro pochi minuti' : 'Succede entro pochi minuti' };
    const cycle = (state.status && state.status.cycle && state.status.cycle.ms) || 5 * 60_000;
    const age = Date.now() - c.ts;
    if (age <= Math.max(cycle * 1.5, 5 * 60_000)) return { st: 'ok', c };
    // Dopo un aggiornamento dell'app il giro riparte da capo: gli alert non ancora riletti sono "in ripartenza", non in ritardo.
    if (c.restarted && c.ts < c.restarted && Date.now() - c.restarted < 30 * 60_000) return { st: 'slow', c, restart: true, why: 'App appena aggiornata: il controllo riparte entro pochi minuti' };
    if (age <= 30 * 60_000) return { st: 'slow', c, why: state.system && state.system.limitUntil ? 'In ritardo: CardTrader sta rallentando le richieste' : 'In ritardo rispetto al solito giro' };
    return { st: 'stop', c, why: 'Non controllato da oltre 30 minuti' };
  }
  /** "Ora il più basso": il prezzo minore tra gli annunci che rispettano i criteri dell'alert, confrontato con la soglia. */
  function nowLine(r) {
    const c = (state.checks || {})[r.id];
    if (!c || !c.ts || c.listings == null || !r.enabled) return null;
    if (c.bestCents == null) {
      return el('div', { class: 'now-line none', text: c.listings ? `Nessun annuncio con i tuoi criteri (${c.listings} in tutto)` : 'Nessun annuncio in vendita' });
    }
    const cur = c.currency || 'EUR';
    const max = r.blueprintId || r.maxPriceCents ? r.maxPriceCents : 0;
    let rel = null;
    if (max) {
      const gap = c.bestCents - max;
      rel = gap <= 0 ? el('span', { class: 'nl-rel ok', text: 'sotto la soglia ✓' }) : el('span', { class: 'nl-rel over', text: `${money(gap, cur)} sopra la soglia` });
    }
    const old = c.infoTs && Date.now() - c.infoTs > 10 * 60_000 ? el('span', { class: 'nl-age', text: `letto ${ago(c.infoTs)}` }) : null;
    return el('div', { class: 'now-line' }, el('span', { class: 'nl-k', text: 'Ora il più basso' }), el('b', { text: money(c.bestCents, cur) }), ...(rel ? [rel] : []), ...(old ? [old] : []));
  }

  const openChecks = new Set();
  function checkRow(r) {
    const { st, c, why } = checkState(r);
    const now = Date.now();
    // 12 barrette = ultima ora a passi di 5 minuti, la più recente a destra.
    const bars = Array.from({ length: 12 }, (_, i) => {
      const from = now - (12 - i) * 300_000, to = from + 300_000;
      return el('i', { class: (c.reads || []).some((t) => t >= from && t < to) ? '' : 'miss' });
    });
    const n = (c.reads || []).length;
    const title = st === 'stop' && !c.ts ? 'Non controllato' : c.ts ? `Controllato ${ago(c.ts)} fa`.replace(' fa fa', ' fa') : 'In attesa del primo controllo';
    // Intervallo medio tra due letture nell'ultima ora: dice quanto in fretta si vede un annuncio nuovo.
    const rd = (c.reads || []).slice().sort((a, b) => a - b);
    const gapS = rd.length >= 3 ? Math.round((rd[rd.length - 1] - rd[0]) / (rd.length - 1) / 1000) : null;
    const det = c.ts ? [`Ultimo controllo ${ago(c.ts)} fa`.replace(' fa fa', ' fa'),
      gapS != null ? `letta in media ogni ${gapS >= 90 ? Math.round(gapS / 60) + ' min' : gapS + ' s'}` : null,
      c.listings != null ? `${c.listings} annunci` : null,
      c.valid ? `${c.valid} rispettano i filtri, il più economico ${money(c.bestCents, c.currency)}` : c.listings != null ? 'nessuno rispetta i filtri' : null].filter(Boolean).join(' · ') + '.' : 'La carta non è ancora stata letta: succede entro pochi minuti.';
    const box = el('div', { class: 'chk-wrap' + (openChecks.has(r.id) ? ' open' : '') });
    const btn = el('button', { class: 'chk', type: 'button', 'aria-expanded': String(openChecks.has(r.id)),
      onclick: () => { openChecks.has(r.id) ? openChecks.delete(r.id) : openChecks.add(r.id); box.classList.toggle('open'); btn.setAttribute('aria-expanded', String(box.classList.contains('open'))); } },
      el('span', { class: `cdot ${st}` }),
      el('span', { class: 'ct' }, el('b', { text: title }), el('small', { text: why || `${n} ${n === 1 ? 'controllo' : 'controlli'} nell’ultima ora` })),
      el('span', { class: 'cbars', 'aria-hidden': 'true' }, ...bars));
    box.append(btn, el('p', { class: 'chk-det', text: det }));
    return box;
  }
  function renderRuleHealth() {
    const box = $('ruleHealth');
    const active = state.rules.filter((r) => r.enabled);
    box.hidden = !active.length;
    if (!active.length) return;
    const states = active.map((r) => checkState(r).st);
    const bad = states.filter((x) => x !== 'ok').length;
    const waiting = active.filter((r) => { const x = checkState(r); return x.st !== 'ok' && (x.restart || !x.c.ts); }).length;
    const cyc = state.status && state.status.cycle;
    box.className = 'rule-health ' + (bad ? (states.includes('stop') ? 'stop' : 'slow') : 'ok');
    box.replaceChildren(
      el('span', { class: 'rh-ico', text: bad ? '!' : '✓', 'aria-hidden': 'true' }),
      el('span', null,
        el('b', { text: waiting === bad && bad ? `Controlli in ripartenza: ${active.length - bad} alert su ${active.length} già ricontrollati` : bad ? `${active.length - bad} alert su ${active.length} controllati regolarmente` : `Tutti i ${active.length} alert controllati regolarmente` }),
        el('small', { text: [cyc ? `Giro completo ogni ${dur(cyc.ms)}` : null, state.status && state.status.lastScan ? `ultimo controllo ${ago(state.status.lastScan)} fa`.replace(' fa fa', ' fa') : null].filter(Boolean).join(' · ') })));
  }

  let ruleState = 'all';
  let ruleLang = '';
  let ruleCond = '';
  let ruleZero = '';
  function render() {
    if (!state) return;
    const active = state.rules.filter((r) => r.enabled).length;
    $('statRules').textContent = compactNum(active);
    $('statAlerts').textContent = compactNum(state.alerts.filter((a) => !a.test).length);
    $('statScans').textContent = compactNum(state.status.scans || 0);

    const dot = $('dot');
    const s = state.status;
    const err = s.lastError;
    dot.className = 'dot ' + (err ? 'err' : active && s.lastScan && Date.now() - s.lastScan < 60000 ? 'ok' : '');
    $('statusText').textContent = !active
      ? 'Nessuna regola attiva'
      : s.lastScan
        ? `Ultimo scan ${ago(s.lastScan)}`
        : 'In avvio…';
    updateBall(s, active);
    tickRing();
    $('statusError').hidden = !err;
    $('statusError').textContent = err ? friendlyError(err) : '';

    // elenco alert
    const list = $('alertList');
    const afilter = (document.querySelector('input[name="afilter"]:checked') || {}).value || 'new';
    const shown = state.alerts.filter((a) => afilter === 'all' || (afilter === 'bought' ? a.mark === 'bought' : !a.mark));
    list.replaceChildren(
      ...shown.map((a) => {
        const lv = a.discount >= 0.5 ? 'lv3' : a.discount >= 0.3 ? 'lv2' : 'lv1';
        const badge = a.test ? chip('prova') : a.refKind === 'stock' ? el('span', { class: 'al-badge stock', text: 'Disponibile' })
          : a.discount >= 0.01 ? el('span', { class: `al-badge ${lv}`, text: `−${Math.round(a.discount * 100)}%` }) : el('span', { class: 'al-badge stock', text: 'Sotto soglia' });
        const refTag = a.refKind === 'cardmarket' ? ' Cardmarket' : a.refKind === 'drop' ? ' 7 giorni fa' : '';
        const shipTxt = a.test ? null : a.zero ? 'Zero: una sola spedizione per tutto l’ordine'
          : a.ship ? `+ ${money(a.ship.cents, a.currency)} spedizione${a.ship.tracked ? ' tracciata' : ''} = ${money(a.cents + a.ship.cents, a.currency)}` : 'Spedizione non stimata';
        const markBtn = (m, label, done) => el('button', { class: 'al-btn' + (a.mark === m ? ' on' : ''), type: 'button', text: a.mark === m ? done : label,
          onclick: () => markAlert(a, a.mark === m ? null : m) });
        return el('article', { class: 'al' + (lv === 'lv3' ? ' hot' : '') + (a.mark ? ' marked' : '') },
          el('div', { class: 'al-top' },
            el('a', { class: 'al-img', href: a.url || '#', target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Apri su CardTrader' }, thumb(a.cardImage)),
            el('div', { class: 'al-info' },
              el('div', { class: 'al-head' },
                el('div', { class: 'al-name', text: a.name || '' }),
                badge,
                ...(a.reminder ? [chip('Promemoria', 'warn')] : []),
              ),
              el('div', { class: 'al-exp', text: [a.expansion, ago(a.ts)].filter(Boolean).join(' · ') }),
              a.test ? null : el('div', { class: 'al-price' },
                el('span', { class: 'now', text: money(a.cents, a.currency) }),
                a.refKind !== 'stock' && a.refCents ? el('span', { class: 'was', text: money(a.refCents, a.currency) + refTag }) : null,
              ),
              el('div', { class: 'al-tags' },
                a.condition ? chip(a.condition, 'cond') : null,
                a.language ? chip(a.language.toUpperCase(), 'lang') : null,
                a.zero ? chip('Zero', 'zero') : null,
              ),
            ),
          ),
          a.test ? null : el('div', { class: 'al-meta' },
            a.seller ? el('div', null, el('span', { class: 'k', text: 'Venditore' }), el('span', { text: `${a.seller}${a.country ? ' · ' + a.country : ''}` })) : null,
            a.cmCents && a.refKind !== 'cardmarket' ? el('div', null, el('span', { class: 'k', text: 'Cardmarket' }), el('span', { text: `tendenza ${money(a.cmCents, a.currency)}` })) : null,
            el('div', null, el('span', { class: 'k', text: 'Spedizione' }), el('span', { text: shipTxt })),
          ),
          a.test ? null : el('div', { class: 'al-acts' },
            markBtn('seen', 'Segna visto', '✓ Visto'),
            markBtn('bought', 'Comprato', '✓ Comprato'),
            el('a', { class: 'al-btn go', href: a.url || '#', target: '_blank', rel: 'noopener noreferrer', text: 'CardTrader ↗' }),
            a.mark === 'seen' ? el('button', { class: 'al-btn del', type: 'button', 'aria-label': 'Elimina avviso', title: 'Elimina', onclick: () => deleteAlert(a) }, ico('trash')) : null,
          ),
        );
      }),
    );
    const seenN = state.alerts.filter((a) => a.mark === 'seen').length;
    $('clearSeen').hidden = !seenN || afilter === 'bought';
    $('clearSeen').textContent = `Elimina i visti (${seenN})`;
    $('alertEmpty').hidden = state.alerts.length > 0;
    if (state.alerts.length && !shown.length) list.replaceChildren(el('p', { class: 'muted', text: afilter === 'bought' ? 'Nessun avviso segnato come comprato.' : 'Hai già visto tutti gli avvisi.' }));
    const bought = state.bought || [];
    const saved = bought.reduce((t, b) => t + Math.max(0, (b.refCents || 0) - b.cents), 0);
    $('savings').hidden = !bought.length;
    $('savings').textContent = `${bought.length} ${bought.length === 1 ? 'carta comprata' : 'carte comprate'} con HoloSnipe · ${money(saved)} risparmiati rispetto al riferimento`;

    const unseen = state.alerts.filter((a) => !a.test && !a.mark).length;
    $('alertsLabel').replaceChildren('Avvisi', ...(unseen ? [el('span', { class: 'count-dot', text: unseen > 99 ? '99+' : String(unseen) })] : []));
    $('alertDot').hidden = !unseen;
    if (!hviewChosen) {
      hviewChosen = true;
      let saved = null;
      try { saved = localStorage.getItem('snipe.hview'); } catch {}
      setHview(saved === 'alerts' || saved === 'coll' || saved === 'orders' ? saved : unseen ? 'alerts' : 'coll');
    }

    renderWish();
    renderRviewCounts();
    renderPlan();
    renderSellers();
    $('adminPanel').hidden = !isOwner();
    $('ratioPanel').hidden = !isOwner();
    if (isOwner() && !$('tab-settings').hidden && Date.now() - adminLoaded > 60_000) loadAdmin();

    // alert nuovo mentre la pagina è aperta
    const top = state.alerts[0] && state.alerts[0].id;
    if (knownTop !== null && top && top !== knownTop) beep();
    knownTop = top || '';

    // regole
    const rl = $('ruleList');
    const rq = plainText($('ruleSearch').value).trim();
    const many = state.rules.length >= 6;
    $('ruleTools').hidden = !many;
    // Filtri: stato, lingua, condizione minima e venditori. Si mostrano solo i valori usati nei tuoi alert.
    const STATES = [['all', 'Tutti'], ['on', 'Attivi'], ['off', 'In pausa'], ['star', '★ Con stella'], ['set', 'Set interi']]
      .filter(([v]) => (v !== 'set' || state.rules.some((r) => !r.blueprintId)) && (v !== 'star' || state.rules.some((r) => r.priority)));
    const langOf = (r) => String(r.language || '').split(',').filter(Boolean).map((l) => (l === 'ja' ? 'jp' : l));
    const ruleLangs = [...new Set(state.rules.flatMap(langOf))];
    const CONDS = ['Mint', 'Near Mint', 'Slightly Played', 'Moderately Played', 'Played', 'Heavily Played', 'Poor'];
    const ruleConds = CONDS.filter((c) => state.rules.some((r) => r.minCondition === c));
    const zeroOf = (r) => r.zero || 'any';
    const ZLABEL = { only: 'Solo Zero', exclude: 'Senza Zero', any: 'Tutti i venditori' };
    const zeroUsed = ['only', 'exclude', 'any'].filter((z) => state.rules.some((r) => zeroOf(r) === z));
    if (ruleLang && !ruleLangs.includes(ruleLang)) ruleLang = '';
    if (ruleCond && !ruleConds.includes(ruleCond)) ruleCond = '';
    if (ruleZero && !zeroUsed.includes(ruleZero)) ruleZero = '';
    const LBL = { lang: (l) => LANG_CHIP[l] || l.toUpperCase(), cond: (c) => `${c} o meglio`, zero: (z) => ZLABEL[z] };
    filterChips($('ruleState'), STATES, ruleState, (v) => { ruleState = v; render(); });
    $('ruleLangG').hidden = !ruleLangs.length;
    filterChips($('ruleLang'), [['', 'Tutte'], ...ruleLangs.map((l) => [l, LBL.lang(l)])], ruleLang, (v) => { ruleLang = v; render(); });
    $('ruleCondG').hidden = !ruleConds.length;
    filterChips($('ruleCond'), [['', 'Tutte'], ...ruleConds.map((c) => [c, LBL.cond(c)])], ruleCond, (v) => { ruleCond = v; render(); });
    $('ruleZeroG').hidden = !zeroUsed.length;
    filterChips($('ruleZero'), [['', 'Tutti'], ...zeroUsed.map((z) => [z, LBL.zero(z)])], ruleZero, (v) => { ruleZero = v; render(); });
    // Filtri attivi: pillole con × sotto la ricerca, e il numero sul pulsante.
    const activeF = [
      ruleState !== 'all' && [STATES.find(([v]) => v === ruleState)[1], () => { ruleState = 'all'; }],
      ruleLang && [LBL.lang(ruleLang), () => { ruleLang = ''; }],
      ruleCond && [LBL.cond(ruleCond), () => { ruleCond = ''; }],
      ruleZero && [LBL.zero(ruleZero), () => { ruleZero = ''; }],
    ].filter(Boolean);
    $('ruleFilterCount').hidden = !activeF.length;
    $('ruleFilterCount').textContent = String(activeF.length);
    $('ruleActive').hidden = !activeF.length || !$('ruleFilters').hidden;
    $('ruleActive').replaceChildren(...activeF.map(([label, clear]) => el('button', { class: 'af-chip', type: 'button', 'aria-label': `Togli il filtro ${label}`, onclick: () => { clear(); render(); } }, el('span', { text: label }), el('b', { text: '×', 'aria-hidden': 'true' }))));
    const stateOk = (r) => ruleState === 'all' || (ruleState === 'on' && r.enabled) || (ruleState === 'off' && !r.enabled) || (ruleState === 'star' && r.priority) || (ruleState === 'set' && !r.blueprintId);
    const shownRules = state.rules.filter((r) => stateOk(r) && (!ruleLang || langOf(r).includes(ruleLang)) && (!ruleCond || r.minCondition === ruleCond) && (!ruleZero || zeroOf(r) === ruleZero)
      && (!rq || plainText([r.cardName, r.expansionName, r.nameContains].join(' ')).includes(rq)));
    const filtering = !!rq || activeF.length > 0;
    $('ruleCount').hidden = !filtering;
    $('ruleCount').textContent = shownRules.length ? `${shownRules.length} alert su ${state.rules.length}` : rq ? `Nessun alert per “${$('ruleSearch').value.trim()}”` : 'Nessun alert con questi filtri';
    renderRuleHealth();
    rl.replaceChildren(
      ...shownRules.map((r) => {
        const title = r.cardName || r.expansionName || `Espansione ${r.expansionId}`;
        const zeroTxt = r.zero === 'only' ? 'Solo Zero' : r.zero === 'exclude' ? 'Senza Zero' : '';
        return el('div', { class: 'rule' + (r.enabled ? '' : ' off') },
          thumb(r.cardImage),
          el('div', { class: 'info' },
            el('div', null,
              el('div', { class: 't', text: title }),
              r.cardName ? el('div', { class: 'e', text: r.expansionName || '' }) : null,
              r.blueprintId ? ownedBadge(r.blueprintId, 'own-badge inline') : null,
            ),
            el('div', { class: 'chips' },
              chip(r.dropPct ? `Calo −${r.dropPct}% in 7 giorni` : r.stock ? 'Torna disponibile' : r.cmDiscount ? `Cardmarket −${r.cmDiscount}%` : r.maxPriceCents ? `Sotto ${money(r.maxPriceCents)}` : `Sconto da ${r.minDiscount}%`, 'on'),
              r.nameContains ? chip(`“${r.nameContains}”`) : null,
              chip(r.minCondition || 'Qualsiasi condizione', 'cond'),
              chip(r.language ? r.language.toUpperCase() : 'Tutte le lingue', 'lang'),
              zeroTxt ? chip(zeroTxt, 'zero') : null,
              r.enabled ? null : chip('In pausa', 'warn'),
              (state.outOfPlan || []).includes(r.id) ? chip('Fermo: oltre il limite del piano', 'warn') : null,
            ),
            ...(nowLine(r) ? [nowLine(r)] : []),
          ),
          el('div', { class: 'rule-side' },
            !(state.account && state.account.plan.priority) ? null : el('button', { class: 'icon-tog star' + (r.priority ? ' on' : ''), type: 'button', title: r.priority ? 'Priorità: controllato più spesso' : 'Dai priorità (controlla più spesso)', 'aria-label': r.priority ? 'Togli priorità' : 'Dai priorità', 'aria-pressed': String(!!r.priority),
              onclick: () => saveRule({ ...r, minPrice: r.minPriceCents / 100, maxPrice: r.maxPriceCents ? r.maxPriceCents / 100 : null, priority: !r.priority }) }, ico(r.priority ? 'starFill' : 'star')),
            r.blueprintId ? (() => {
              const inWish = (state.wish || []).some((w) => w.id === r.blueprintId);
              return el('button', { class: 'icon-tog heart' + (inWish ? ' on' : ''), type: 'button', title: inWish ? 'Nella lista dei desideri' : 'Aggiungi alla lista dei desideri', 'aria-label': inWish ? 'Togli dalla lista dei desideri' : 'Aggiungi alla lista dei desideri', 'aria-pressed': String(inWish),
                onclick: () => toggleWish(wishFromRule(r), inWish) }, ico(inWish ? 'heartFill' : 'heart'));
            })() : null,
          ),
          checkRow(r),
          el('div', { class: 'acts' },
            el('button', { class: 'act-btn', type: 'button', onclick: () => explainRule(r) }, ico('search'), el('span', { text: 'Verifica' })),
            el('button', { class: 'act-btn', type: 'button', onclick: () => openEdit(r) }, ico('edit'), el('span', { text: 'Modifica' })),
            el('button', { class: 'act-btn', type: 'button', 'aria-label': r.enabled ? 'Metti in pausa' : 'Riattiva',
              onclick: () => saveRule({ ...r, minPrice: r.minPriceCents / 100, maxPrice: r.maxPriceCents ? r.maxPriceCents / 100 : null, enabled: !r.enabled }) }, ico(r.enabled ? 'pause' : 'play'), el('span', { text: r.enabled ? 'Pausa' : 'Riattiva' })),
            el('button', { class: 'act-btn del', type: 'button', 'aria-label': 'Elimina alert', title: 'Elimina',
              onclick: async () => {
                if (!(await confirmDelete(r))) return;
                await api(`/api/rules/${r.id}`, { method: 'DELETE' });
                refresh();
              } }, ico('trash')),
          ),
        );
      }),
    );
    $('ruleEmpty').hidden = state.rules.length > 0;

    renderSettings();
    updatePushUI();
  }

