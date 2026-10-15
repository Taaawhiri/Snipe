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
      for (const t of ['alerts', 'rules', 'settings']) $(`tab-${t}`).hidden = t !== b.dataset.tab;
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
        const meta = [a.expansion, a.condition, a.language && a.language.toUpperCase(), a.seller && `${a.seller}${a.country ? ' (' + a.country + ')' : ''}`]
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
        const parts = [
          `da −${r.minDiscount}%`,
          r.nameContains && `“${r.nameContains}”`,
          r.minCondition,
          r.language ? r.language.toUpperCase() : 'tutte le lingue',
          `da ${money(r.minPriceCents)}`,
        ].filter(Boolean);
        return el('div', { class: 'rule' + (r.enabled ? '' : ' off') },
          el('div', { class: 'info' },
            el('div', { class: 't', text: r.expansionName || `Espansione ${r.expansionId}` }),
            el('div', { class: 'd', text: parts.join(' · ') }),
          ),
          el('button', { class: 'btn', type: 'button', 'aria-label': r.enabled ? 'Metti in pausa' : 'Riattiva', text: r.enabled ? 'Pausa' : 'Attiva',
            onclick: () => saveRule({ ...r, minPrice: r.minPriceCents / 100, enabled: !r.enabled }) }),
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
    });
    if (ok) $('nameContains').value = '';
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
  $('clearAlerts').addEventListener('click', async () => { await api('/api/alerts', { method: 'DELETE' }); knownTop = null; refresh(); });

  // ---------- avvio ----------
  async function start() {
    $('login').hidden = true;
    $('app').hidden = false;
    await refresh();
    api('/api/expansions').then((l) => { expansions = l; fillExpansions(); }).catch((e) => {
      $('ruleError').textContent = `Elenco espansioni non disponibile: ${e.message}`;
      $('ruleError').hidden = false;
    });
    clearInterval(timer);
    timer = setInterval(refresh, 5000);
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (key) start(); else showLogin('');
})();
