  // ---------- render ----------
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
        const who = a.seller && `${a.seller}${a.country ? ' (' + a.country + ')' : ''}`;
        const card = el(
          'a',
          { class: 'alert' + (lv === 'lv3' ? ' hot' : '') + (a.mark ? ' marked' : ''), href: a.url || '#', target: '_blank', rel: 'noopener noreferrer' },
          thumb(a.cardImage),
          el('div', { class: 'main' },
            el('div', { class: 'name', text: a.name || '' }),
            el('div', { class: 'sub', text: a.expansion || '' }),
            el('div', { class: 'chips' },
              a.condition ? chip(a.condition, 'cond') : null,
              a.language ? chip(a.language.toUpperCase(), 'lang') : null,
              who ? chip(who) : null,
              a.zero ? chip('Zero', 'zero') : null,
            ),
            a.test ? null : el('div', { class: 'prices' },
              el('span', { class: 'price', text: money(a.cents, a.currency) }),
              a.refKind === 'stock' ? el('span', { class: 'chip zero', text: 'Di nuovo disponibile' })
              : el('span', { class: 'ref' }, money(a.refCents, a.currency), a.refKind === 'cardmarket' ? el('span', { class: 'cmtag', text: 'Cardmarket' }) : a.refKind === 'drop' ? el('span', { class: 'cmtag', text: '7 giorni fa' }) : null),
            ),
            a.test || !a.cmCents || a.refKind === 'cardmarket' ? null : el('div', { class: 'ship', text: `Cardmarket tendenza ${money(a.cmCents, a.currency)}` }),
            a.test ? null : el('div', { class: 'ship', text: a.zero
              ? 'Spedizione con CardTrader Zero: una sola per tutto l’ordine'
              : a.ship
                ? `+ ${money(a.ship.cents, a.currency)} spedizione${a.ship.tracked ? ' tracciata' : ''} → totale ${money(a.cents + a.ship.cents, a.currency)}`
                : 'Spedizione non stimata' }),
          ),
          el('div', { class: 'side' },
            a.test ? chip('prova') : a.refKind === 'stock' ? chip('Disponibile', 'cond') : a.discount >= 0.01 ? el('span', { class: `badge ${lv}`, text: `−${Math.round(a.discount * 100)}%` }) : chip('Sotto soglia', 'zero'),
            el('span', { class: 'when', text: ago(a.ts) }),
            a.test ? null : el('span', { class: 'go', text: 'CardTrader ↗' }),
          ),
        );
        if (a.test) return card;
        const markBtn = (m, label) => el('button', { class: 'btn mini' + (a.mark === m ? ' on' : ''), type: 'button', text: label,
          onclick: () => markAlert(a, a.mark === m ? null : m) });
        return el('div', { class: 'alertwrap' }, card,
          el('div', { class: 'alert-acts' }, markBtn('seen', a.mark === 'seen' ? '✓ Visto' : 'Segna visto'), markBtn('bought', a.mark === 'bought' ? '✓ Comprato' : 'Comprato')));
      }),
    );
    $('alertEmpty').hidden = state.alerts.length > 0;
    if (state.alerts.length && !shown.length) list.replaceChildren(el('p', { class: 'muted', text: afilter === 'bought' ? 'Nessun avviso segnato come comprato.' : 'Hai già visto tutti gli avvisi.' }));
    const bought = state.bought || [];
    const saved = bought.reduce((t, b) => t + Math.max(0, (b.refCents || 0) - b.cents), 0);
    $('savings').hidden = !bought.length;
    $('savings').textContent = `${bought.length} ${bought.length === 1 ? 'carta comprata' : 'carte comprate'} con Snipe · ${money(saved)} risparmiati rispetto al riferimento`;

    const unseen = state.alerts.filter((a) => !a.test && !a.mark).length;
    $('alertsLabel').textContent = unseen ? `Avvisi (${unseen})` : 'Avvisi';
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
    rl.replaceChildren(
      ...state.rules.map((r) => {
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

