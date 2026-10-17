  // ---------- render ----------
  let ruleState = 'all';
  let ruleLang = '';
  function render() {
    if (!state) return;
    const active = state.rules.filter((r) => r.enabled).length;
    $('statRules').textContent = active;
    $('statAlerts').textContent = state.alerts.filter((a) => !a.test).length;
    $('statScans').textContent = state.status.scans || 0;

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
    $('statusError').hidden = !err;
    $('statusError').textContent = err || '';

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
          ),
        );
      }),
    );
    $('alertEmpty').hidden = state.alerts.length > 0;
    if (state.alerts.length && !shown.length) list.replaceChildren(el('p', { class: 'muted', text: afilter === 'bought' ? 'Nessun avviso segnato come comprato.' : 'Hai già visto tutti gli avvisi.' }));
    const bought = state.bought || [];
    const saved = bought.reduce((t, b) => t + Math.max(0, (b.refCents || 0) - b.cents), 0);
    $('savings').hidden = !bought.length;
    $('savings').textContent = `${bought.length} ${bought.length === 1 ? 'carta comprata' : 'carte comprate'} con Snipe · ${money(saved)} risparmiati rispetto al riferimento`;

    const unseen = state.alerts.filter((a) => !a.test && !a.mark).length;
    $('alertsLabel').replaceChildren('Avvisi', ...(unseen ? [el('span', { class: 'count-dot', text: unseen > 99 ? '99+' : String(unseen) })] : []));
    $('alertDot').hidden = !unseen;
    if (!hviewChosen) { hviewChosen = true; setHview(unseen ? 'alerts' : 'coll'); }

    renderWish();
    renderPlan();
    renderSellers();
    $('adminPanel').hidden = !isOwner();
    if (isOwner() && !$('tab-settings').hidden && Date.now() - adminLoaded > 60_000) loadAdmin();

    // alert nuovo mentre la pagina è aperta
    const top = state.alerts[0] && state.alerts[0].id;
    if (knownTop !== null && top && top !== knownTop) beep();
    knownTop = top || '';

    // regole
    const rl = $('ruleList');
    const rq = plainText($('ruleSearch').value).trim();
    const many = state.rules.length >= 6;
    $('ruleSearch').hidden = !many;
    $('ruleFilters').hidden = !many;
    // Filtri: stato (attivi, in pausa, con stella, set interi) e lingua, insieme alla ricerca per nome.
    const STATES = [['all', 'Tutti'], ['on', 'Attivi'], ['off', 'In pausa'], ['star', '★ Con stella'], ['set', 'Set interi']];
    const ruleLangs = [...new Set(state.rules.flatMap((r) => String(r.language || '').split(',').filter(Boolean)).map((l) => (l === 'ja' ? 'jp' : l)))];
    if (ruleLang && !ruleLangs.includes(ruleLang)) ruleLang = '';
    filterChips($('ruleState'), STATES.filter(([v]) => v !== 'set' || state.rules.some((r) => !r.blueprintId)).filter(([v]) => v !== 'star' || state.rules.some((r) => r.priority)), ruleState, (v) => { ruleState = v; render(); });
    $('ruleLang').hidden = ruleLangs.length < 2;
    filterChips($('ruleLang'), [['', 'Tutte le lingue'], ...ruleLangs.map((l) => [l, LANG_CHIP[l] || l.toUpperCase()])], ruleLang, (v) => { ruleLang = v; render(); });
    const stateOk = (r) => ruleState === 'all' || (ruleState === 'on' && r.enabled) || (ruleState === 'off' && !r.enabled) || (ruleState === 'star' && r.priority) || (ruleState === 'set' && !r.blueprintId);
    const langOk = (r) => !ruleLang || String(r.language || '').split(',').map((l) => (l === 'ja' ? 'jp' : l)).includes(ruleLang);
    const shownRules = state.rules.filter((r) => stateOk(r) && langOk(r) && (!rq || plainText([r.cardName, r.expansionName, r.nameContains].join(' ')).includes(rq)));
    const filtering = !!rq || ruleState !== 'all' || !!ruleLang;
    $('ruleCount').hidden = !filtering;
    $('ruleCount').textContent = shownRules.length ? `${shownRules.length} alert su ${state.rules.length}` : rq ? `Nessun alert per “${$('ruleSearch').value.trim()}”` : 'Nessun alert con questi filtri';
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

