(() => {
  const $ = (id) => document.getElementById(id);
  const KEY_STORE = 'snipe.key';
  let key = '';
  try { key = localStorage.getItem(KEY_STORE) || ''; } catch {}

  let state = null;
  let expansions = [];
  let knownTop = null;
  let timer = null;

  // ---------- rete ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'x-app-key': key, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    });
    if (res.status === 401) {
      showLogin('Chiave non valida.');
      throw new Error('401');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
    return data;
  }

  // ---------- utilità ----------
  function el(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) if (c) n.append(c);
    return n;
  }
  const cardUrl = (blueprintId) => `https://www.cardtrader.com/cards/${blueprintId}`;
  const cmSearchUrl = (c) => `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent([c.name, c.number].filter(Boolean).join(' '))}`;
  const chip = (text, cls = '') => el('span', { class: ('chip ' + cls).trim(), text });
  const thumb = (src) => (src ? el('img', { class: 'thumbimg', src, alt: '', loading: 'lazy' }) : el('div', { class: 'thumbimg ph', 'aria-hidden': 'true' }));
  const money = (c, cur) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: cur || 'EUR' }).format((c || 0) / 100);
  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s fa`;
    if (s < 3600) return `${Math.floor(s / 60)}m fa`;
    if (s < 86400) return `${Math.floor(s / 3600)}h fa`;
    return `${Math.floor(s / 86400)}g fa`;
  }
  function soundOn() { try { return localStorage.getItem('snipe.sound') !== '0'; } catch { return true; } }
  function beep() {
    if (!soundOn()) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.08;
      o.start(); o.stop(ctx.currentTime + 0.18);
    } catch {}
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  }

  // ---------- pannelli a comparsa ----------
  const sheets = ['cardDialog', 'editDialog', 'explainDialog'].map((id) => $(id));
  function openSheet(d) {
    if (!d.open) d.show(); // non modale: il browser non usa il livello superiore
    $('sheetBackdrop').hidden = false;
    document.documentElement.classList.add('noscroll');
    d.scrollTop = 0;
  }
  function closeSheets() { sheets.forEach((s) => s.open && s.close()); }
  sheets.forEach((d) => d.addEventListener('close', () => {
    if (sheets.some((s) => s.open)) return;
    $('sheetBackdrop').hidden = true;
    document.documentElement.classList.remove('noscroll');
  }));
  $('sheetBackdrop').addEventListener('click', closeSheets);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

  // ---------- link esterni ----------
  // Su telefono, toccando un link a CardTrader o Cardmarket si apre il menu "Apri con un'altra app" del sistema:
  // da lì si sceglie il browser, e la pagina si apre fuori dalla webapp. Su computer il link si apre normalmente.
  const isMobileOS = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest && ev.target.closest('a[target="_blank"]');
    if (!a || !isMobileOS || !navigator.share) return;
    let u;
    try { u = new URL(a.href); } catch { return; }
    if (u.origin === location.origin || !/^https?:$/.test(u.protocol)) return;
    ev.preventDefault();
    const title = (a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) || 'Snipe';
    navigator.share({ title, url: u.href }).catch(() => { /* menu chiuso senza scegliere */ });
  });

  // ---------- login ----------
  function showLogin(msg) {
    clearInterval(timer);
    $('app').hidden = true;
    $('login').hidden = false;
    const e = $('loginError');
    e.hidden = !msg;
    e.textContent = msg || '';
  }
  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    key = $('keyInput').value.trim();
    try {
      await api('/api/state');
      try { localStorage.setItem(KEY_STORE, key); } catch {}
      start();
    } catch (e) {
      if (e.message !== '401') showLogin(e.message);
    }
  });
  $('logout').addEventListener('click', () => {
    try { localStorage.removeItem(KEY_STORE); } catch {}
    key = '';
    showLogin('');
  });

  // ---------- tab ----------
  function goTab(name) {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
    for (const t of ['alerts', 'cards', 'rules', 'settings']) $(`tab-${t}`).hidden = t !== name;
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.tab)));
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.go)));

  // Eliminare un alert cancella anche i suoi avvisi, quindi chiediamo conferma.
  function confirmDelete(r) {
    return window.confirm(`Eliminare l'alert "${r.cardName || r.expansionName}"? Anche i suoi avvisi verranno cancellati.`);
  }

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
    $('statusError').hidden = !err;
    $('statusError').textContent = err || '';

    // elenco alert
    const list = $('alertList');
    list.replaceChildren(
      ...state.alerts.map((a) => {
        const lv = a.discount >= 0.5 ? 'lv3' : a.discount >= 0.3 ? 'lv2' : 'lv1';
        const who = a.seller && `${a.seller}${a.country ? ' (' + a.country + ')' : ''}`;
        return el(
          'a',
          { class: 'alert' + (lv === 'lv3' ? ' hot' : ''), href: a.url || '#', target: '_blank', rel: 'noopener noreferrer' },
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
              el('span', { class: 'ref' }, money(a.refCents, a.currency), a.refKind === 'cardmarket' ? el('span', { class: 'cmtag', text: 'Cardmarket' }) : null),
            ),
            a.test ? null : el('div', { class: 'ship', text: a.zero
              ? 'Spedizione con CardTrader Zero: una sola per tutto l’ordine'
              : a.ship
                ? `+ ${money(a.ship.cents, a.currency)} spedizione${a.ship.tracked ? ' tracciata' : ''} → totale ${money(a.cents + a.ship.cents, a.currency)}`
                : 'Spedizione non stimata' }),
          ),
          el('div', { class: 'side' },
            a.test ? chip('prova') : a.discount >= 0.01 ? el('span', { class: `badge ${lv}`, text: `−${Math.round(a.discount * 100)}%` }) : chip('Sotto soglia', 'zero'),
            el('span', { class: 'when', text: ago(a.ts) }),
            a.test ? null : el('span', { class: 'go', text: 'CardTrader ↗' }),
          ),
        );
      }),
    );
    $('alertEmpty').hidden = state.alerts.length > 0;

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
              chip(r.cmDiscount ? `Cardmarket −${r.cmDiscount}%` : r.maxPriceCents ? `Sotto ${money(r.maxPriceCents)}` : `Sconto da ${r.minDiscount}%`, 'on'),
              r.nameContains ? chip(`“${r.nameContains}”`) : null,
              chip(r.minCondition || 'Qualsiasi condizione', 'cond'),
              chip(r.language ? r.language.toUpperCase() : 'Tutte le lingue', 'lang'),
              zeroTxt ? chip(zeroTxt, 'zero') : null,
              r.enabled ? null : chip('In pausa', 'warn'),
            ),
          ),
          el('div', { class: 'acts' },
            el('button', { class: 'btn', type: 'button', text: 'Verifica', onclick: () => explainRule(r) }),
            el('button', { class: 'btn', type: 'button', text: 'Modifica', onclick: () => openEdit(r) }),
            el('button', { class: 'btn', type: 'button', 'aria-label': r.enabled ? 'Metti in pausa' : 'Riattiva', text: r.enabled ? 'Pausa' : 'Riattiva',
              onclick: () => saveRule({ ...r, minPrice: r.minPriceCents / 100, maxPrice: r.maxPriceCents ? r.maxPriceCents / 100 : null, enabled: !r.enabled }) }),
            el('button', { class: 'btn danger', type: 'button', 'aria-label': 'Elimina alert', text: 'Elimina',
              onclick: async () => {
                if (!confirmDelete(r)) return;
                await api(`/api/rules/${r.id}`, { method: 'DELETE' });
                refresh();
              } }),
          ),
        );
      }),
    );
    $('ruleEmpty').hidden = state.rules.length > 0;

    renderSettings();
    updatePushUI();
  }

  // ---------- impostazioni ----------
  const hhmmss = (ts) => new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  function kvRow(k, v, cls = '') {
    return el('div', null, el('span', { class: 'k', text: k }), el('span', { class: ('v ' + cls).trim(), text: v }));
  }

  function renderSettings() {
    if (!state || !state.settings) return;
    const s = state.settings;
    const sys = state.system || {};
    const st = state.status || {};
    const active = state.rules.filter((r) => r.enabled).length;
    const limited = sys.limitUntil && sys.limitUntil > Date.now();

    const badge = $('sysBadge');
    if (s.paused) { badge.className = 'state off'; badge.textContent = 'In pausa'; }
    else if (st.lastError || limited) { badge.className = 'state off'; badge.textContent = 'Attenzione'; }
    else if (active) { badge.className = 'state on'; badge.textContent = 'Attivo'; }
    else { badge.className = 'state'; badge.textContent = 'Nessun alert'; }

    const idx = sys.index;
    const rows = [
      kvRow('Scansione', s.paused ? 'In pausa' : active ? (st.lastScan ? `ultimo controllo ${ago(st.lastScan)}` : 'in avvio…') : 'nessun alert attivo'),
      kvRow('Alert attivi', `${active} su ${state.rules.length}`),
      kvRow('CardTrader', limited ? `richieste limitate fino alle ${hhmmss(sys.limitUntil)}` : st.lastError ? st.lastError : 'tutto regolare', limited || st.lastError ? 'bad' : ''),
      kvRow('Indice delle carte', !idx ? 'non ancora creato' : idx.complete ? `pronto (${idx.withCards} espansioni)` : `in preparazione ${idx.done}/${idx.total || '?'}`),
      kvRow('Prezzi Cardmarket', sys.cm ? `aggiornati ${ago(sys.cm.ts)}` : sys.cmError ? `non disponibili: ${sys.cmError}` : 'in scaricamento…', !sys.cm && sys.cmError ? 'bad' : ''),
      kvRow('Iscrizioni alle notifiche', String(state.pushDevices)),
      kvRow('Versione', sys.build || '—'),
    ];
    if (sys.indexError) rows.push(kvRow('Errore indice', sys.indexError, 'bad'));
    if (sys.market) {
      const m = sys.market;
      rows.push(kvRow('Ritmo richieste CardTrader', `una ogni ${(m.gapMs / 1000).toFixed(1)} s · ${m.tokens} pronte`));
      const last = (m.recent429 || []).slice().reverse();
      rows.push(kvRow('Ultimi 429', last.length ? last.map((x) => `${hhmmss(x.ts)} ${x.path.includes('blueprint_id') ? 'carta' : 'espansione'}`).join(', ') : 'nessuno', last.length ? 'bad' : ''));
    }
    $('sysList').replaceChildren(...rows);
    const bar = $('indexBar');
    bar.hidden = !idx || idx.complete;
    if (idx && !idx.complete && idx.total) bar.firstElementChild.style.width = `${Math.round((idx.done / idx.total) * 100)}%`;

    // i controlli non vengono toccati mentre li stai usando
    const free = (id) => document.activeElement !== $(id);
    if (free('setPaused')) $('setPaused').checked = !!s.paused;
    if (free('setScan')) $('setScan').value = String(s.scanEverySec);
    if (free('setQuiet')) $('setQuiet').checked = !!s.quietEnabled;
    if (free('setFrom')) $('setFrom').value = s.quietFrom;
    if (free('setTo')) $('setTo').value = s.quietTo;
    if (free('setSound')) $('setSound').checked = soundOn();
  }

  async function saveSettings(patch) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      await api('/api/settings', { method: 'POST', body: JSON.stringify({ ...patch, tz }) });
      await refresh();
    } catch (e) {
      $('sysMsg').hidden = false;
      $('sysMsg').textContent = `Impostazione non salvata: ${e.message}`;
    }
  }
  $('setPaused').addEventListener('change', () => saveSettings({ paused: $('setPaused').checked }));
  $('setScan').addEventListener('change', () => saveSettings({ scanEverySec: Number($('setScan').value) }));
  $('setQuiet').addEventListener('change', () => saveSettings({ quietEnabled: $('setQuiet').checked }));
  $('setFrom').addEventListener('change', () => saveSettings({ quietFrom: $('setFrom').value }));
  $('setTo').addEventListener('change', () => saveSettings({ quietTo: $('setTo').value }));
  $('setSound').addEventListener('change', () => {
    try { localStorage.setItem('snipe.sound', $('setSound').checked ? '1' : '0'); } catch {}
  });
  $('indexRefresh').addEventListener('click', async () => {
    try {
      await api('/api/index/refresh', { method: 'POST' });
      $('sysMsg').hidden = false;
      $('sysMsg').textContent = 'Indice in rinnovo: ci vorranno circa 10 minuti. La ricerca continua a funzionare nel frattempo.';
      await refresh();
    } catch (e) { $('sysMsg').hidden = false; $('sysMsg').textContent = e.message; }
  });

  // backup degli alert
  $('exportRules').addEventListener('click', async () => {
    const msg = $('backupMsg');
    msg.hidden = false;
    try {
      const data = await api('/api/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `snipe-alert-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      msg.textContent = `${data.rules.length} alert esportati.`;
    } catch (e) { msg.textContent = `Esportazione non riuscita: ${e.message}`; }
  });
  $('importRules').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async () => {
    const msg = $('backupMsg');
    msg.hidden = false;
    const f = $('importFile').files[0];
    $('importFile').value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.rules)) throw new Error('il file non contiene alert');
      const r = await api('/api/import', { method: 'POST', body: JSON.stringify({ rules: data.rules }) });
      msg.textContent = `${r.added} alert importati${r.skipped ? `, ${r.skipped} saltati` : ''}.`;
      await refresh();
    } catch (e) { msg.textContent = `Importazione non riuscita: ${e.message}`; }
  });

  async function refresh() {
    try {
      state = await api('/api/state');
      if (!$('alertCond').options.length) {
        for (const c of state.conditions) $('edCond').append(el('option', { value: c, text: c }));
        for (const c of state.conditions) $('alertCond').append(el('option', { value: c, text: c }));
        $('alertCond').value = 'Slightly Played';
      }
      render();
    } catch {}
  }

  // ---------- regole ----------
  function fillCardExpansions() {
    const q = $('cardExpFilter').value.trim().toLowerCase();
    const sel = $('cardExp');
    const prev = sel.value;
    const items = expansions.filter((e) => !q || e.name.toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q));
    sel.replaceChildren(
      el('option', { value: '', text: items.length ? 'Scegli un’espansione…' : 'Nessun risultato' }),
      el('option', { value: 'all', text: 'Tutte le espansioni (cerca per nome)' }),
      ...items.map((e) => el('option', { value: e.id, text: `${e.name} (${e.code})` })),
    );
    if (prev === 'all' || items.some((e) => String(e.id) === prev)) sel.value = prev;
    // mentre scrivi l'elenco resta aperto e mostra le espansioni che corrispondono
    sel.size = q ? Math.min(items.length + 2, 8) : 1;
    sel.classList.toggle('open', !!q);
  }
  $('cardExp').addEventListener('change', () => {
    if ($('cardExp').size > 1) { $('cardExpFilter').value = ''; $('cardExp').size = 1; $('cardExp').classList.remove('open'); }
  });
  $('cardExpFilter').addEventListener('input', fillCardExpansions);

  async function saveRule(r) {
    const err = $('ruleError');
    err.hidden = true;
    try {
      await api('/api/rules', { method: 'POST', body: JSON.stringify(r) });
      await refresh();
      return true;
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
      return false;
    }
  }


  // ---------- modifica alert ----------
  let editing = null;

  function setEditMode(mode) {
    $('edPrice').hidden = mode !== 'price';
    $('edPercent').hidden = mode !== 'percent';
    $('edCm').hidden = mode !== 'cm';
  }

  function openEdit(r) {
    editing = r;
    const legacy = !r.blueprintId;
    $('edTitle').textContent = r.cardName || r.expansionName || 'Modifica alert';
    $('edSub').textContent = r.cardName ? r.expansionName || '' : 'Alert su tutta l’espansione';
    const mode = r.cmDiscount ? 'cm' : r.maxPriceCents ? 'price' : 'percent';
    document.querySelector(`input[name="emode"][value="${mode}"]`).checked = true;
    $('emodeCmLabel').hidden = !(r.cmId || r.cmDiscount);
    $('edCmPct').value = r.cmDiscount || 20;
    $('edCmLabel').textContent = `${$('edCmPct').value}%`;
    setEditMode(mode);
    $('edMax').value = r.maxPriceCents ? (r.maxPriceCents / 100).toFixed(2) : '';
    $('edPct').value = r.minDiscount || 30;
    $('edPctLabel').textContent = `${$('edPct').value}%`;
    $('edLegacy').hidden = !legacy;
    $('edName').value = r.nameContains || '';
    $('edMinPrice').value = ((r.minPriceCents || 0) / 100).toString();
    $('edZero').value = r.zero || '';
    $('edCond').value = r.minCondition || 'Slightly Played';
    $('edLang').value = r.language || '';
    $('edError').hidden = true;
    openSheet($('editDialog'));
  }

  document.querySelectorAll('input[name="emode"]').forEach((x) =>
    x.addEventListener('change', () => setEditMode(document.querySelector('input[name="emode"]:checked').value)),
  );
  $('edCmPct').addEventListener('input', () => ($('edCmLabel').textContent = `${$('edCmPct').value}%`));
  $('edPct').addEventListener('input', () => ($('edPctLabel').textContent = `${$('edPct').value}%`));

  $('editForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!editing) return;
    const emode = document.querySelector('input[name="emode"]:checked').value;
    const pct = emode === 'percent';
    const body = {
      id: editing.id,
      expansionId: editing.expansionId,
      expansionName: editing.expansionName,
      blueprintId: editing.blueprintId,
      cardName: editing.cardName,
      cardImage: editing.cardImage,
      enabled: editing.enabled,
      nameContains: editing.blueprintId ? editing.nameContains : $('edName').value,
      minPrice: editing.blueprintId ? 0 : Number($('edMinPrice').value),
      zero: $('edZero').value,
      minCondition: $('edCond').value,
      language: $('edLang').value,
      minDiscount: pct ? Number($('edPct').value) : editing.minDiscount,
    };
    if (emode === 'cm') {
      body.cmDiscount = Number($('edCmPct').value);
      body.cmId = editing.cmId;
    } else if (!pct) {
      const v = Number($('edMax').value);
      if (!(v > 0)) { $('edError').textContent = 'Inserisci un prezzo maggiore di zero.'; $('edError').hidden = false; return; }
      body.maxPrice = v;
    }
    try {
      await api('/api/rules', { method: 'POST', body: JSON.stringify(body) });
      $('editDialog').close();
      await refresh();
    } catch (e) {
      $('edError').textContent = e.message;
      $('edError').hidden = false;
    }
  });

  async function explainRule(r) {
    const d = $('explainDialog');
    $('exTitle').textContent = r.cardName || r.expansionName || 'Alert';
    $('exInfo').textContent = 'Controllo gli annunci attuali…';
    $('exRows').replaceChildren();
    openSheet(d);
    try {
      const data = await api(`/api/explain?rule_id=${r.id}`);
      const ok = data.rows.filter((x) => !x.reasons.length).length;
      if (data.note) { $('exInfo').textContent = data.note; return; }
      $('exInfo').textContent = data.rows.length
        ? `${data.cmTrend ? `Tendenza Cardmarket ${money(Math.round(data.cmTrend * 100))}. ` : ''}${data.total} annunci in vendita, i ${data.rows.length} più economici qui sotto. ${ok ? `${ok} rispettano i filtri e fanno scattare l’alert.` : 'Nessuno rispetta i filtri.'}`
        : 'CardTrader non mostra annunci per questa carta.';
      $('exRows').replaceChildren(
        ...data.rows.map((x) =>
          el('div', { class: 'lrow' },
            el('span', { class: 'p', text: money(x.cents, x.currency) }),
            el('span', { class: 'd', text: [x.condition, x.language, x.seller].filter(Boolean).join(' · ') + (x.zero ? ' · Zero' : '') }),
            el('span', x.reasons.length ? { class: 'why', text: x.reasons.join(', ') } : { class: 'zero-tag', text: 'Valido' }),
          ),
        ),
      );
    } catch (e) {
      $('exInfo').textContent = e.message;
    }
  }

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
      $('cardsMsg').textContent = `Impossibile caricare le carte: ${e.message}`;
    }
  }
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
    renderCmBox(c);
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
              el('a', { class: 'lrow link', href: cardUrl(c.id), target: '_blank', rel: 'noopener noreferrer', title: 'Apri su CardTrader' },
                el('span', { class: 'p', text: money(r.cents, r.currency) }),
                el('span', { class: 'd', text: [r.condition, r.language && r.language.toUpperCase(), r.seller && `${r.seller}${r.country ? ' (' + r.country + ')' : ''}`, r.quantity > 1 && `x${r.quantity}`].filter(Boolean).join(' · ') }),
                r.zero ? el('span', { class: 'zero-tag', text: 'Zero' }) : null,
                el('span', { class: 'go', text: '↗' }),
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
    } else if (pct) body.minDiscount = Number($('alertPct').value);
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

  // ---------- notifiche ----------
  function urlB64ToUint8(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  }
  let pushSynced = false;
  // Ogni dispositivo ricorda la propria iscrizione: quando cambia, il server sostituisce quella vecchia invece di aggiungerne un'altra.
  function subscribeOnServer(endpoint, only = false) {
    let replaces = null;
    try { replaces = localStorage.getItem('snipe.pushEndpoint'); } catch {}
    return api('/api/subscribe', { method: 'POST', body: JSON.stringify({ endpoint, replaces, only }) }).then((r) => {
      try { localStorage.setItem('snipe.pushEndpoint', endpoint); } catch {}
      return r;
    });
  }
  let resubscribing = false;

  async function updatePushUI() {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const badge = $('pushBadge');
    const setBadge = (cls, text) => { badge.className = 'state ' + cls; badge.textContent = text; };
    document.querySelectorAll('[data-ios]').forEach((li) => (li.hidden = !ios));

    if (!supported || (ios && !standalone)) {
      setBadge('off', 'Non disponibili');
      $('pushInfo').textContent = ios && !standalone
        ? 'Su iPhone le notifiche funzionano solo dall’app installata: aggiungila alla Home e aprila da lì.'
        : 'Questo browser non supporta le notifiche push.';
      $('pushEnable').disabled = true;
      $('pushTest').disabled = true;
      return;
    }
    if (Notification.permission === 'denied') {
      setBadge('off', 'Bloccate');
      $('pushInfo').textContent = 'Le notifiche sono bloccate per questo sito: riabilitale dalle impostazioni del browser.';
      $('pushEnable').disabled = true;
      $('pushTest').disabled = true;
      return;
    }
    let sub = null;
    try {
      const reg = await navigator.serviceWorker.ready;
      sub = await reg.pushManager.getSubscription();
    } catch {}
    // Il telefono a volte cancella l'iscrizione (risparmio energetico, permessi revocati per inattività):
    // se il permesso c'è ancora ma l'iscrizione no, la rifacciamo da soli senza chiedere nulla.
    if (!sub && Notification.permission === 'granted' && state && state.vapidPublic && !resubscribing) {
      resubscribing = true;
      try {
        const reg = await navigator.serviceWorker.ready;
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(state.vapidPublic) });
        await subscribeOnServer(sub.endpoint);
        pushSynced = true;
      } catch {} finally { resubscribing = false; }
    }
    if (sub && Notification.permission === 'granted') {
      if (!pushSynced) {
        pushSynced = true;
        subscribeOnServer(sub.endpoint).catch(() => {});
      }
      setBadge('on', 'Attive');
      $('pushInfo').textContent = 'Questo dispositivo riceve una notifica quando un annuncio rispetta uno dei tuoi alert.';
      $('pushEnable').textContent = 'Notifiche attive';
      $('pushEnable').disabled = true;
      $('pushTest').disabled = false;
    } else {
      setBadge('', 'Non attive');
      $('pushInfo').textContent = 'Attivale per ricevere un avviso anche con l’app chiusa.';
      $('pushEnable').textContent = 'Attiva notifiche';
      $('pushEnable').disabled = !state || !state.vapidPublic;
      $('pushTest').disabled = true;
    }
  }

  $('pushEnable').addEventListener('click', async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { await updatePushUI(); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(state.vapidPublic) });
      await subscribeOnServer(sub.endpoint);
      pushSynced = true;
      await refresh();
    } catch (e) {
      $('pushInfo').textContent = `Impossibile attivare le notifiche: ${e.message}`;
    }
  });
  $('pushOnly').addEventListener('click', async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { $('pushInfo').textContent = 'Attiva prima le notifiche su questo dispositivo.'; return; }
      await subscribeOnServer(sub.endpoint, true);
      await refresh();
      $('pushInfo').textContent = 'Ora le notifiche arrivano solo a questo dispositivo.';
    } catch (e) { $('pushInfo').textContent = e.message; }
  });
  $('pushTest').addEventListener('click', async () => {
    try {
      const r = await api('/api/test-push', { method: 'POST' });
      $('pushInfo').textContent = r.sent ? 'Notifica di prova inviata: dovrebbe arrivare entro pochi secondi.' : 'Non è stato possibile inviarla: riattiva le notifiche su questo dispositivo.';
      await refresh();
    } catch (e) { $('pushInfo').textContent = e.message; }
  });
  $('clearAlerts').addEventListener('click', async () => { await api('/api/alerts', { method: 'DELETE' }); knownTop = null; refresh(); });

  // ---------- avvio ----------
  async function start() {
    $('login').hidden = true;
    $('app').hidden = false;
    await refresh();
    api('/api/expansions').then((l) => { expansions = l; fillCardExpansions(); }).catch((e) => {
      $('cardsMsg').textContent = `Elenco espansioni non disponibile: ${e.message}`;
      $('cardsMsg').hidden = false;
    });
    clearInterval(timer);
    timer = setInterval(refresh, 5000);
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (key) start(); else showLogin('');
})();
