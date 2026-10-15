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
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) if (c) n.append(c);
    return n;
  }
  const money = (c, cur) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: cur || 'EUR' }).format((c || 0) / 100);
  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s fa`;
    if (s < 3600) return `${Math.floor(s / 60)}m fa`;
    if (s < 86400) return `${Math.floor(s / 3600)}h fa`;
    return `${Math.floor(s / 86400)}g fa`;
  }
  function beep() {
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
  document.querySelectorAll('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
      for (const t of ['alerts', 'cards', 'rules', 'settings']) $(`tab-${t}`).hidden = t !== b.dataset.tab;
    }),
  );

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
        const hot = a.discount >= 0.5;
        const meta = [a.expansion, a.condition, a.language && a.language.toUpperCase(), a.seller && `${a.seller}${a.country ? ' (' + a.country + ')' : ''}`, a.zero && 'Zero']
          .filter(Boolean)
          .join(' · ');
        return el(
          'a',
          { class: 'alert' + (hot ? ' hot' : ''), href: a.url || '#', target: '_blank', rel: 'noopener noreferrer' },
          el('div', { class: 'main' },
            el('div', { class: 'name', text: a.name || '' }),
            el('div', { class: 'meta', text: meta }),
            a.test ? null : el('div', { class: 'prices' },
              el('span', { class: 'price', text: money(a.cents, a.currency) }),
              el('span', { class: 'ref', text: money(a.refCents, a.currency) }),
            ),
          ),
          el('div', { class: 'side' },
            a.test ? null : el('span', { class: 'badge', text: `−${Math.round(a.discount * 100)}%` }),
            el('span', { class: 'when', text: ago(a.ts) }),
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
        const zeroTxt = r.zero === 'only' ? 'solo Zero' : r.zero === 'exclude' ? 'senza Zero' : '';
        const parts = [
          r.maxPriceCents ? `sotto ${money(r.maxPriceCents)}` : `da −${r.minDiscount}%`,
          r.nameContains && `“${r.nameContains}”`,
          r.minCondition,
          r.language ? r.language.toUpperCase() : 'tutte le lingue',
          zeroTxt,
          !r.maxPriceCents && !r.blueprintId && `da ${money(r.minPriceCents)}`,
        ].filter(Boolean);
        const title = r.cardName ? `${r.cardName} · ${r.expansionName || ''}` : r.expansionName || `Espansione ${r.expansionId}`;
        return el('div', { class: 'rule' + (r.enabled ? '' : ' off') },
          r.cardImage ? el('img', { class: 'thumb', src: r.cardImage, alt: '', loading: 'lazy' }) : null,
          el('div', { class: 'info' },
            el('div', { class: 't', text: title }),
            el('div', { class: 'd', text: parts.join(' · ') }),
          ),
          el('button', { class: 'btn', type: 'button', 'aria-label': r.enabled ? 'Metti in pausa' : 'Riattiva', text: r.enabled ? 'Pausa' : 'Attiva',
            onclick: () => saveRule({ ...r, minPrice: r.minPriceCents / 100, maxPrice: r.maxPriceCents ? r.maxPriceCents / 100 : null, enabled: !r.enabled }) }),
          el('button', { class: 'btn danger', type: 'button', 'aria-label': 'Elimina regola', text: 'Elimina',
            onclick: async () => { await api(`/api/rules/${r.id}`, { method: 'DELETE' }); refresh(); } }),
        );
      }),
    );
    $('ruleEmpty').hidden = state.rules.length > 0;

    // impostazioni
    const supported = 'serviceWorker' in navigator && 'PushManager' in window;
    $('pushInfo').textContent = !supported
      ? 'Questo browser non supporta le notifiche push.'
      : !state.vapidPublic
        ? 'Chiavi VAPID mancanti su Cloudflare: vedi il README.'
        : `Dispositivi registrati: ${state.pushDevices}.`;
    $('pushEnable').disabled = !supported || !state.vapidPublic;
    $('pushTest').disabled = !state.pushDevices;
  }

  async function refresh() {
    try {
      state = await api('/api/state');
      if (!$('minCondition').options.length) {
        for (const c of state.conditions) $('minCondition').append(el('option', { value: c, text: c }));
        $('minCondition').value = 'Slightly Played';
        for (const c of state.conditions) $('alertCond').append(el('option', { value: c, text: c }));
        $('alertCond').value = 'Slightly Played';
      }
      render();
    } catch {}
  }

  // ---------- regole ----------
  function fillExpansions() {
    const q = $('expFilter').value.trim().toLowerCase();
    const sel = $('expSelect');
    const prev = sel.value;
    const items = expansions.filter((e) => !q || e.name.toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q));
    sel.replaceChildren(...items.map((e) => el('option', { value: e.id, text: `${e.name} (${e.code})` })));
    if (items.some((e) => String(e.id) === prev)) sel.value = prev;
  }
  function fillCardExpansions() {
    const q = $('cardExpFilter').value.trim().toLowerCase();
    const sel = $('cardExp');
    const prev = sel.value;
    const items = expansions.filter((e) => !q || e.name.toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q));
    sel.replaceChildren(el('option', { value: '', text: items.length ? 'Scegli un’espansione…' : 'Nessun risultato' }), ...items.map((e) => el('option', { value: e.id, text: `${e.name} (${e.code})` })));
    if (items.some((e) => String(e.id) === prev)) sel.value = prev;
  }
  $('cardExpFilter').addEventListener('input', fillCardExpansions);
  $('expFilter').addEventListener('input', fillExpansions);
  $('minDiscount').addEventListener('input', () => ($('discLabel').textContent = `${$('minDiscount').value}%`));

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

  $('ruleForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const id = $('expSelect').value;
    const exp = expansions.find((e) => String(e.id) === id);
    if (!exp) return;
    const ok = await saveRule({
      expansionId: exp.id,
      expansionName: exp.name,
      nameContains: $('nameContains').value,
      minCondition: $('minCondition').value,
      language: $('language').value,
      minDiscount: Number($('minDiscount').value),
      minPrice: Number($('minPrice').value),
      zero: $('ruleZero').value,
    });
    if (ok) $('nameContains').value = '';
  });

  // ---------- carte ----------
  let cards = [];
  let currentExp = null;
  let current = null;

  function priceText(c) {
    const zero = $('cardPriceMode').value === 'zero';
    const v = zero ? c.lowestZero : c.lowest;
    return v == null ? '—' : money(v, c.currency);
  }

  function renderCards() {
    const q = $('cardSearch').value.trim().toLowerCase();
    const zeroMode = $('cardPriceMode').value === 'zero';
    const list = cards.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.number || '').toLowerCase() === q);
    $('cardGrid').replaceChildren(
      ...list.map((c) =>
        el('button', { class: 'tile', type: 'button', onclick: () => openCard(c) },
          c.image ? el('img', { src: c.image, alt: '', loading: 'lazy' }) : el('div', { class: 'noimg', text: 'Nessuna immagine' }),
          el('div', { class: 'nm', text: c.name + (c.version ? ` (${c.version})` : '') }),
          el('div', { class: 'sub', text: [c.number && '#' + c.number, c.rarity].filter(Boolean).join(' · ') || ' ' }),
          el('div', { class: 'pr', text: priceText(c) }),
          zeroMode || c.lowestZero == null ? null : el('div', { class: 'pz', text: 'Zero ' + money(c.lowestZero, c.currency) }),
        ),
      ),
    );
    const msg = $('cardsMsg');
    msg.hidden = list.length > 0 && !!currentExp;
    msg.textContent = !currentExp
      ? 'Scegli un’espansione per vedere le carte.'
      : list.length
        ? ''
        : cards.length
          ? `Nessuna carta corrisponde a “${q}” (${cards.length} carte in questa espansione). Nelle espansioni giapponesi i nomi possono essere in giapponese: prova con il numero della carta.`
          : 'CardTrader non ha restituito carte per questa espansione.';
  }

  async function loadCards() {
    const id = $('cardExp').value;
    currentExp = id ? expansions.find((e) => String(e.id) === id) : null;
    cards = [];
    renderCards();
    if (!currentExp) return;
    $('cardsMsg').hidden = false;
    $('cardsMsg').textContent = 'Carico le carte…';
    try {
      const data = await api(`/api/cards?expansion_id=${currentExp.id}`);
      if (!currentExp || String(currentExp.id) !== String(data.expansionId)) return;
      cards = data.cards;
      renderCards();
    } catch (e) {
      $('cardsMsg').hidden = false;
      $('cardsMsg').textContent = `Impossibile caricare le carte: ${e.message}`;
    }
  }
  $('cardExp').addEventListener('change', loadCards);
  $('cardSearch').addEventListener('input', renderCards);
  $('cardPriceMode').addEventListener('change', renderCards);

  async function openCard(c) {
    current = c;
    $('dlgName').textContent = c.name + (c.version ? ` (${c.version})` : '');
    $('dlgImg').src = c.image || '';
    $('dlgMeta').textContent = [currentExp && currentExp.name, c.number && '#' + c.number, c.rarity].filter(Boolean).join(' · ');
    $('dlgLow').textContent = c.lowest == null ? '—' : money(c.lowest, c.currency);
    $('dlgLowZero').textContent = c.lowestZero == null ? '—' : money(c.lowestZero, c.currency);
    $('alertError').hidden = true;
    $('alertOk').hidden = true;
    const base = c.lowest == null ? '' : (Math.floor((c.lowest * 0.8) / 50) * 0.5).toFixed(2);
    $('alertMax').value = base && Number(base) > 0 ? base : c.lowest == null ? '' : (c.lowest / 100).toFixed(2);
    $('dlgListings').replaceChildren(el('p', { class: 'muted', text: 'Carico gli annunci…' }));
    const d = $('cardDialog');
    if (!d.open) d.showModal();
    try {
      const rows = await api(`/api/listings?blueprint_id=${c.id}`);
      if (current !== c) return;
      $('dlgListings').replaceChildren(
        ...(rows.length
          ? rows.map((r) =>
              el('div', { class: 'lrow' },
                el('span', { class: 'p', text: money(r.cents, r.currency) }),
                el('span', { class: 'd', text: [r.condition, r.language && r.language.toUpperCase(), r.seller && `${r.seller}${r.country ? ' (' + r.country + ')' : ''}`, r.quantity > 1 && `x${r.quantity}`].filter(Boolean).join(' · ') }),
                r.zero ? el('span', { class: 'zero-tag', text: 'Zero' }) : null,
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
      const pct = document.querySelector('input[name="amode"]:checked').value === 'percent';
      $('amodePrice').hidden = pct;
      $('amodePercent').hidden = !pct;
    }),
  );
  $('alertPct').addEventListener('input', () => ($('alertPctLabel').textContent = `${$('alertPct').value}%`));

  $('alertForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!current || !currentExp) return;
    const pct = document.querySelector('input[name="amode"]:checked').value === 'percent';
    $('alertError').hidden = true;
    $('alertOk').hidden = true;
    const body = {
      expansionId: currentExp.id,
      expansionName: currentExp.name,
      blueprintId: current.id,
      cardName: current.name + (current.version ? ` (${current.version})` : ''),
      cardImage: current.image,
      zero: $('alertZero').value,
      minCondition: $('alertCond').value,
      language: $('alertLang').value,
      minPrice: 0,
    };
    if (pct) body.minDiscount = Number($('alertPct').value);
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
  $('pushEnable').addEventListener('click', async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { $('pushInfo').textContent = 'Permesso negato: abilitalo dalle impostazioni del browser.'; return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(state.vapidPublic) });
      await api('/api/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
      await refresh();
    } catch (e) {
      $('pushInfo').textContent = `Impossibile attivare le notifiche: ${e.message}`;
    }
  });
  $('pushTest').addEventListener('click', async () => {
    try { await api('/api/test-push', { method: 'POST' }); await refresh(); } catch (e) { $('pushInfo').textContent = e.message; }
  });
  $('runDebug').addEventListener('click', async () => {
    const out = $('debugOut');
    out.hidden = false;
    out.textContent = 'Controllo…';
    try {
      const id = $('cardExp').value;
      const r = await api('/api/debug' + (id ? `?expansion_id=${id}` : ''));
      out.textContent = JSON.stringify(r, null, 2);
    } catch (e) {
      out.textContent = 'Errore: ' + e.message;
    }
  });
  $('clearAlerts').addEventListener('click', async () => { await api('/api/alerts', { method: 'DELETE' }); knownTop = null; refresh(); });

  // ---------- avvio ----------
  async function start() {
    $('login').hidden = true;
    $('app').hidden = false;
    await refresh();
    api('/api/expansions').then((l) => { expansions = l; fillExpansions(); fillCardExpansions(); }).catch((e) => {
      $('ruleError').textContent = `Elenco espansioni non disponibile: ${e.message}`;
      $('ruleError').hidden = false;
    });
    clearInterval(timer);
    timer = setInterval(refresh, 5000);
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (key) start(); else showLogin('');
})();
