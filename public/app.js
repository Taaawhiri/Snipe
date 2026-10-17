// public/app.js è generato: le parti si modificano in ui/ e si ricompongono con "npm run build".
(() => {
  const $ = (id) => document.getElementById(id);
  // L'accesso è un cookie di sessione (HttpOnly): il token CardTrader resta sul server.
  try { localStorage.removeItem('snipe.key'); } catch {}

  let state = null;
  let expansions = [];
  let knownTop = null;
  let timer = null;

  // ---------- rete ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      credentials: 'same-origin',
      headers: opts.body ? { 'content-type': 'application/json' } : {},
    });
    if (res.status === 401) {
      showLogin('');
      throw new Error('401');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
    return data;
  }

  // ---------- utilità ----------
  const plainText = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  /** Numeri grandi in poco spazio: 8.086 · 12,3 mila · 1,2 Mln. */
  const compactNum = (n) => (n < 10_000 ? n.toLocaleString('it-IT') : n < 1_000_000 ? `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace('.', ',').replace(',0', '')} mila` : `${(n / 1e6).toFixed(1).replace('.', ',').replace(',0', '')} Mln`);
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
  // Formato europeo con il punto delle migliaia anche a 4 cifre (4.323,85 €): l'italiano di Intl lo omette sotto i 10.000.
  const money = (c, cur) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur || 'EUR' }).format((c || 0) / 100);
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


  /** Rarità da una versione CardTrader: "Illustration Rare | 075/066", "CSFC | Gold Secret Rare | 026/021", "001/028".
   *  Prende il pezzo che sembra una rarità; codici di set e numeri non contano. */
  function rarityFromVersion(v) {
    const parts = String(v || '').split('|').map((x) => x.trim()).filter(Boolean);
    return parts.find((p) => /rare|art\b|-art|holo|promo|common|uncommon|ace spec|radiant|amazing|shiny|reverse/i.test(p) && !/^\S*\d+\s*\/\s*\S*\d+$/.test(p)) || '';
  }
  // ---------- pannelli a comparsa ----------
  const sheets = ['cardDialog', 'editDialog', 'explainDialog', 'sellerDialog', 'ownDialog', 'scanDialog', 'batchDialog'].map((id) => $(id));
  function openSheet(d) {
    if (!d.open) d.show(); // non modale: il browser non usa il livello superiore
    // L'ultima scheda aperta va sopra le altre (es. "Ce l'ho" aperta dalla scansione).
    sheets.forEach((s) => { s.style.zIndex = ''; });
    d.style.zIndex = 49;
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

  // ---------- selettori ----------
  // Le tendine di sistema (<select>) si aprono come pannello nostro dal basso, nello stile dell'app.
  // La <select> resta nel DOM e tiene il valore: chi la legge o ascolta "change" non cambia.
  const cselButtons = new Map();
  function cselLabel(sel) {
    const o = sel.options[sel.selectedIndex];
    return o ? o.textContent : '';
  }
  function cselSync(sel) {
    const b = cselButtons.get(sel);
    if (!b) return;
    b.querySelector('.cs-txt').textContent = cselLabel(sel);
    b.disabled = sel.disabled;
  }
  function cselOpen(sel) {
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const lab = document.querySelector(`label[for="${sel.id}__btn"]`);
    const title = (lab && lab.textContent) || sel.getAttribute('aria-label') || '';
    const rows = [...sel.options].filter((o) => !o.hidden).map((o) =>
      el('button', { class: 'cs-opt' + (o.selected ? ' sel' : ''), type: 'button', ...(o.disabled ? { disabled: '' } : {}),
        onclick: () => { sel.value = o.value; cselSync(sel); close(); sel.dispatchEvent(new Event('change', { bubbles: true })); } },
        el('span', { text: o.textContent }), o.selected ? el('span', { class: 'cs-check', text: '✓' }) : null));
    const ov = el('div', { class: 'cs-overlay', onclick: (e) => { if (e.target === ov) close(); } },
      el('div', { class: 'cs-sheet', role: 'listbox', 'aria-label': title },
        el('div', { class: 'cs-grab' }),
        title ? el('div', { class: 'cs-title', text: title }) : null,
        el('div', { class: 'cs-list' }, ...rows)));
    document.body.append(ov);
    document.addEventListener('keydown', onKey);
    const cur = ov.querySelector('.cs-opt.sel');
    if (cur) cur.scrollIntoView({ block: 'center' });
  }
  function cselWrap(sel) {
    if (cselButtons.has(sel) || sel.hidden || sel.multiple || sel.size > 1 || sel.closest('[data-native]')) return;
    const b = el('button', { class: 'cs-btn', type: 'button', onclick: () => cselOpen(sel) }, el('span', { class: 'cs-txt' }), el('span', { class: 'cs-arrow', 'aria-hidden': 'true', text: '▾' }));
    if (sel.id) { b.id = `${sel.id}__btn`; const lab = document.querySelector(`label[for="${sel.id}"]`); if (lab) lab.htmlFor = b.id; }
    sel.classList.add('cs-native');
    sel.tabIndex = -1;
    sel.after(b);
    cselButtons.set(sel, b);
    cselSync(sel);
    // Opzioni aggiunte o tradotte: aggiorna il testo del pulsante.
    new MutationObserver(() => cselSync(sel)).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true });
  }
  // Valori impostati dal codice (sel.value = …) non generano eventi: aggiorniamo il pulsante qui.
  for (const prop of ['value', 'selectedIndex']) {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
    Object.defineProperty(HTMLSelectElement.prototype, prop, { ...d, set(v) { d.set.call(this, v); cselSync(this); } });
  }
  document.addEventListener('change', (e) => { if (e.target instanceof HTMLSelectElement) cselSync(e.target); }, true);
  const cselScan = () => document.querySelectorAll('select').forEach(cselWrap);
  cselScan();
  new MutationObserver(cselScan).observe(document.body, { childList: true, subtree: true });

  // ---------- finestre di conferma ----------
  // Al posto di alert/confirm/prompt del browser: stesso pannello dal basso dei selettori.
  function dialog({ title = '', text = '', ok = 'OK', cancel = null, danger = false, input = null }) {
    return new Promise((resolve) => {
      let field = null;
      const done = (v) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') done(cancel ? (input ? null : false) : true); if (e.key === 'Enter' && !input) done(input ? field.value : true); };
      if (input) field = el('input', { class: 'cs-input', type: 'text', placeholder: input.placeholder || '', autocomplete: 'off', 'aria-label': title || text });
      const ov = el('div', { class: 'cs-overlay', onclick: (e) => { if (e.target === ov && cancel) done(input ? null : false); } },
        el('div', { class: 'cs-sheet cs-dialog', role: 'alertdialog', 'aria-label': title || text },
          el('div', { class: 'cs-grab' }),
          title ? el('div', { class: 'cs-title', text: title }) : null,
          el('p', { class: 'cs-text', text }),
          field,
          el('div', { class: 'cs-actions' },
            cancel ? el('button', { class: 'btn', type: 'button', text: cancel, onclick: () => done(input ? null : false) }) : null,
            el('button', { class: 'btn ' + (danger ? 'danger-solid' : 'primary'), type: 'button', text: ok, onclick: () => done(input ? field.value : true) }))));
      document.body.append(ov);
      document.addEventListener('keydown', onKey);
      (field || ov.querySelector('.cs-actions .btn:last-child')).focus({ preventScroll: true });
    });
  }
  const askConfirm = (text, opts = {}) => dialog({ cancel: 'Annulla', ok: 'Conferma', ...opts, text });
  // Sostituisce alert() del browser in tutta l'app (le parti dopo questa usano questo).
  function alert(text) { return dialog({ text: String(text) }); }

  // ---------- conferme veloci (toast) ----------
  let toastTimer = null;
  function toast(text, kind = 'ok') {
    let t = document.getElementById('toast');
    if (!t) { t = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
    t.className = `toast ${kind}`;
    t.textContent = text;
    t.hidden = false;
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 250); }, 2600);
  }
  // ---------- link esterni ----------
  // Su telefono, toccando un link a CardTrader o Cardmarket si apre il menu "Apri con un'altra app" del sistema:
  // da lì si sceglie il browser, e la pagina si apre fuori dalla webapp. Su computer il link si apre normalmente.
  const isMobileOS = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest && ev.target.closest('a[target="_blank"]');
    if (!a || a.dataset.direct || !isMobileOS || !navigator.share) return;
    let u;
    try { u = new URL(a.href); } catch { return; }
    if (u.origin === location.origin || !/^https?:$/.test(u.protocol)) return;
    ev.preventDefault();
    const title = (a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) || 'HoloSnipe';
    navigator.share({ title, url: u.href }).catch(() => { /* menu chiuso senza scegliere */ });
  });

  // ---------- login ----------
  function showLogin(msg) {
    if (!$('loginPlans').childElementCount) $('loginPlans').replaceChildren(...planTable('free'));
    clearInterval(timer);
    $('app').hidden = true;
    $('login').hidden = false;
    const e = $('loginError');
    e.hidden = !msg;
    e.textContent = msg || '';
  }
  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter || $('loginForm').querySelector('button');
    btn.disabled = true;
    try {
      const res = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: $('keyInput').value.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
      $('keyInput').value = '';
      start();
    } catch (e) {
      showLogin(e.message);
    } finally {
      btn.disabled = false;
    }
  });
  $('logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
    showLogin('');
  });

  // ---------- tab ----------
  function goTab(name) {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
    for (const t of ['alerts', 'cards', 'deals', 'rules', 'settings']) $(`tab-${t}`).hidden = t !== name;
    if (name === 'deals') loadDeals();
    if (name === 'alerts' && !$('collView').hidden) loadCollection();
    if (name === 'settings' && isOwner()) loadAdmin();
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.tab)));
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.go)));

  // Eliminare un alert cancella anche i suoi avvisi, quindi chiediamo conferma.
  function confirmDelete(r) {
    return askConfirm(`Anche i suoi avvisi verranno cancellati.`, { title: `Eliminare l'alert "${r.cardName || r.expansionName}"?`, ok: 'Elimina', danger: true });
  }

  async function deleteAlert(a) {
    try {
      await api('/api/alerts/delete', { method: 'POST', body: JSON.stringify({ id: a.id }) });
      state.alerts = state.alerts.filter((x) => x.id !== a.id);
      render();
    } catch (e) {
      alert(e.message);
    }
  }
  $('clearSeen').addEventListener('click', async () => {
    const n = state.alerts.filter((a) => a.mark === 'seen').length;
    if (!(await askConfirm('Gli avvisi segnati come comprati restano.', { title: `Eliminare ${n} ${n === 1 ? 'avviso visto' : 'avvisi visti'}?`, ok: 'Elimina', danger: true }))) return;
    try {
      await api('/api/alerts/delete', { method: 'POST', body: JSON.stringify({ seen: true }) });
      state.alerts = state.alerts.filter((a) => a.mark !== 'seen');
      render();
    } catch (e) {
      alert(e.message);
    }
  });

  async function markAlert(a, mark) {
    try {
      await api('/api/alerts/mark', { method: 'POST', body: JSON.stringify({ id: a.id, mark }) });
      a.mark = mark;
      refresh();
    } catch (e) {
      alert(e.message);
    }
  }
  document.querySelectorAll('input[name="afilter"]').forEach((r) => r.addEventListener('change', render));

  function renderWish() {
    const wl = $('wishList');
    const wish = state.wish || [];
    const have = new Set(wish.map((w) => w.id));
    const missing = new Set(state.rules.filter((r) => r.blueprintId && !have.has(r.blueprintId)).map((r) => r.blueprintId)).size;
    $('wishFromRules').hidden = !missing;
    $('wishFromRules').textContent = `♥ Aggiungi le carte dei tuoi alert (${missing})`;
    wl.replaceChildren(
      ...(wish.length
        ? wish.map((w) => {
            const last = w.last;
            const trend = last && w.prev && w.prev !== last ? last.min - w.prev.min : null;
            return el('div', { class: 'rule wish' },
              thumb(w.image),
              el('div', { class: 'info' },
                el('div', null,
                  el('div', { class: 't', text: w.name }),
                  el('div', { class: 'e', text: w.expName || '' }),
                ),
                el('div', { class: 'chips' },
                  w.lang ? chip(w.lang.toUpperCase(), 'lang') : null,
                  chip(last ? `Da ${money(last.min)}` : w.lang && w.read ? `Nessuna copia NM in ${w.lang.toUpperCase()} ora` : 'Prezzo in arrivo…', 'on'),
                  last && last.zero != null ? chip(`Zero ${money(last.zero)}`, 'zero') : null,
                  trend ? chip(`${trend < 0 ? '▼' : '▲'} ${money(Math.abs(trend))} in 7 giorni`, trend < 0 ? 'good' : 'warn') : null,
                ),
              ),
              el('div', { class: 'acts' },
                el('button', { class: 'btn', type: 'button', text: 'Apri', onclick: () => openCard({ id: w.id, name: w.name, image: w.image, expansionId: w.expansionId, expName: w.expName, currency: 'EUR', fromWish: true }) }),
                el('button', { class: 'btn danger', type: 'button', text: 'Togli', onclick: () => toggleWish({ id: w.id }, true) }),
              ),
            );
          })
        : [el('p', { class: 'muted', text: 'La lista è vuota.' })]),
    );
  }

  const wishFromRule = (r) => ({ id: r.blueprintId, name: r.cardName, image: r.cardImage, expansionId: r.expansionId, expName: r.expansionName, lang: String(r.language || '').split(',')[0] });

  async function wishAllFromRules() {
    const have = new Set((state.wish || []).map((w) => w.id));
    const todo = [...new Map(state.rules.filter((r) => r.blueprintId && !have.has(r.blueprintId)).map((r) => [r.blueprintId, r])).values()];
    for (const r of todo) {
      try {
        const c = wishFromRule(r);
        state.wish = await api('/api/wish', { method: 'POST', body: JSON.stringify({ id: c.id, name: c.name, image: c.image, expansionId: c.expansionId, expName: c.expName, lang: c.lang }) });
      } catch (e) {
        alert(e.message); // per esempio il limite del piano
        break;
      }
    }
    refresh();
  }

  async function toggleWish(c, remove) {
    try {
      state.wish = await api('/api/wish', { method: 'POST', body: JSON.stringify({ id: c.id, name: c.name + (c.version ? ` (${c.version})` : ''), image: c.image, expansionId: c.expansionId || (dlgExp && dlgExp.id), expName: c.expName || (dlgExp && dlgExp.name), lang: c.lang != null ? c.lang : $('cardLang').value, remove }) });
      renderWish();
      updateWishBtn();
      refresh();
    } catch (e) {
      alert(e.message);
    }
  }

  function updateWishBtn() {
    if (!current) return;
    const inWish = (state.wish || []).some((w) => w.id === current.id);
    $('dlgWish').textContent = inWish ? '★ Nei desideri' : '☆ Desideri';
    $('dlgWish').classList.toggle('on', inWish);
    $('dlgWish').title = inWish ? 'Togli dalla lista dei desideri' : 'Aggiungi alla lista dei desideri';
  }
  $('wishFromRules').addEventListener('click', wishAllFromRules);
  $('dlgWish').addEventListener('click', () => current && toggleWish(current, (state.wish || []).some((w) => w.id === current.id)));

  /** Grafico dei prezzi giornalieri: linea piena = più basso, tratteggiata = con Zero. */
  async function renderHistory(c) {
    const box = $('dlgHist');
    box.hidden = true;
    let h;
    try {
      h = await api(`/api/history?blueprint_id=${c.id}`);
    } catch {
      return;
    }
    if (current !== c) return;
    if (!h.length) return;
    box.hidden = false;
    const W = 320, H = 110, P = 6;
    const vals = h.flatMap((p) => [p.min, p.zero]).filter((v) => v != null);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const x = (i) => (h.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (h.length - 1));
    const y = (v) => (hi === lo ? H / 2 : H - P - ((v - lo) * (H - 2 * P)) / (hi - lo));
    const line = (k) => h.map((p, i) => (p[k] == null ? null : `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`)).filter(Boolean).join(' ');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'histsvg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Andamento del prezzo più basso');
    for (const [k, cls] of [['zero', 'hz'], ['min', 'hm']]) {
      const pl = document.createElementNS(ns, 'polyline');
      pl.setAttribute('points', line(k));
      pl.setAttribute('class', cls);
      svg.append(pl);
      const last = [...h].reverse().find((p) => p[k] != null);
      if (last) {
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', x(h.lastIndexOf(last)));
        dot.setAttribute('cy', y(last[k]));
        dot.setAttribute('r', 3.5);
        dot.setAttribute('class', cls);
        svg.append(dot);
      }
    }
    const first = h[0], last = h[h.length - 1];
    box.replaceChildren(
      el('div', { class: 'histhead' },
        el('span', { class: 'cmtitle', text: `Prezzo più basso · ${h.length === 1 ? 'da oggi' : `ultimi ${h.length} giorni`}` }),
        el('span', { class: 'small muted', text: `min ${money(lo)} · max ${money(hi)}` }),
      ),
      svg,
      el('div', { class: 'histlegend small' },
        el('span', { class: 'lg hm', text: `Più basso ${money(last.min)}` }),
        last.zero != null ? el('span', { class: 'lg hz', text: `Con Zero ${money(last.zero)}` }) : null,
        h.length > 1 ? el('span', { class: 'muted', text: `dal ${first.d.slice(8, 10)}/${first.d.slice(5, 7)}` }) : null,
      ),
    );
  }


  // ---------- Regole: alert, desideri e venditori in tre sezioni separate (in alto, senza scorrere) ----------
  function setRview(v) {
    const r = document.querySelector(`input[name="rview"][value="${v}"]`);
    if (!r) return;
    r.checked = true;
    $('rvAlertsBox').hidden = v !== 'alerts';
    $('rvWishBox').hidden = v !== 'wish';
    $('rvSellersBox').hidden = v !== 'sellers';
    try { localStorage.setItem('snipe.rview', v); } catch {}
  }
  document.querySelectorAll('input[name="rview"]').forEach((r) => r.addEventListener('change', () => setRview(r.value)));
  try { setRview(localStorage.getItem('snipe.rview') || 'alerts'); } catch { setRview('alerts'); }
  /** Numeri accanto ai nomi delle sezioni. */
  function renderRviewCounts() {
    if (!state) return;
    const s = state.sellers || { fav: [], block: [] };
    $('rvAlerts').textContent = `Alert (${state.rules.length})`;
    $('rvWish').textContent = `Desideri (${(state.wish || []).length})`;
    $('rvSellers').textContent = `Venditori (${(s.fav || []).length + (s.block || []).length})`;
  }
  // ---------- tipo di carta (Pokémon / Allenatore / Energie) ----------
  // CardTrader non lo indica: lo ricaviamo dal nome. Se contiene il nome di un Pokémon è un Pokémon
  // (anche "Team Rocket's Persian ex"), se finisce in "Energy" è un'energia, altrimenti un allenatore.
  const SPECIES = new Set('bulbasaur|ivysaur|venusaur|charmander|charmeleon|charizard|squirtle|wartortle|blastoise|caterpie|metapod|butterfree|weedle|kakuna|beedrill|pidgey|pidgeotto|pidgeot|rattata|raticate|spearow|fearow|ekans|arbok|pikachu|raichu|sandshrew|sandslash|nidoran|nidorina|nidoqueen|nidorino|nidoking|clefairy|clefable|vulpix|ninetales|jigglypuff|wigglytuff|zubat|golbat|oddish|gloom|vileplume|paras|parasect|venonat|venomoth|diglett|dugtrio|meowth|persian|psyduck|golduck|mankey|primeape|growlithe|arcanine|poliwag|poliwhirl|poliwrath|abra|kadabra|alakazam|machop|machoke|machamp|bellsprout|weepinbell|victreebel|tentacool|tentacruel|geodude|graveler|golem|ponyta|rapidash|slowpoke|slowbro|magnemite|magneton|farfetchd|doduo|dodrio|seel|dewgong|grimer|muk|shellder|cloyster|gastly|haunter|gengar|onix|drowzee|hypno|krabby|kingler|voltorb|electrode|exeggcute|exeggutor|cubone|marowak|hitmonlee|hitmonchan|lickitung|koffing|weezing|rhyhorn|rhydon|chansey|tangela|kangaskhan|horsea|seadra|goldeen|seaking|staryu|starmie|mr mime|scyther|jynx|electabuzz|magmar|pinsir|tauros|magikarp|gyarados|lapras|ditto|eevee|vaporeon|jolteon|flareon|porygon|omanyte|omastar|kabuto|kabutops|aerodactyl|snorlax|articuno|zapdos|moltres|dratini|dragonair|dragonite|mewtwo|mew|chikorita|bayleef|meganium|cyndaquil|quilava|typhlosion|totodile|croconaw|feraligatr|sentret|furret|hoothoot|noctowl|ledyba|ledian|spinarak|ariados|crobat|chinchou|lanturn|pichu|cleffa|igglybuff|togepi|togetic|natu|xatu|mareep|flaaffy|ampharos|bellossom|marill|azumarill|sudowoodo|politoed|hoppip|skiploom|jumpluff|aipom|sunkern|sunflora|yanma|wooper|quagsire|espeon|umbreon|murkrow|slowking|misdreavus|unown|wobbuffet|girafarig|pineco|forretress|dunsparce|gligar|steelix|snubbull|granbull|qwilfish|scizor|shuckle|heracross|sneasel|teddiursa|ursaring|slugma|magcargo|swinub|piloswine|corsola|remoraid|octillery|delibird|mantine|skarmory|houndour|houndoom|kingdra|phanpy|donphan|porygon2|stantler|smeargle|tyrogue|hitmontop|smoochum|elekid|magby|miltank|blissey|raikou|entei|suicune|larvitar|pupitar|tyranitar|lugia|ho oh|celebi|treecko|grovyle|sceptile|torchic|combusken|blaziken|mudkip|marshtomp|swampert|poochyena|mightyena|zigzagoon|linoone|wurmple|silcoon|beautifly|cascoon|dustox|lotad|lombre|ludicolo|seedot|nuzleaf|shiftry|taillow|swellow|wingull|pelipper|ralts|kirlia|gardevoir|surskit|masquerain|shroomish|breloom|slakoth|vigoroth|slaking|nincada|ninjask|shedinja|whismur|loudred|exploud|makuhita|hariyama|azurill|nosepass|skitty|delcatty|sableye|mawile|aron|lairon|aggron|meditite|medicham|electrike|manectric|plusle|minun|volbeat|illumise|roselia|gulpin|swalot|carvanha|sharpedo|wailmer|wailord|numel|camerupt|torkoal|spoink|grumpig|spinda|trapinch|vibrava|flygon|cacnea|cacturne|swablu|altaria|zangoose|seviper|lunatone|solrock|barboach|whiscash|corphish|crawdaunt|baltoy|claydol|lileep|cradily|anorith|armaldo|feebas|milotic|castform|kecleon|shuppet|banette|duskull|dusclops|tropius|chimecho|absol|wynaut|snorunt|glalie|spheal|sealeo|walrein|clamperl|huntail|gorebyss|relicanth|luvdisc|bagon|shelgon|salamence|beldum|metang|metagross|regirock|regice|registeel|latias|latios|kyogre|groudon|rayquaza|jirachi|deoxys|turtwig|grotle|torterra|chimchar|monferno|infernape|piplup|prinplup|empoleon|starly|staravia|staraptor|bidoof|bibarel|kricketot|kricketune|shinx|luxio|luxray|budew|roserade|cranidos|rampardos|shieldon|bastiodon|burmy|wormadam|mothim|combee|vespiquen|pachirisu|buizel|floatzel|cherubi|cherrim|shellos|gastrodon|ambipom|drifloon|drifblim|buneary|lopunny|mismagius|honchkrow|glameow|purugly|chingling|stunky|skuntank|bronzor|bronzong|bonsly|mime jr|happiny|chatot|spiritomb|gible|gabite|garchomp|munchlax|riolu|lucario|hippopotas|hippowdon|skorupi|drapion|croagunk|toxicroak|carnivine|finneon|lumineon|mantyke|snover|abomasnow|weavile|magnezone|lickilicky|rhyperior|tangrowth|electivire|magmortar|togekiss|yanmega|leafeon|glaceon|gliscor|mamoswine|porygon z|gallade|probopass|dusknoir|froslass|rotom|uxie|mesprit|azelf|dialga|palkia|heatran|regigigas|giratina|cresselia|phione|manaphy|darkrai|shaymin|arceus|victini|snivy|servine|serperior|tepig|pignite|emboar|oshawott|dewott|samurott|patrat|watchog|lillipup|herdier|stoutland|purrloin|liepard|pansage|simisage|pansear|simisear|panpour|simipour|munna|musharna|pidove|tranquill|unfezant|blitzle|zebstrika|roggenrola|boldore|gigalith|woobat|swoobat|drilbur|excadrill|audino|timburr|gurdurr|conkeldurr|tympole|palpitoad|seismitoad|throh|sawk|sewaddle|swadloon|leavanny|venipede|whirlipede|scolipede|cottonee|whimsicott|petilil|lilligant|basculin|sandile|krokorok|krookodile|darumaka|darmanitan|maractus|dwebble|crustle|scraggy|scrafty|sigilyph|yamask|cofagrigus|tirtouga|carracosta|archen|archeops|trubbish|garbodor|zorua|zoroark|minccino|cinccino|gothita|gothorita|gothitelle|solosis|duosion|reuniclus|ducklett|swanna|vanillite|vanillish|vanilluxe|deerling|sawsbuck|emolga|karrablast|escavalier|foongus|amoonguss|frillish|jellicent|alomomola|joltik|galvantula|ferroseed|ferrothorn|klink|klang|klinklang|tynamo|eelektrik|eelektross|elgyem|beheeyem|litwick|lampent|chandelure|axew|fraxure|haxorus|cubchoo|beartic|cryogonal|shelmet|accelgor|stunfisk|mienfoo|mienshao|druddigon|golett|golurk|pawniard|bisharp|bouffalant|rufflet|braviary|vullaby|mandibuzz|heatmor|durant|deino|zweilous|hydreigon|larvesta|volcarona|cobalion|terrakion|virizion|tornadus|thundurus|reshiram|zekrom|landorus|kyurem|keldeo|meloetta|genesect|chespin|quilladin|chesnaught|fennekin|braixen|delphox|froakie|frogadier|greninja|bunnelby|diggersby|fletchling|fletchinder|talonflame|scatterbug|spewpa|vivillon|litleo|pyroar|flabebe|floette|florges|skiddo|gogoat|pancham|pangoro|furfrou|espurr|meowstic|honedge|doublade|aegislash|spritzee|aromatisse|swirlix|slurpuff|inkay|malamar|binacle|barbaracle|skrelp|dragalge|clauncher|clawitzer|helioptile|heliolisk|tyrunt|tyrantrum|amaura|aurorus|sylveon|hawlucha|dedenne|carbink|goomy|sliggoo|goodra|klefki|phantump|trevenant|pumpkaboo|gourgeist|bergmite|avalugg|noibat|noivern|xerneas|yveltal|zygarde|diancie|hoopa|volcanion|rowlet|dartrix|decidueye|litten|torracat|incineroar|popplio|brionne|primarina|pikipek|trumbeak|toucannon|yungoos|gumshoos|grubbin|charjabug|vikavolt|crabrawler|crabominable|oricorio|cutiefly|ribombee|rockruff|lycanroc|wishiwashi|mareanie|toxapex|mudbray|mudsdale|dewpider|araquanid|fomantis|lurantis|morelull|shiinotic|salandit|salazzle|stufful|bewear|bounsweet|steenee|tsareena|comfey|oranguru|passimian|wimpod|golisopod|sandygast|palossand|pyukumuku|type null|silvally|minior|komala|turtonator|togedemaru|mimikyu|bruxish|drampa|dhelmise|jangmo o|hakamo o|kommo o|tapu koko|tapu lele|tapu bulu|tapu fini|cosmog|cosmoem|solgaleo|lunala|nihilego|buzzwole|pheromosa|xurkitree|celesteela|kartana|guzzlord|necrozma|magearna|marshadow|poipole|naganadel|stakataka|blacephalon|zeraora|meltan|melmetal|grookey|thwackey|rillaboom|scorbunny|raboot|cinderace|sobble|drizzile|inteleon|skwovet|greedent|rookidee|corvisquire|corviknight|blipbug|dottler|orbeetle|nickit|thievul|gossifleur|eldegoss|wooloo|dubwool|chewtle|drednaw|yamper|boltund|rolycoly|carkol|coalossal|applin|flapple|appletun|silicobra|sandaconda|cramorant|arrokuda|barraskewda|toxel|toxtricity|sizzlipede|centiskorch|clobbopus|grapploct|sinistea|polteageist|hatenna|hattrem|hatterene|impidimp|morgrem|grimmsnarl|obstagoon|perrserker|cursola|sirfetchd|mr rime|runerigus|milcery|alcremie|falinks|pincurchin|snom|frosmoth|stonjourner|eiscue|indeedee|morpeko|cufant|copperajah|dracozolt|arctozolt|dracovish|arctovish|duraludon|dreepy|drakloak|dragapult|zacian|zamazenta|eternatus|kubfu|urshifu|zarude|regieleki|regidrago|glastrier|spectrier|calyrex|wyrdeer|kleavor|ursaluna|basculegion|sneasler|overqwil|enamorus|sprigatito|floragato|meowscarada|fuecoco|crocalor|skeledirge|quaxly|quaxwell|quaquaval|lechonk|oinkologne|tarountula|spidops|nymble|lokix|pawmi|pawmo|pawmot|tandemaus|maushold|fidough|dachsbun|smoliv|dolliv|arboliva|squawkabilly|nacli|naclstack|garganacl|charcadet|armarouge|ceruledge|tadbulb|bellibolt|wattrel|kilowattrel|maschiff|mabosstiff|shroodle|grafaiai|bramblin|brambleghast|toedscool|toedscruel|klawf|capsakid|scovillain|rellor|rabsca|flittle|espathra|tinkatink|tinkatuff|tinkaton|wiglett|wugtrio|bombirdier|finizen|palafin|varoom|revavroom|cyclizar|orthworm|glimmet|glimmora|greavard|houndstone|flamigo|cetoddle|cetitan|veluza|dondozo|tatsugiri|annihilape|clodsire|farigiraf|dudunsparce|kingambit|great tusk|scream tail|brute bonnet|flutter mane|slither wing|sandy shocks|iron treads|iron bundle|iron hands|iron jugulis|iron moth|iron thorns|frigibax|arctibax|baxcalibur|gimmighoul|gholdengo|wo chien|chien pao|ting lu|chi yu|roaring moon|iron valiant|koraidon|miraidon|walking wake|iron leaves|dipplin|poltchageist|sinistcha|okidogi|munkidori|fezandipiti|ogerpon|archaludon|hydrapple|gouging fire|raging bolt|iron boulder|iron crown|terapagos|pecharunt'.split('|'));
  const SPECIES_MAX_WORDS = 2;
  function cardType(name) {
    const w = plainText(name).replace(/[’'.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
    if (w.includes('energy')) return 'energy';
    for (let i = 0; i < w.length; i++) {
      for (let k = 1; k <= SPECIES_MAX_WORDS && i + k <= w.length; k++) if (SPECIES.has(w.slice(i, i + k).join(' '))) return 'pokemon';
    }
    return 'trainer';
  }
  // ---------- collezione ----------
  let coll = null;
  let collPaid = 'all'; // filtro provenienza: acquistate (prezzo > 0), trovate (0 €), senza prezzo pagato
  let collEra = 'all'; // filtro epoca: moderne o vintage (WOTC ed EX, come nel selettore delle espansioni)
  let collType = 'all'; // filtro per tipo: Pokémon, allenatori, energie
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
    if (p.est && p.est.from) {
      const f = p.est.from;
      lines.push(`Nessun annuncio uguale alla tua copia (${[it.first ? '1ª ed.' : '', isGradeLabel(it.cond) ? it.cond : condShort(it.cond), (it.lang || '').toUpperCase()].filter(Boolean).join(' · ')}).`);
      lines.push(`Si parte dall'annuncio più vicino: ${money(f.cents)} · ${[f.first ? '1ª ed.' : '', f.q, LN[f.lang] || f.lang.toUpperCase()].filter(Boolean).join(' · ')}.`);
      for (const x of p.est.parts) lines.push(`× ${String(x.r).replace('.', ',')}  ${x.label} (${x.scope}, ${x.n} carte)`);
      lines.push(`= ${money(p.cents)}. Stima di mercato (badge ambra): i rapporti sono le mediane dei prezzi delle stesse carte in vendita su CardTrader e si aggiornano da soli.`);
    } else if (p.estimated) {
      lines.push('Stima con regole fisse (badge grigio): i rapporti di mercato per questo caso si basano ancora su meno di 20 carte.');
      lines.push(p.fromCm ? 'Nessun annuncio su CardTrader: si parte dalla tendenza Cardmarket della carta.' : `Nessun annuncio ${it.cond}: si parte da ${p.how || 'copie non gradate'}.`);
      if (p.rawCents != null) lines.push(`Valore di base: ${money(p.rawCents)} × premio fisso del voto ${it.cond}, mai meno della carta più una quota del costo di gradazione.`);
    } else {
      if (p.approx) lines.push('Stima semplice (badge grigio): i rapporti di mercato per questo caso si basano ancora su meno di 20 carte.');
      if (p.edApprox) lines.push('Nessun annuncio 1ª edizione: è il prezzo delle copie normali.');
      if (p.approx && !p.edApprox) lines.push(`Nessun annuncio nella tua lingua (${(it.lang || '').toUpperCase()}) e condizione: prezzo più basso tra tutti${p.lowLang ? `, in ${p.lowLang.toUpperCase()}` : ''}.`);
      if (p.histAnomaly) lines.push(`Oggi l'annuncio più basso è ${money(p.histAnomaly.low)}, meno della metà del solito per questa copia. Si usa la mediana degli ultimi ${p.histAnomaly.days} giorni: ${money(p.histAnomaly.med)}.`);
      else if (!p.approx && p.skipped && p.skipped.length) lines.push(`Annuncio con la stessa combinazione della tua copia: il più basso affidabile. Ignorat${p.skipped.length > 1 ? 'i' : 'o'} ${p.skipped.map((c) => money(c)).join(' e ')}, molto sotto gli altri (circa ${money(p.skipRef)}): probabile errore, copia rovinata o svendita.`);
      else if (!p.approx) lines.push('Annuncio con la stessa combinazione della tua copia: il più basso.');
    }
    if (p.notZero) lines.push('Nessun annuncio Zero adatto: prezzo tra tutti i venditori.');
    if (p.ts) lines.push(`Annunci letti: ${new Date(p.ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${p.v ? ` · calcolo v${p.v}` : ' · calcolo vecchio, in aggiornamento'}.`);
    dialog({ title: 'Come è calcolato', text: lines.join('\n\n') });
  }
  const isEstimate = (p) => !!(p && (p.estimated || p.approx || p.histAnomaly || (p.skipped && p.skipped.length)));

  /** Scritta sotto il prezzo (stima, altra edizione/lingua, non Zero): si tocca per sapere come è calcolato. */
  function collPriceNote(it) {
    const p = it.price;
    if (!p) return null;
    const text = p.est ? '≈ stima di mercato'
      : p.estimated ? (p.fromCm ? '≈ stima da Cardmarket' : '≈ stima dal voto')
      : p.edApprox ? '≈ altra edizione'
      : p.approx ? `≈ altra lingua${p.lowLang && p.lowLang !== it.lang ? ` (${p.lowLang.toUpperCase()})` : ''}`
      : p.histAnomaly ? '≈ prezzo insolito, uso lo storico'
      : p.skipped && p.skipped.length ? '≈ prezzo anomalo ignorato'
      : p.notZero ? '≈ non Zero' : '';
    if (!text) return null;
    return el('button', { class: 's linklike', type: 'button', text, onclick: () => explainPrice(it) });
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
    ].filter(Boolean);
    $('collFilterCount').hidden = !activeF.length;
    $('collFilterCount').textContent = String(activeF.length);
    $('collActive').hidden = !activeF.length || !$('collFilters').hidden;
    $('collActive').replaceChildren(
      ...activeF.map(([label, clear]) => el('button', { class: 'af-chip', type: 'button', 'aria-label': `Togli il filtro ${label}`, onclick: () => { clear(); renderCollection(); } }, el('span', { text: label }), el('b', { text: '×', 'aria-hidden': 'true' }))),
      activeF.length > 1 ? el('button', { class: 'af-clear', type: 'button', text: 'Azzera tutti', onclick: resetCollFilters }) : null);
    const shownItems = items.filter((it) => kindOk(it) && typeOk(it) && eraOk(it) && paidOk(it) && rarOk(it) && (!cq || cq.split(/\s+/).every((w) => plainText(`${it.name} ${it.expName || ''} ${it.cond || ''}`).includes(w))));
    $('collFilterClose').textContent = `Mostra ${shownItems.length} ${shownItems.length === 1 ? 'carta' : 'carte'}`;
    $('collCount').hidden = !cq && collKind === 'all' && collType === 'all' && collEra === 'all' && collPaid === 'all' && !rar;
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
              document.createTextNode([it.expName, it.first && '1ª ed.', !isGradeLabel(it.cond) && it.cond && condShort(it.cond), it.lang && it.lang.toUpperCase()].filter(Boolean).join(' · '))),
            el('div', { class: 'qty' }, step(-1), el('b', { text: String(it.qty) }), step(1),
              el('button', { class: 'ci-edit', type: 'button', 'aria-label': `Modifica ${it.name}`, title: 'Modifica prezzo, condizione, lingua', text: '✎', onclick: () => openOwnEdit(it) }),
              it.paidCents != null ? el('span', { class: 's', text: it.paidCents === 0 ? (it.qty > 1 ? 'trovate (0 €)' : 'trovata (0 €)') : it.qty > 1 ? `pagate ${money(it.paidCents)} l'una` : `pagata ${money(it.paidCents)}` }) : null),
          ),
          el('div', { class: 'r' },
            el('div', { class: 'price-line' },
              // STIMA ambra = calcolata con i rapporti di mercato; STIMA grigia = regole fisse, dati di mercato ancora insufficienti.
              isEstimate(it.price) ? el('button', { class: 'est-badge' + (it.price.est ? '' : ' fallback'), type: 'button', title: 'Valore stimato: tocca per sapere come', text: 'STIMA', onclick: () => explainPrice(it) }) : null,
              el('b', { text: it.price ? `${isEstimate(it.price) ? '≈ ' : ''}${money(it.price.cents * it.qty)}` : '…' })),
            it.qty > 1 && it.price ? el('span', { class: 's', text: `${money(it.price.cents)} l'una` }) : null,
            gainPill(it),
            miniSpark(it.spark30),
            it.change7 != null && Math.abs(it.change7) >= 0.005 ? el('span', { class: 'trend ' + (it.change7 >= 0 ? 'up' : 'dn'), text: `${it.change7 >= 0 ? '▲' : '▼'} ${Math.round(Math.abs(it.change7) * 100)}% 7g` }) : null,
            collPriceNote(it),
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
    if (v === 'coll') loadCollection();
  }
  document.querySelectorAll('input[name="hview"]').forEach((r) => r.addEventListener('change', () => { hviewChosen = true; setHview(r.value); }));
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
    collType = 'all'; collEra = 'all'; collPaid = 'all'; collKind = 'all';
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
  $('collZero').addEventListener('change', async () => {
    $('collList').classList.add('loading');
    await saveSettings({ collZero: $('collZero').checked });
    loadCollection();
  });

  /** "Ce l'ho": pulsante nel dettaglio carta e pannello per aggiungere copie. */
  const OWN_LANGS = [['en', 'EN'], ['jp', 'JP'], ['it', 'IT'], ['fr', 'FR'], ['de', 'DE'], ['es', 'ES'], ['pt', 'PT'], ['ko', 'KO'], ['zh', 'ZH']];
  const OWN_CONDS = [['Mint', 'M'], ['Near Mint', 'NM'], ['Slightly Played', 'SP'], ['Moderately Played', 'MP'], ['Played', 'PL'], ['Heavily Played', 'HP'], ['Poor', 'PO']];
  const own = { qty: 1, lang: 'en', cond: 'Near Mint', gco: '', g: '10', first: false };
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
      el('span', { class: 'dm-k', text: `La tua copia · ${[it.first ? '1ª ed.' : '', isGradeLabel(it.cond) ? it.cond : condShort(it.cond), (it.lang || '').toUpperCase()].filter(Boolean).join(' · ')}${it.qty > 1 ? ` · ×${it.qty}` : ''}` }),
      el('span', { class: 'dm-v' },
        it.price && isEstimate(it.price) ? el('button', { class: 'est-badge' + (it.price.est ? '' : ' fallback'), type: 'button', text: 'STIMA', onclick: () => explainPrice(it) }) : null,
        el('b', { text: it.price ? `${isEstimate(it.price) ? '≈ ' : ''}${money(it.price.cents)}` : '…' })))));
    $('ownOpen').classList.toggle('on', n > 0);
    $('ownList').replaceChildren(...mine.map((it) => el('span', { class: 'own-chip' },
      el('b', { text: `${it.qty}×` }),
      document.createTextNode(` ${it.first ? '1ª ed. · ' : ''}${condShort(it.cond)} · ${(it.lang || '').toUpperCase()}${it.paidCents != null ? ` · ${money(it.paidCents)}` : ''}`),
      el('button', { type: 'button', 'aria-label': 'Togli', text: '✕', onclick: () => saveOwn({ ...it, qty: 0 }) }),
    )));
  }

  /** Apre "Ce l'ho" per una carta qualsiasi (es. dallo scanner), con lingua già proposta; onDone dopo il salvataggio. */
  let ownDone = null;
  function openOwnAdd(c, lang, onDone, slab, first = false) {
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
    renderOwnSheet();
    renderOwnBox();
    openSheet($('ownDialog'));
  }

  $('ownOpen').addEventListener('click', () => {
    ownDone = null;
    if (!current) return;
    $('ownName').textContent = "Ce l'ho";
    ownEditing = null;
    own.gco = '';
    own.first = false;
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
        if (own.lang !== (it.lang || '') || ownCond() !== (it.cond || '') || own.first !== !!it.first) await saveOwn({ ...it, qty: 0 });
        await saveOwn({ ...it, lang: own.lang, cond: ownCond(), first: own.first, qty: own.qty, paidCents, add: false });
        $('ownPaid').value = '';
        $('ownDialog').close();
        toast('✓ Modifiche salvate');
        return;
      }
      await saveOwn({
        bp: current.id, name: current.name + (current.version ? ` (${current.version})` : ''), image: current.image,
        expansionId: current.expansionId || (dlgExp && dlgExp.id), expName: current.expName || (dlgExp && dlgExp.name), cmId: current.cmId,
        lang: own.lang, cond: ownCond(), first: own.first, qty: own.qty, add: true,
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

  // ---------- scanner ----------
  const LANG_LABEL = { en: 'Inglese', jp: 'Giapponese', it: 'Italiano', fr: 'Francese', de: 'Tedesco', es: 'Spagnolo', pt: 'Portoghese', ko: 'Coreano', zh: 'Cinese' };

  /** Riduce la foto (lato lungo 1280 px, JPEG): più veloce da inviare e abbastanza nitida per il numero. */
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.width, img.height));
        const w = Math.round(img.width * k);
        const h = Math.round(img.height * k);
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        // Nessuna rotazione: girare la foto alla cieca a volte la capovolge. Il riconoscimento legge la carta in qualsiasi verso.
        c.width = w;
        c.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Foto non leggibile'));
      img.src = URL.createObjectURL(file);
    });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scan]');
    if (!b) return;
    $('scanInput').value = '';
    $('scanInput').click();
  });

  $('scanInput').addEventListener('change', async () => {
    const file = $('scanInput').files[0];
    if (!file) return;
    let data;
    try {
      data = await shrinkPhoto(file);
    } catch (e) {
      alert(e.message);
      return;
    }
    $('scanPhoto').src = data;
    $('scanRead').replaceChildren(el('div', { class: 'scan-wait' }, el('span', { class: 'spinner' }), el('span', { text: 'Riconosco la carta…' })));
    $('scanMsg').textContent = '';
    $('scanList').replaceChildren();
    openSheet($('scanDialog'));
    try {
      const r = await api('/api/scan', { method: 'POST', body: JSON.stringify({ image: data }) });
      if (!coll) await loadCollection(); // serve per segnare le carte che hai già
      renderScan(r);
    } catch (e) {
      $('scanRead').replaceChildren(el('p', { class: 'error', text: e.message }));
    }
  });

  function renderScan(r) {
    const sc = r.scan || {};
    const lang = sc.language || '';
    $('scanRead').replaceChildren(
      sc.name ? el('div', { class: 't', text: sc.name }) : el('div', { class: 't', text: 'Carta non riconosciuta' }),
      el('div', { class: 'chips' },
        sc.number ? chip(`N. ${sc.number}${sc.total ? '/' + sc.total : ''}`, 'on') : null,
        lang ? chip(LANG_LABEL[lang] || lang.toUpperCase(), 'lang') : null,
        sc.setCode ? chip(sc.setCode) : null,
        sc.variant ? chip(sc.variant, 'zero') : null,
        sc.slab ? chip(`${sc.slab.co} ${sc.slab.g}`, 'on') : null,
      ),
      el('div', { class: 'small muted', text: `${r.engine === 'workers-ai' ? 'Riconoscimento Cloudflare' : r.engine === 'claude-opus' ? 'Riconoscimento Claude Opus' : r.engine === 'claude-sonnet' ? 'Riconoscimento Claude Sonnet' : 'Riconoscimento Claude'}${r.limit < 100000 ? ` · ${r.used}/${r.limit} scansioni questo mese` : ''}` }),
    );
    const cands = r.candidates || [];
    $('scanMsg').textContent = !sc.name && !sc.number
      ? 'Non vedo una carta: riprova con più luce, la carta dritta e intera nell’inquadratura.'
      : cands.length && r.exact === false ? 'Nessuna carta con questo numero: ecco quelle con lo stesso nome. Se non c\'è, cercala per nome in Cerca.'
      : cands.length ? (cands.length === 1 ? 'Trovata:' : 'È una di queste? Tocca quella giusta.') : 'Nessuna carta corrispondente nell’indice. Prova a cercarla per nome nella scheda Carte.';
    $('scanList').replaceChildren(...cands.map((c, i) => el('div', { class: 'scan-cand' + (i === 0 ? ' top' : '') },
      thumb(c.image),
      el('button', { class: 'linklike scan-info', type: 'button', onclick: () => {
        $('scanDialog').close();
        openCard({ id: c.id, name: c.name, version: c.version, image: c.image, expansionId: c.expansionId, expName: c.expName, currency: 'EUR' });
        if (lang && OWN_LANGS.some(([v]) => v === lang)) own.lang = lang;
      } },
        el('div', { class: 't' }, c.name, ' ', ownedBadge(c.id, 'own-badge inline')),
        el('div', { class: 's', text: [c.version, c.expName].filter(Boolean).join(' · ') }),
      ),
      // Si apre "Ce l'ho" con la lingua letta dalla foto: condizione, copie, gradata e prezzo li scegli tu.
      el('button', { class: 'btn mini', type: 'button', title: 'Aggiungi alla collezione', text: ownedQty(c.id) ? '＋ Un\'altra' : "＋ Ce l'ho", onclick: (ev) => {
        const btn = ev.currentTarget;
        openOwnAdd({ id: c.id, name: c.name, version: c.version, image: c.image, expansionId: c.expansionId, expName: c.expName }, lang, () => {
          btn.textContent = '✓ Aggiunta';
          btn.disabled = true;
        }, sc.slab, /1st|first/i.test(sc.variant || '')); // dalla slab: società e voto già scelti; 1ª edizione dalla foto
      } }),
    )));
  }

  // ---------- scansione di più carte ----------
  let batch = []; // { file, thumb, status, scan, candidates, pick, lang, cond, qty, paid, include }
  let batchBusy = false;

  $('batchOpen').addEventListener('click', () => {
    const p = state.account && state.account.plan;
    if (p && p.batchScan === false) {
      alert('La scansione di più carte insieme è inclusa nei piani Pro e Sniper.');
      return;
    }
    if (!batchBusy && batch.every((b) => b.added || b.status === 'error')) { batch = []; renderBatch(); }
    $('batchQuota').textContent = '';
    openSheet($('batchDialog'));
  });
  $('batchPick').addEventListener('click', () => { $('batchInput').value = ''; $('batchInput').click(); });
  $('batchInput').addEventListener('change', () => startBatch([...$('batchInput').files]));
  const drop = $('batchDrop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => startBatch([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))));

  async function startBatch(files) {
    if (!files.length || batchBusy) return;
    files = files.slice(0, 100);
    for (const file of files) batch.push({ file, status: 'wait', cond: 'Near Mint', qty: 1, paid: '', include: true });
    renderBatch();
    batchBusy = true;
    $('batchProgress').hidden = false;
    // Una foto alla volta: niente raffiche su Workers AI e sul limite di scansioni.
    for (const row of batch) {
      if (row.status !== 'wait') continue;
      const done = batch.filter((b) => b.status !== 'wait' && b.status !== 'work').length;
      $('batchProgress').querySelector('i').style.width = `${Math.round((done / batch.length) * 100)}%`;
      $('batchProgressText').textContent = `Riconosco ${done + 1} di ${batch.length}…`;
      row.status = 'work';
      renderBatch();
      try {
        row.thumb = await shrinkPhoto(row.file);
        const r = await api('/api/scan', { method: 'POST', body: JSON.stringify({ image: row.thumb }) });
        row.scan = r.scan || {};
        row.candidates = r.candidates || [];
        row.pick = row.candidates.length ? 0 : -1;
        row.lang = (row.scan.language && OWN_LANGS.some(([v]) => v === row.scan.language)) ? row.scan.language : 'en';
        const [a, b] = row.candidates;
        row.unsure = !a || (b && a.score - b.score < 2);
        row.include = !!a;
        row.status = 'ok';
        if (r.limit < 100000) $('batchQuota').textContent = `${r.used}/${r.limit} scansioni usate questo mese`;
      } catch (e) {
        row.status = 'error';
        row.error = e.message;
        row.include = false;
        if (/scansioni del mese/i.test(e.message)) {
          // Limite raggiunto: le foto rimaste restano in attesa.
          batch.filter((x) => x.status === 'wait').forEach((x) => { x.status = 'error'; x.error = 'Non analizzata: limite di scansioni raggiunto'; x.include = false; });
        }
      }
      renderBatch();
    }
    batchBusy = false;
    $('batchProgress').querySelector('i').style.width = '100%';
    $('batchProgressText').textContent = `Fatto: ${batch.filter((b) => b.status === 'ok' && b.candidates.length).length} riconosciute su ${batch.length}. Controlla le righe gialle.`;
    renderBatch();
  }

  function batchSelect(options, value, onChange, label) {
    const sel = el('select', { 'aria-label': label }, ...options.map(([v, t]) => el('option', { value: String(v), text: t })));
    sel.value = String(value);
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function renderBatch() {
    $('batchList').replaceChildren(...batch.map((row, i) => {
      const c = row.candidates && row.pick >= 0 ? row.candidates[row.pick] : null;
      const head = el('div', { class: 'b-head' },
        el('img', { class: 'b-photo', src: row.thumb || '', alt: '' }),
        c && c.image ? el('img', { class: 'b-photo', src: c.image, alt: '' }) : null,
        el('div', { class: 'b-main' },
          row.status === 'wait' ? el('span', { class: 'muted', text: 'In attesa…' })
          : row.status === 'work' ? el('span', { class: 'scan-wait' }, el('span', { class: 'spinner' }), el('span', { text: 'Riconosco…' }))
          : row.status === 'error' ? el('span', { class: 'error small', text: row.error })
          : !row.candidates.length ? el('span', { class: 'error small', text: row.scan && row.scan.name ? `Letta "${row.scan.name}" ma nessuna carta corrispondente` : 'Carta non riconosciuta' })
          : batchSelect(row.candidates.map((x, k) => [k, `${x.name} · ${[x.version, x.expName].filter(Boolean).join(' · ')}`]), row.pick, (v) => { row.pick = Number(v); renderBatch(); }, 'Carta'),
          row.added ? el('span', { class: 'ok small', text: '✓ Aggiunta alla collezione' }) : null,
        ),
        row.status === 'ok' && row.candidates.length && !row.added ? el('label', { class: 'b-check' }, (() => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = row.include;
          cb.addEventListener('change', () => { row.include = cb.checked; renderBatchFoot(); });
          return cb;
        })()) : null,
      );
      const opts = row.status === 'ok' && row.candidates.length && !row.added ? el('div', { class: 'b-opts' },
        batchSelect(OWN_LANGS.map(([v, l]) => [v, l]), row.lang, (v) => { row.lang = v; }, 'Lingua'),
        batchSelect(OWN_CONDS.map(([v, l]) => [v, l]), row.cond, (v) => { row.cond = v; }, 'Condizione'),
        (() => { const q = el('input', { type: 'number', min: '1', max: '999', value: String(row.qty), 'aria-label': 'Copie', inputmode: 'numeric' }); q.addEventListener('input', () => { row.qty = Math.max(1, Number(q.value) || 1); }); return q; })(),
        (() => { const pi = el('input', { type: 'number', min: '0', step: '0.01', placeholder: '€ pagata', 'aria-label': 'Prezzo pagato', inputmode: 'decimal' }); pi.value = row.paid; pi.addEventListener('input', () => { row.paid = pi.value; }); return pi; })(),
      ) : null;
      return el('div', { class: 'b-row' + (row.status === 'ok' && row.unsure && !row.added ? ' unsure' : '') + (row.added ? ' added' : '') }, head, opts);
    }));
    renderBatchFoot();
  }

  function renderBatchFoot() {
    const ready = batch.filter((b) => b.include && b.status === 'ok' && b.candidates.length && !b.added);
    $('batchFoot').hidden = !batch.length;
    $('batchSummary').textContent = `${ready.length} da aggiungere${batch.some((b) => b.unsure && b.include && !b.added) ? ' · alcune da controllare (in giallo)' : ''}`;
    $('batchAdd').disabled = !ready.length || batchBusy;
    $('batchAdd').textContent = ready.length ? `Aggiungi ${ready.length} alla collezione` : 'Aggiungi alla collezione';
  }

  $('batchAdd').addEventListener('click', async () => {
    const ready = batch.filter((b) => b.include && b.status === 'ok' && b.candidates.length && !b.added);
    $('batchAdd').disabled = true;
    for (const row of ready) {
      const c = row.candidates[row.pick];
      const paid = Number(row.paid);
      try {
        await saveOwn({ bp: c.id, name: c.name + (c.version ? ` (${c.version})` : ''), image: c.image, expansionId: c.expansionId, expName: c.expName, lang: row.lang, cond: row.cond, qty: row.qty, add: true, paidCents: String(row.paid ?? '').trim() !== '' && paid >= 0 ? Math.round(paid * 100) : null });
        row.added = true;
      } catch (e) {
        row.error = e.message;
        alert(e.message);
        break;
      }
      renderBatch();
    }
    renderBatch();
  });

  // ---------- affari del giorno ----------
  let dealsAt = 0;
  let dealsData = null;
  document.querySelectorAll('input[name="dmode"]').forEach((r) => r.addEventListener('change', () => dealsData && renderDeals(dealsData)));
  const plain = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  $('dealsSearch').addEventListener('input', () => dealsData && renderDeals(dealsData));
  let dealsLang = '';
  const LANG_CHIP = { en: '🇬🇧 EN', jp: '🇯🇵 JP', it: '🇮🇹 IT', fr: '🇫🇷 FR', de: '🇩🇪 DE', es: '🇪🇸 ES', pt: '🇵🇹 PT', ko: '🇰🇷 KR', zh: '🇨🇳 CN', ru: '🇷🇺 RU', th: '🇹🇭 TH' };
  const normL = (l) => { const x = String(l || '').toLowerCase(); return x === 'ja' ? 'jp' : x.startsWith('zh') ? 'zh' : x === 'kr' ? 'ko' : x; };
  /** Pillole di filtro: [valore, etichetta], quella scelta evidenziata. */
  function filterChips(box, opts, cur, onPick) {
    box.replaceChildren(...opts.map(([v, l]) => el('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(cur === v), text: l, onclick: () => onPick(v) })));
  }
  async function loadDeals() {
    if (Date.now() - dealsAt < 5 * 60_000 && dealsData) return;
    dealsAt = Date.now();
    $('dealsMsg').textContent = 'Carico gli affari…';
    try {
      dealsData = await api('/api/deals');
      renderDeals(dealsData);
    } catch (e) {
      $('dealsMsg').textContent = e.message;
    }
  }

  function renderDeals(all) {
    {
      const zero = (document.querySelector('input[name="dmode"]:checked') || {}).value === 'zero';
      const q = plain($('dealsSearch').value).trim();
      const base = zero ? all.itemsZero || [] : all.items;
      // Lingue presenti negli affari di oggi, dalla più frequente.
      const counts = {};
      for (const it of base) { const l = normL(it.language); if (l) counts[l] = (counts[l] || 0) + 1; }
      const langs = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      if (dealsLang && !langs.includes(dealsLang)) dealsLang = '';
      $('dealsLang').hidden = langs.length < 2;
      filterChips($('dealsLang'), [['', 'Tutte le lingue'], ...langs.map((l) => [l, LANG_CHIP[l] || l.toUpperCase()])], dealsLang, (v) => { dealsLang = v; renderDeals(all); });
      const d = { ...all, items: base.filter((it) => (!q || plain(it.name).includes(q)) && (!dealsLang || normL(it.language) === dealsLang)) };
      $('dealsMsg').textContent = (q || dealsLang) && !d.items.length
        ? (q ? `Nessun affare per “${$('dealsSearch').value.trim()}” tra quelli di oggi.` : 'Nessun affare in questa lingua oggi.')
        : d.items.length
        ? `${d.items.length} affari · aggiornati ${ago(d.ts)} · ${d.sets.length} espansioni controllate${d.popular && d.popular.length ? ` (${d.popular.length} tra le più ricercate)` : ''}`
        : zero && all.items.length ? 'Per ora nessun annuncio Zero è abbastanza sotto gli altri. Riprova più tardi.' : 'Sto raccogliendo i primi dati: le espansioni si controllano una ogni 10 minuti. Riprova più tardi.';
      $('dealsGrid').replaceChildren(
        ...d.items.map((it, i) => el('div', { class: 'tile', style: `--i:${Math.min(i, 24)}` },
          el('button', { class: 'tile-main', type: 'button', onclick: () => openCard({ id: it.id, name: it.name, image: it.image, expansionId: it.expansionId, expName: it.expName, currency: it.currency, lowest: it.cents, cm: { trend: it.trendCents / 100 } }) },
            el('div', { class: 'art' },
              it.image ? el('img', { src: it.image, alt: '', loading: 'lazy' }) : el('div', { class: 'noimg', text: 'Nessuna immagine' }),
              el('span', { class: 'pricepill', text: money(it.cents, it.currency) }),
              el('span', { class: 'zeropill deal', text: `−${Math.round(it.discount * 100)}%` }),
              ownedBadge(it.id),
            ),
            el('div', { class: 'info' },
              el('div', { class: 'nm', text: it.name }),
              el('div', { class: 'sub', text: [it.expName, it.language && it.language.toUpperCase(), it.zero && 'Zero'].filter(Boolean).join(' · ') }),
              it.refCents ? el('div', { class: 'sub', text: `Prezzo tipico CardTrader ${money(it.refCents, it.currency)}` }) : null,
              it.trendCents ? el('div', { class: 'cmtxt', text: `Cardmarket tendenza ${money(it.trendCents, it.currency)}` }) : null,
            ),
          ),
        )),
      );
    }
  }

  // ---------- venditori ----------
  const sellerState = (u) => {
    const sel = (state && state.sellers) || { fav: [], block: [] };
    return sel.fav.some((f) => f.username === u) ? 'fav' : sel.block.includes(u) ? 'block' : 'none';
  };

  function sellerButtons(username, country) {
    const st = sellerState(username);
    return el('div', { class: 'seller-acts' },
      el('button', { class: 'btn mini' + (st === 'fav' ? ' on' : ''), type: 'button', title: st === 'fav' ? 'Togli dai preferiti' : 'Salva venditore', text: st === 'fav' ? '★ Salvato' : '☆ Salva',
        onclick: () => setSeller(username, st === 'fav' ? 'none' : 'fav', country) }),
      el('button', { class: 'btn mini' + (st === 'block' ? ' on-bad' : ''), type: 'button', title: st === 'block' ? 'Riammetti' : 'Escludi venditore', text: st === 'block' ? '⛔ Escluso' : '⛔ Escludi',
        onclick: async () => {
          if (st !== 'block' && !(await askConfirm('I suoi annunci non faranno più scattare alert. Puoi riammetterlo quando vuoi.', { title: `Escludere ${username}?`, ok: 'Escludi', danger: true }))) return;
          setSeller(username, st === 'block' ? 'none' : 'block', country);
        } }),
    );
  }

  async function setSeller(username, action, country) {
    try {
      state.sellers = await api('/api/sellers', { method: 'POST', body: JSON.stringify({ username, action, country }) });
      renderSellers();
      if (current && !$('cardDialog').hidden && $('cardDialog').open) openCard(current);
    } catch (e) {
      alert(e.message);
    }
  }

  function renderSellers() {
    const sel = state.sellers || { fav: [], block: [] };
    $('sellerList').replaceChildren(
      ...sel.fav.map((f) => el('div', { class: 'rule' },
        el('div', { class: 'info' },
          el('div', { class: 't', text: `★ ${f.username}${f.country ? ` (${f.country})` : ''}` }),
          el('div', { class: 'e', text: 'Venditore salvato' }),
        ),
        el('div', { class: 'acts' },
          el('button', { class: 'btn', type: 'button', text: 'I suoi annunci', onclick: () => openSeller(f.username) }),
          el('button', { class: 'btn danger', type: 'button', text: 'Togli', onclick: () => setSeller(f.username, 'none') }),
        ),
      )),
      ...sel.block.map((u) => el('div', { class: 'rule off' },
        el('div', { class: 'info' },
          el('div', { class: 't', text: `⛔ ${u}` }),
          el('div', { class: 'e', text: 'Escluso dagli alert' }),
        ),
        el('div', { class: 'acts' }, el('button', { class: 'btn', type: 'button', text: 'Riammetti', onclick: () => setSeller(u, 'none') })),
      )),
      ...(sel.fav.length || sel.block.length ? [] : [el('p', { class: 'muted', text: 'Nessun venditore salvato o escluso.' })]),
    );
  }

  async function openSeller(username) {
    $('slTitle').textContent = username;
    $('slList').replaceChildren(el('p', { class: 'muted', text: 'Cerco i suoi annunci…' }));
    openSheet($('sellerDialog'));
    try {
      const { rows } = await api(`/api/seller?username=${encodeURIComponent(username)}`);
      $('slList').replaceChildren(
        ...(rows.length
          ? rows.map((r) => el('a', { class: 'lrow link', href: cardUrl(r.blueprintId), target: '_blank', rel: 'noopener noreferrer' },
              el('span', { class: 'p', text: money(r.cents, r.currency) }),
              el('span', { class: 'd' }, el('b', { text: r.name || '' }), el('br'), document.createTextNode([r.expansion, r.condition, r.language && r.language.toUpperCase(), r.quantity > 1 && `x${r.quantity}`].filter(Boolean).join(' · '))),
              r.zero ? el('span', { class: 'zero-tag', text: 'Zero' }) : null,
              el('span', { class: 'go', text: '↗' }),
            ))
          : [el('p', { class: 'muted', text: 'Nessun suo annuncio tra le carte lette di recente. Apri qualche espansione o carta e riprova.' })]),
      );
    } catch (e) {
      $('slList').replaceChildren(el('p', { class: 'error', text: e.message }));
    }
  }

  // ---------- piano ----------
  const PLAN_ROWS = [
    ['Alert su una carta', (p) => p.maxRules],
    ['Alert su tutto un set', (p) => (p.maxSetRules >= p.unlimited ? 'illimitati' : p.maxSetRules || '—')],
    ['Lista dei desideri', (p) => (p.maxWish >= p.unlimited ? 'illimitata' : `${p.maxWish} carte`)],
    ['Collezione', (p) => (p.maxColl >= p.unlimited ? 'illimitata' : `${p.maxColl} carte`)],
    ['Scansioni al mese', (p) => (p.maxScans >= p.unlimited ? 'illimitate' : String(p.maxScans))],
    ['Velocità degli alert', (p) => (p.scanSec >= 60 ? `ogni ${p.scanSec / 60} min` : `ogni ${p.scanSec} s`)],
    ['Storico prezzi', (p) => `${p.historyDays} giorni`],
    ['Spedizione nell’avviso', (p) => (p.shipping ? '✓' : '—')],
    ['Stella priorità', (p) => (p.priority ? '✓' : '—')],
  ];
  const PLAN_INFO = {
    free: { label: 'Gratuito', price: '0 €', maxScans: 5, maxColl: 20, maxRules: 3, maxSetRules: 0, maxWish: 10, scanSec: 300, historyDays: 7, shipping: false, priority: false },
    pro: { label: 'Pro', price: '4,99 €/mese', maxScans: 200, maxColl: 500, maxRules: 30, maxSetRules: 1, maxWish: 200, scanSec: 30, historyDays: 120, shipping: true, priority: true },
    sniper: { label: 'Sniper', price: '9,99 €/mese', maxScans: 1000, maxColl: 100000, maxRules: 100, maxSetRules: 10, maxWish: 100000, scanSec: 10, historyDays: 120, shipping: true, priority: true },
  };

  /** Righe della tabella di confronto dei piani (usata in Impostazioni e nella pagina di accesso). */
  function planTable(curId) {
    const ids = Object.keys(PLAN_INFO);
    const cls = (id) => (id === curId ? 'cur' : '');
    return [
      el('div', { class: 'pt-row pt-head' }, el('span'), ...ids.map((id) => el('b', { class: cls(id), text: PLAN_INFO[id].label }))),
      el('div', { class: 'pt-row' }, el('span', { text: 'Prezzo' }), ...ids.map((id) => el('span', { class: cls(id), text: PLAN_INFO[id].price }))),
      ...PLAN_ROWS.map(([label, f]) => el('div', { class: 'pt-row' }, el('span', { text: label }), ...ids.map((id) => el('span', { class: cls(id), text: String(f({ ...PLAN_INFO[id], unlimited: 100000 })) })))),
    ];
  }

  function renderPlan() {
    const raw = state.account && state.account.plan;
    if (!raw) return;
    // Se il server dati non è ancora aggiornato mancano dei campi: valgono quelli del piano più vicino.
    const p = { unlimited: 100000, ...(PLAN_INFO[raw.id] || PLAN_INFO.sniper), ...raw };
    $('planBadge').textContent = p.label;
    const cards = state.rules.filter((r) => r.blueprintId).length;
    const sets = state.rules.length - cards;
    const lim = (n, max) => (max >= p.unlimited ? `${n}` : `${n} su ${max}`);
    const ratio = (n, max) => (max >= p.unlimited || !max ? null : n / max);
    const out = (state.outOfPlan || []).length;
    $('planUsage').replaceChildren(
      kvRow('Alert su una carta', lim(cards, p.maxRules), cards > p.maxRules ? 'bad' : '', ratio(cards, p.maxRules)),
      kvRow('Alert su un set', p.maxSetRules ? lim(sets, p.maxSetRules) : sets ? `${sets} (non inclusi)` : 'non inclusi', sets > p.maxSetRules ? 'bad' : '', p.maxSetRules ? ratio(sets, p.maxSetRules) : null),
      kvRow('Lista dei desideri', lim((state.wish || []).length, p.maxWish), '', ratio((state.wish || []).length, p.maxWish)),
      kvRow('Collezione', coll ? `${lim(coll.items.length, p.maxColl)} carte diverse` : lim('—', p.maxColl), '', coll ? ratio(coll.items.length, p.maxColl) : null),
      kvRow('Velocità degli alert', p.scanSec >= 60 ? `ogni ${p.scanSec / 60} minuti` : `fino a ogni ${p.scanSec} secondi`),
      kvRow('Storico prezzi', `${p.historyDays} giorni`),
      ...(out ? [kvRow('Alert fermi', `${out} oltre il limite del piano`, 'bad')] : []),
    );
    $('planTable').replaceChildren(...planTable(p.id));
    renderBilling(p.id);
    // Frequenze più veloci di quella del piano: visibili ma non selezionabili.
    for (const o of $('setScan').options) o.disabled = Number(o.value) < p.scanSec;
  }


  /** Pulsanti per abbonarsi (Lemon Squeezy) e link per gestire l'abbonamento. */
  let billingLinks = null;
  async function renderBilling(planId) {
    const box = $('planBuy');
    if (!box) return;
    if (planId === 'owner') return box.replaceChildren();
    if (!billingLinks) billingLinks = await api('/api/billing/links').catch(() => ({}));
    const L = billingLinks || {};
    const btn = (href, text) => (href ? el('a', { class: 'btn', href, target: '_blank', rel: 'noopener', 'data-direct': '1', text }) : null);
    const rows = [];
    for (const id of ['pro', 'sniper']) {
      if (id === planId) continue;
      const l = L[id] || {};
      const b = [btn(l.monthly, `${PLAN_INFO[id].label} mensile`), btn(l.yearly, `${PLAN_INFO[id].label} annuale`)].filter(Boolean);
      if (b.length) rows.push(el('div', { class: 'buy-row' }, el('b', { text: `Passa a ${PLAN_INFO[id].label}` }), ...b));
    }
    const bill = L.billing;
    if (bill && bill.portalUrl) {
      const when = bill.status === 'cancelled' && bill.endsAt ? `Disdetto: attivo fino al ${new Date(bill.endsAt).toLocaleDateString()}` : bill.renewsAt ? `Si rinnova il ${new Date(bill.renewsAt).toLocaleDateString()}` : '';
      rows.push(el('div', { class: 'buy-row' }, when ? el('span', { class: 'muted small', text: when }) : null, btn(bill.portalUrl, 'Gestisci abbonamento')));
    }
    box.replaceChildren(...rows);
  }
  // ---------- admin ----------
  const isOwner = () => !!(state && state.account && state.account.plan && state.account.plan.id === 'owner');
  let adminLoaded = 0;

  async function loadAdmin() {
    if (!isOwner()) return;
    adminLoaded = Date.now();
    $('adminError').hidden = true;
    let data;
    try {
      data = await api('/api/admin/users');
    } catch (e) {
      $('adminError').textContent = e.message;
      $('adminError').hidden = false;
      return;
    }
    const users = data.users;
    const active = users.filter((u) => u.stats && u.stats.activeRules > 0 && !u.blocked).length;
    const byPlan = data.plans.map((p) => `${users.filter((u) => u.plan === p.id).length} ${p.label}`).join(' · ');
    // Stima: ogni giro di scan è una richiesta, più il controllo ogni 10 minuti e un po' di uso dell'app.
    const perDay = (u) => (u.blocked ? 0 : (u.stats && u.stats.scanSec ? Math.round(86400 / u.stats.scanSec) : 0) + 144 + (u.stats && u.stats.scanSec ? 200 : 0));
    const total = users.reduce((t, u) => t + perDay(u), 0);
    const today = users.reduce((t, u) => t + ((u.stats && u.stats.today && u.stats.today.alarms) || 0), 0);
    const pct = Math.round((total / 100000) * 100);
    $('adminSummary').replaceChildren(
      document.createTextNode(`${users.length} ${users.length === 1 ? 'utente' : 'utenti'} · ${active} con alert attivi · ${byPlan}`),
      el('div', { class: 'usage' },
        el('div', { class: 'usage-top' },
          el('b', { text: `Consumo stimato: ~${total.toLocaleString('it-IT')} richieste al giorno` }),
          el('span', { text: `${pct}% dei 100.000 del piano gratuito Cloudflare` }),
        ),
        el('div', { class: 'bar' + (pct >= 80 ? ' hot' : '') }, el('i', { style: `width:${Math.min(100, pct)}%` })),
        el('span', { class: 'small', text: `Oggi finora: ${today.toLocaleString('it-IT')} giri di scan (si azzera a mezzanotte UTC, cioè alle ${utcMidnightLocal()} ora italiana).` }),
      ),
    );
    // Stato del servizio: scan fermi (alert attivi ma nessun giro da oltre 15 minuti) e 429 dell'ultima ora.
    const stalled = users.filter((u) => !u.blocked && u.stats && u.stats.scanSec && (!u.stats.lastScan || Date.now() - u.stats.lastScan > 15 * 60_000));
    const r429 = users.reduce((t, u) => t + ((u.stats && u.stats.n429) || 0), 0);
    const slow = users.filter((u) => u.stats && u.stats.gapMs > 6000).length;
    $('adminSummary').append(el('div', { class: 'chips', style: 'margin-top:8px' },
      chip(stalled.length ? `${stalled.length} ${stalled.length === 1 ? 'scan fermo' : 'scan fermi'}: ${stalled.slice(0, 3).map((u) => u.name).join(', ')}` : 'Tutti gli scan in corso', stalled.length ? 'warn' : 'on'),
      chip(`${r429} limiti CardTrader (429) nell’ultima ora`, r429 > 5 ? 'warn' : ''),
      slow ? chip(`${slow} con ritmo rallentato`, 'warn') : null,
    ));
    $('adminStats').replaceChildren(...adminStats(users));
    api('/api/admin/errors').then(renderAdminErrors).catch(() => null);
    $('adminList').replaceChildren(
      ...users.map((u) => {
        const st = u.stats || {};
        const planSel = el('select', { class: 'plan-sel', 'aria-label': `Piano di ${u.name}` }, ...data.plans.map((p) => el('option', { value: p.id, text: p.label })));
        planSel.value = u.plan;
        planSel.disabled = u.me;
        planSel.addEventListener('change', () => adminUpdate(u, { plan: planSel.value }));
        return el('div', { class: 'admin-user' + (u.blocked ? ' off' : '') },
          el('div', { class: 'au-top' },
            el('div', null,
              el('div', { class: 't', text: `${u.name || 'Senza nome'}${u.me ? ' (tu)' : ''}` }),
              el('div', { class: 'e', text: `ID CardTrader ${u.id} · iscritto ${dateIt(u.created)} · ultimo accesso ${u.lastLogin ? ago(u.lastLogin) : '—'}` }),
            ),
            planSel,
          ),
          el('div', { class: 'chips' },
            chip(`${st.activeRules ?? '?'} / ${st.rules ?? '?'} alert attivi`, 'on'),
            chip(`${st.alerts ?? 0} avvisi`),
            chip(`${st.wish ?? 0} desideri`),
            chip(`${st.devices ?? 0} ${st.devices === 1 ? 'dispositivo' : 'dispositivi'}`, 'zero'),
            chip(st.scanSec ? `~${perDay(u).toLocaleString('it-IT')} richieste/giorno` : 'nessuno scan', st.scanSec && perDay(u) > 5000 ? 'warn' : ''),
            st.lastScan ? chip(`scan ${ago(st.lastScan)}`, 'cond') : chip('mai scansionato'),
            st.n429 ? chip(`${st.n429} × 429 in 1 h`, 'warn') : null,
            st.gapMs ? chip(`ritmo ${(st.gapMs / 1000).toFixed(1).replace('.', ',')} s`) : null,
            u.blocked ? chip('Sospeso', 'warn') : null,
          ),
          st.lastError ? el('p', { class: 'error small', text: st.lastError }) : null,
          u.me ? null : el('div', { class: 'row-btn' },
            el('button', { class: 'btn mini' + (u.blocked ? '' : ' danger'), type: 'button', text: u.blocked ? 'Riattiva account' : 'Sospendi account',
              onclick: async () => {
                if (!u.blocked && !(await askConfirm('Non potrà più accedere e i suoi alert si fermano.', { title: `Sospendere ${u.name}?`, ok: 'Sospendi', danger: true }))) return;
                adminUpdate(u, { blocked: !u.blocked });
              } }),
          ),
        );
      }),
    );
  }

  /** Statistiche per il proprietario: iscritti negli ultimi 30 giorni, attivi, paganti. */
  function adminStats(users) {
    const day = 86400_000;
    const now = Date.now();
    const keyOf = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
    const days = Array.from({ length: 30 }, (_, i) => keyOf(now - (29 - i) * day));
    const perDay = Object.fromEntries(days.map((d) => [d, 0]));
    for (const u of users) { const k = keyOf(u.created || 0); if (k in perDay) perDay[k]++; }
    const max = Math.max(1, ...Object.values(perDay));
    const active7 = users.filter((u) => (u.lastLogin && now - u.lastLogin < 7 * day) || (u.stats && u.stats.lastScan && now - u.stats.lastScan < day)).length;
    const new7 = users.filter((u) => u.created && now - u.created < 7 * day).length;
    const paid = users.filter((u) => u.plan === 'pro' || u.plan === 'sniper').length;
    const free = users.filter((u) => u.plan === 'free').length;
    const conv = paid + free ? Math.round((paid / (paid + free)) * 100) : 0;
    const box = (n, label) => el('div', null, el('b', { text: String(n) }), el('span', { text: label }));
    return [
      el('div', { class: 'ticker admin-ticker' },
        box(new7, 'nuovi in 7 giorni'),
        box(active7, 'attivi in 7 giorni'),
        box(`${paid}`, `Pro o Sniper (${conv}%)`),
      ),
      el('div', { class: 'signups', role: 'img', 'aria-label': 'Iscritti al giorno negli ultimi 30 giorni' },
        ...days.map((d) => el('i', { title: `${d.slice(8, 10)}/${d.slice(5, 7)}: ${perDay[d]} iscritti`, style: `height:${Math.max(4, (perDay[d] / max) * 100)}%`, class: perDay[d] ? 'on' : '' })),
      ),
      el('div', { class: 'small muted signups-legend' }, el('span', { text: `iscritti al giorno · 30 giorni fa` }), el('span', { text: 'oggi' })),
    ];
  }

  function renderAdminErrors(errors) {
    $('adminErrors').replaceChildren(
      el('div', { class: 'admin-head' },
        el('h3', { text: errors.length ? `Errori del servizio (${errors.length})` : 'Errori del servizio' }),
        errors.length ? el('button', { class: 'btn mini', type: 'button', text: 'Svuota', onclick: async () => { await api('/api/admin/errors/clear', { method: 'POST' }); renderAdminErrors([]); } }) : null,
      ),
      ...(errors.length
        ? errors.slice(0, 15).map((e) => el('div', { class: 'err-row' },
            el('div', { class: 'err-top' }, el('b', { text: e.where }), el('span', { class: 'small muted', text: `${e.count > 1 ? `${e.count} volte · ` : ''}ultima ${ago(e.last)}` })),
            el('code', { class: 'err-msg', text: e.message }),
          ))
        : [el('p', { class: 'small muted', text: 'Nessun errore registrato. Se ne succede uno ricevi una notifica (al massimo ogni 6 ore per tipo).' })]),
    );
  }

  async function adminUpdate(u, patch) {
    try {
      await api('/api/admin/user', { method: 'POST', body: JSON.stringify({ id: u.id, ...patch }) });
    } catch (e) {
      alert(e.message);
    }
    loadAdmin();
  }

  /** Ora italiana della prossima mezzanotte UTC (01:00 d'inverno, 02:00 con l'ora legale). */
  function utcMidnightLocal() {
    const n = new Date();
    const next = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1);
    return new Date(next).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
  }

  const dateIt = (ts) => (ts ? new Date(ts).toLocaleDateString(document.documentElement.lang === 'en' ? 'en-GB' : 'it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  $('adminReload').addEventListener('click', loadAdmin);

  // ---------- rapporti di mercato (solo proprietario) ----------
  async function loadRatios() {
    const box = $('ratioBody');
    box.replaceChildren(el('p', { class: 'muted small', text: 'Carico…' }));
    let r;
    try { r = await api('/api/ratios'); } catch (e) { box.replaceChildren(el('p', { class: 'error', text: e.message })); return; }
    const LN = { jp: 'Giapponese', it: 'Italiano', fr: 'Francese', de: 'Tedesco', es: 'Spagnolo', pt: 'Portoghese', ko: 'Coreano', zh: 'Cinese' };
    const CS = { 'Slightly Played': 'SP', 'Moderately Played': 'MP', Played: 'PL', 'Heavily Played': 'HP', Poor: 'PO' };
    const keys = new Set(Object.keys(r).map((k) => k.replace(/\|(vintage|modern|all)$/, '')));
    const cell = (k, era) => {
      const x = r[`${k}|${era}`];
      if (!x) return el('td', { class: 'rt-none', text: '—' });
      return el('td', { class: x.n >= 20 ? '' : 'rt-few', title: `${x.n} carte` }, el('b', { text: `×${String(x.r).replace('.', ',')}` }), el('small', { text: ` ${x.n}` }));
    };
    const group = (title, list) => (list.length ? [
      el('tr', { class: 'rt-group' }, el('th', { colspan: '4', text: title })),
      ...list.map(([k, label]) => el('tr', null, el('th', { text: label }), cell(k, 'modern'), cell(k, 'vintage'), cell(k, 'all'))),
    ] : []);
    const ks = [...keys];
    const rows = [
      ...group('Condizione (rispetto a NM)', ks.filter((k) => k.startsWith('cond:')).sort((a, b) => Object.keys(CS).indexOf(a.slice(5)) - Object.keys(CS).indexOf(b.slice(5))).map((k) => [k, CS[k.slice(5)] || k.slice(5)])),
      ...group('Lingua (rispetto all’inglese)', ks.filter((k) => k.startsWith('lang:')).sort().map((k) => [k, LN[k.slice(5)] || k.slice(5).toUpperCase()])),
      ...group('Edizione', ks.filter((k) => k === 'first').map((k) => [k, '1ª edizione / normale'])),
      ...group('Voti (rispetto alla NM sciolta)', ks.filter((k) => k.startsWith('grade:')).sort((a, b) => a.localeCompare(b, 'it', { numeric: true })).map((k) => [k, k.slice(6)])),
    ];
    if (!rows.length) { box.replaceChildren(el('p', { class: 'muted small', text: 'Nessun rapporto ancora: il primo calcolo arriva entro 3 ore dagli annunci letti.' })); return; }
    box.replaceChildren(el('div', { class: 'rt-wrap' }, el('table', { class: 'rt' },
      el('thead', null, el('tr', null, el('th', { text: '' }), el('th', { text: 'Moderne' }), el('th', { text: 'Vintage' }), el('th', { text: 'Tutte' }))),
      el('tbody', null, ...rows))));
  }
  $('ratioLoad').addEventListener('click', loadRatios);

  /** Icone a tratto (stesso stile della barra in basso). */
  const ICONS = {
    star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
    starFill: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
    heart: 'M12 20s-7-4.4-9-9a4.6 4.6 0 0 1 9-2.3A4.6 4.6 0 0 1 21 11c-2 4.6-9 9-9 9z',
    heartFill: 'M12 20s-7-4.4-9-9a4.6 4.6 0 0 1 9-2.3A4.6 4.6 0 0 1 21 11c-2 4.6-9 9-9 9z',
    search: 'M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13zM15.5 15.5 20 20',
    edit: 'M3.5 20.5h4.2L20 8.2 15.8 4 3.5 16.3v4.2zM13.6 6.2l4.2 4.2',
    pause: 'M8 5v14M16 5v14',
    play: 'M7 5l12 7-12 7V5z',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  };
  function ico(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'ico' + (/Fill$/.test(name) ? ' fill' : ''));
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }

  // ---------- Poké Ball nella testata: traballa a ogni scan, grigia in errore o in pausa ----------
  let lastSeenScan = null;
  let ballTimer = null;
  let pauseTimer = null;

  function updateBall(s, active) {
    const top = document.querySelector('header.top');
    const sys = state.system || {};
    const until = sys.limitUntil && sys.limitUntil > Date.now() ? sys.limitUntil : null;
    const bad = !!(until || s.lastError);
    top.classList.toggle('ball-err', bad);
    top.classList.toggle('ball-wait', !!until && !s.lastError);
    if (bad) $('dot').className = until && !s.lastError ? 'dot wait' : 'dot err';
    clearInterval(pauseTimer);
    if (until) {
      // Conto alla rovescia fino alla fine della pausa chiesta da CardTrader.
      const tick = () => {
        const left = Math.max(0, Math.round((until - Date.now()) / 1000));
        $('statusText').textContent = `In pausa · riprende tra ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        if (!left) { clearInterval(pauseTimer); refresh(); }
      };
      tick();
      pauseTimer = setInterval(tick, 1000);
    } else if (s.lastError && active) {
      $('statusText').textContent = 'Problema con CardTrader · tocca';
    }
    // Uno scan nuovo rispetto all'ultimo visto: la Poké Ball traballa per un attimo.
    if (!bad && active && s.lastScan && lastSeenScan && s.lastScan !== lastSeenScan) {
      top.classList.remove('ball-scan');
      void top.offsetWidth; // riavvia l'animazione
      top.classList.add('ball-scan');
      $('statusText').textContent = 'Sto controllando…';
      clearTimeout(ballTimer);
      ballTimer = setTimeout(() => {
        top.classList.remove('ball-scan');
        if (state) $('statusText').textContent = `Ultimo scan ${ago(state.status.lastScan)}`;
      }, 1400);
    }
    lastSeenScan = s.lastScan || lastSeenScan;
  }
  document.querySelector('header.top .brand').addEventListener('click', () => goTab('settings'));
  // Anello del prossimo controllo: si svuota fino al prossimo giro, al centro i secondi dall'ultimo scan.
  // Toccandolo si apre il fumetto con i dettagli; dal fumetto si va in Opzioni.
  const RING = 2 * Math.PI * 15;
  function tickRing() {
    if (!state) return;
    const s = state.status || {};
    const top = document.querySelector('header.top');
    const active = state.rules.some((r) => r.enabled);
    const paused = state.settings && state.settings.paused;
    // Semaforo sulla Poké Ball: gialla se i controlli sono fermi (pausa o nessun alert attivo).
    top.classList.toggle('ball-paused', !!paused || !active);
    const plan = (state.account && state.account.plan) || {};
    const every = Math.max((state.settings && state.settings.scanEverySec) || 30, plan.scanSec || 10) * 1000;
    const err = top.classList.contains('ball-err');
    const age = s.lastScan ? Date.now() - s.lastScan : null;
    let label = '…', frac = 0, mode = 'ok';
    const until = state.system && state.system.limitUntil > Date.now() ? state.system.limitUntil : null;
    if (until && top.classList.contains('ball-wait')) {
      // Pausa chiesta da CardTrader: normale, si attende. Anello ambra che si riempie fino alla ripresa.
      const left = Math.ceil((until - Date.now()) / 1000);
      label = left < 60 ? `${left}s` : `${Math.ceil(left / 60)}m`; mode = 'wait';
      frac = Math.min(1, left / 300);
    } else if (err) { label = '!'; mode = 'err'; frac = 0; }
    else if (paused || !active) { label = paused ? 'II' : '–'; mode = 'off'; }
    else if (top.classList.contains('ball-scan')) { label = '•••'; frac = 1; }
    else if (age != null) {
      label = age < 60_000 ? `${Math.round(age / 1000)}s` : age < 3600_000 ? `${Math.floor(age / 60_000)}m` : `${Math.floor(age / 3600_000)}h`;
      frac = Math.max(0, 1 - age / every); // pieno subito dopo lo scan, vuoto quando sta per arrivare il prossimo
      if (age > every * 3) mode = 'late';
    }
    const st = document.querySelector('header.top .ring-status');
    st.dataset.mode = mode;
    $('ringLabel').textContent = label;
    $('ringProg').style.strokeDasharray = String(RING);
    $('ringProg').style.strokeDashoffset = String(RING * (1 - frac));
    const cyc = s.cycle && s.cycle.ms ? ` · giro ogni ${dur(s.cycle.ms)}` : '';
    const n = state.rules.filter((r) => r.enabled).length;
    $('ringSub').textContent = mode === 'wait' ? 'CardTrader ha chiesto una pausa: riprende da solo' : mode === 'off' ? (paused ? 'Scan in pausa da Opzioni' : 'Nessun alert attivo') : `${n} ${n === 1 ? 'alert attivo' : 'alert attivi'}${cyc}`;
    if ((mode === 'ok' || mode === 'late') && label !== '•••' && s.lastScan) $('statusText').textContent = `Ultimo scan ${ago(s.lastScan)}`;
    st.setAttribute('aria-label', `Stato del controllo: ${$('statusText').textContent}`);
  }
  setInterval(() => { if (!document.hidden) tickRing(); }, 1000);
  const ringEl = document.querySelector('header.top .ring-status');
  const closePop = () => { $('ringPop').hidden = true; ringEl.setAttribute('aria-expanded', 'false'); };
  ringEl.addEventListener('click', (e) => {
    if (e.target.closest('.ring-pop')) { closePop(); goTab('settings'); return; }
    const open = $('ringPop').hidden;
    $('ringPop').hidden = !open;
    ringEl.setAttribute('aria-expanded', String(open));
    tickRing();
  });
  ringEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ringEl.click(); } if (e.key === 'Escape') closePop(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('header.top .ring-status')) closePop(); });

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
    const det = c.ts ? [`Ultimo controllo ${ago(c.ts)} fa`.replace(' fa fa', ' fa'),
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
    if (!hviewChosen) { hviewChosen = true; setHview(unseen ? 'alerts' : 'coll'); }

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

  // ---------- impostazioni ----------
  const hhmmss = (ts) => new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  /** Riga chiave/valore; con meter (0–1) mostra anche una barra di utilizzo. */
  function kvRow(k, v, cls = '', meter = null) {
    return el('div', { class: ('kv-item ' + cls).trim() },
      el('span', { class: 'k', text: k }),
      el('span', { class: ('v ' + cls).trim(), text: v }),
      meter == null ? null : el('div', { class: 'meter' + (meter >= 0.9 ? ' full' : meter >= 0.7 ? ' high' : '') }, el('i', { style: `width:${Math.round(Math.min(1, meter) * 100)}%` })),
    );
  }

  /** Avanzamento del riconoscimento delle regioni: trovate in verde, senza annunci in giallo, errori in rosso. */
  function regionsRow(r, error) {
    const left = r.total - r.done;
    const row = kvRow('Regioni delle espansioni', left > 0 ? `${r.done} su ${r.total} · ne mancano ${left}` : `tutte fatte (${r.total})`, '', r.total ? r.done / r.total : null);
    row.append(el('div', { class: 'reg-stats' },
      el('span', { class: 'rs ok', text: `+${r.ok || 0} trovate` }),
      r.none ? el('span', { class: 'rs none', text: `${r.none} senza annunci` }) : null,
      r.err ? el('span', { class: 'rs err', text: `${r.err} errori` }) : null,
    ));
    if (error && r.err) row.append(el('span', { class: 'small muted', text: `Ultimo errore: ${error}` }));
    if (isOwner() && (r.none || r.err)) row.append(el('button', { class: 'btn mini', type: 'button', text: 'Vedi e indica la regione', onclick: openRegionProblems }));
    return row;
  }

  /** Espansioni senza regione: per ognuna si sceglie a mano (solo proprietario). */
  async function openRegionProblems() {
    let list;
    try { list = await api('/api/regions/problems'); } catch (e) { await alert(e.message); return; }
    const ov = el('div', { class: 'cs-overlay', onclick: (e) => { if (e.target === ov) ov.remove(); } });
    const REG = [['INT', '🌍 Int'], ['JAP', '🇯🇵 Jap'], ['CN', '🇨🇳 Cina'], ['KR', '🇰🇷 Corea'], ['Asia', '🌏 Asia']];
    const body = el('div', { class: 'cs-list im-list' });
    const draw = () => body.replaceChildren(...(list.length ? list.map((p) => el('div', { class: 'im-row ' + (p.kind === 'err' ? 'none' : '') },
      el('div', { class: 'im-line' }, el('b', { text: p.name }), el('span', { text: [p.code, p.kind === 'err' ? `errore: ${p.note}` : p.note].filter(Boolean).join(' · ') })),
      el('div', { class: 'fg-chips', style: 'margin-top:8px' }, ...REG.map(([v, l]) => el('button', { class: 'chip-btn', type: 'button', text: l, onclick: async () => {
        try { await api('/api/regions/set', { method: 'POST', body: JSON.stringify({ id: p.id, region: v }) }); list = list.filter((x) => x !== p); draw(); } catch (e) { await alert(e.message); }
      } }))))) : [el('p', { class: 'muted', text: 'Nessuna espansione da sistemare.' })]));
    draw();
    ov.append(el('div', { class: 'cs-sheet cs-dialog im', role: 'dialog', 'aria-label': 'Regioni da indicare' },
      el('div', { class: 'cs-grab' }), el('div', { class: 'cs-title', text: 'Regioni da indicare' }),
      el('p', { class: 'cs-text', text: 'Espansioni che il giro automatico non ha potuto riconoscere. Tocca la regione giusta: vale per tutti gli utenti.' }),
      body, el('div', { class: 'cs-actions' }, el('button', { class: 'btn primary', type: 'button', text: 'Fatto', onclick: () => ov.remove() }))));
    document.body.append(ov);
  }

  const dur = (ms) => (ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3600_000).toFixed(1).replace('.', ',')} ore`);

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
      kvRow('Account', state.account ? `${state.account.name || '—'} · piano ${state.account.plan.label}` : '—'),
      kvRow('Scansione', s.paused ? 'In pausa' : active ? (st.lastScan ? `ultimo controllo ${ago(st.lastScan)}` : 'in avvio…') : 'nessun alert attivo'),
      kvRow('Alert attivi', `${active} su ${state.rules.length}`),
      ...(st.cycle && active ? [kvRow('Giro completo', `tutti gli alert ricontrollati in ${dur(st.cycle.ms)}`, st.cycle.ms > 20 * 60_000 ? 'bad' : '')] : []),
      kvRow('CardTrader', limited ? `richieste limitate fino alle ${hhmmss(sys.limitUntil)}` : st.lastError ? st.lastError : 'tutto regolare', limited || st.lastError ? 'bad' : ''),
      ...(sys.regions ? [regionsRow(sys.regions, sys.regionError)] : []),
      kvRow('Indice delle carte', !idx ? 'non ancora creato' : idx.complete ? `pronto (${idx.withCards} espansioni)` : `in preparazione ${idx.done}/${idx.total || '?'}`),
      kvRow('Prezzi Cardmarket', sys.cm ? `aggiornati ${ago(sys.cm.ts)}` : sys.cmError ? `non disponibili: ${sys.cmError}` : 'in scaricamento…', !sys.cm && sys.cmError ? 'bad' : ''),
      kvRow('Iscrizioni alle notifiche', String(state.pushDevices)),
      kvRow('Versione', sys.build || '—'),
    ];
    if (sys.indexError) rows.push(kvRow('Errore indice', sys.indexError, 'bad'));
    if (sys.market) {
      const m = sys.market;
      const secs = m.gapMs / 1000;
      rows.push(kvRow('Velocità verso CardTrader', `una richiesta ogni ${secs % 1 ? secs.toFixed(1).replace('.', ',') : secs} secondi`));
      // "Rallentamenti": le volte in cui CardTrader ha chiesto di aspettare (risposta 429), dall'ultimo riavvio.
      const hits = (m.recent429 || []).filter((x) => Date.now() - x.ts < 24 * 3600_000);
      const lastHit = hits[hits.length - 1];
      rows.push(kvRow('Rallentamenti di CardTrader',
        !hits.length ? 'nessuno, tutto fluido'
        : `${hits.length} ${hits.length === 1 ? 'volta' : 'volte'}, l'ultima ${ago(lastHit.ts)}`,
        hits.length >= 5 ? 'bad' : ''));
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
    if (free('setSummary')) $('setSummary').checked = s.summary !== false;
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
  $('setSummary').addEventListener('change', () => saveSettings({ summary: $('setSummary').checked }));
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
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const today = () => new Date().toISOString().slice(0, 10);

  $('exportAll').addEventListener('click', async () => {
    const msg = $('backupMsg');
    msg.hidden = false;
    try {
      const data = await api('/api/export/full');
      download(`snipe-dati-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
      msg.textContent = `Scaricati: ${data.rules.length} alert, ${data.coll.length} carte in collezione, ${data.wish.length} desideri, ${data.alerts.length} avvisi.`;
    } catch (e) { msg.textContent = `Esportazione non riuscita: ${e.message}`; }
  });

  $('exportColl').addEventListener('click', async () => {
    const msg = $('backupMsg');
    msg.hidden = false;
    try {
      const d = await api('/api/collection');
      // Separatore ";" e virgola decimale: si apre direttamente con Excel in italiano.
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const eur = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
      const rows = [['Carta', 'Espansione', 'Lingua', 'Condizione', 'Copie', 'Pagata (€ l\'una)', 'Valore attuale (€ l\'una)', 'Valore totale (€)', 'Guadagno (€)', 'Cardmarket (€)', 'ID CardTrader']];
      for (const it of d.items) {
        const val = it.price ? it.price.cents : null;
        rows.push([it.name, it.expName, (it.lang || '').toUpperCase(), it.cond, it.qty, eur(it.paidCents), eur(val), eur(val == null ? null : val * it.qty), eur(val != null && it.paidCents ? (val - it.paidCents) * it.qty : null), eur(it.cmCents), it.bp]);
      }
      download(`snipe-collezione-${today()}.csv`, '\ufeff' + rows.map((r) => r.map(q).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
      msg.textContent = `${d.items.length} carte esportate in CSV.`;
    } catch (e) { msg.textContent = `Esportazione non riuscita: ${e.message}`; }
  });

  $('deleteAccount').addEventListener('click', async () => {
    const ok = await dialog({ title: 'Eliminare definitivamente il tuo account?', text: 'Alert, collezione, lista dei desideri, avvisi e impostazioni verranno cancellati e non si potranno recuperare. Il tuo account CardTrader non viene toccato. Scarica prima i tuoi dati se vuoi conservarli. Per confermare scrivi ELIMINA.', input: { placeholder: 'ELIMINA' }, ok: 'Elimina account', cancel: 'Annulla', danger: true });
    if (ok == null) return;
    if (ok.trim().toUpperCase() !== 'ELIMINA') { await alert('Account non eliminato: conferma non corretta.'); return; }
    try {
      await api('/api/account/delete', { method: 'POST', body: JSON.stringify({ confirm: 'ELIMINA' }) });
      await alert('Account eliminato. Grazie per aver usato HoloSnipe.');
      showLogin('');
    } catch (e) {
      alert(e.message);
    }
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

  // ---------- importa la collezione (CSV) ----------
  $('importColl').addEventListener('click', () => $('importCollFile').click());
  $('importCollFile').addEventListener('change', async () => {
    const f = $('importCollFile').files[0];
    $('importCollFile').value = '';
    if (!f) return;
    const msg = $('backupMsg');
    msg.hidden = false;
    msg.textContent = 'Leggo il file e cerco le carte…';
    try {
      const { rows } = await api('/api/collection/match', { method: 'POST', body: JSON.stringify({ csv: await f.text() }) });
      msg.hidden = true;
      importReview(rows);
    } catch (e) {
      msg.textContent = `Importazione non riuscita: ${e.message}`;
    }
  });

  /** Riepilogo prima di importare: trovate, da scegliere (tocchi la carta giusta), non trovate. */
  function importReview(rows) {
    const pick = new Map(rows.map((r, i) => [i, r.status === 'found' ? r.candidates[0] : null]));
    const ov = el('div', { class: 'cs-overlay' });
    const close = () => ov.remove();
    const cand = (i, c) => el('button', { class: 'im-cand' + (pick.get(i) === c ? ' sel' : ''), type: 'button', title: `${c.name} · ${c.expName}`,
      onclick: () => { pick.set(i, pick.get(i) === c ? null : c); draw(); } },
      c.image ? el('img', { src: c.image, alt: '', loading: 'lazy' }) : el('div', { class: 'noimg', text: '?' }),
      el('span', { text: (c.version || '').split('|').pop().trim() || c.expName }));
    const body = el('div', { class: 'cs-list im-list' });
    const head = el('div', { class: 'im-sum' });
    const go = el('button', { class: 'btn primary', type: 'button' });
    function draw() {
      const n = { found: 0, choose: 0, none: 0 };
      rows.forEach((r) => n[r.status]++);
      const ready = [...pick.values()].filter(Boolean).length;
      head.replaceChildren(chip(`✅ ${n.found} trovate`, 'on'), chip(`🟡 ${n.choose} da scegliere`, 'warn'), chip(`🔴 ${n.none} non trovate`, 'bad'));
      go.textContent = ready ? `Importa ${ready} ${ready === 1 ? 'carta' : 'carte'}` : 'Nessuna carta da importare';
      go.disabled = !ready;
      const sec = (t) => el('div', { class: 'exp-sec', text: t });
      const line = (r) => [r.name, r.number && `#${r.number}${r.total ? '/' + r.total : ''}`, r.set, r.lang && r.lang.toUpperCase(), r.cond, `×${r.qty}`].filter(Boolean).join(' · ');
      const block = (status, title) => {
        const list = rows.map((r, i) => [r, i]).filter(([r]) => r.status === status);
        if (!list.length) return [];
        return [sec(title), ...list.map(([r, i]) => el('div', { class: 'im-row ' + status },
          el('div', { class: 'im-line' }, el('b', { text: `Riga ${r.line}` }), el('span', { text: line(r) })),
          status === 'none' ? el('p', { class: 'small muted', text: 'Nessuna carta corrisponde: controlla nome, numero o espansione nel file.' })
            : el('div', { class: 'im-cands' }, ...r.candidates.map((c) => cand(i, c)))))];
      };
      body.replaceChildren(...block('choose', 'Da scegliere: tocca la carta giusta'), ...block('found', 'Trovate (tocca per escludere)'), ...block('none', 'Non trovate'));
    }
    go.addEventListener('click', async () => {
      const items = rows.map((r, i) => [r, pick.get(i)]).filter(([, c]) => c).map(([r, c]) => ({
        bp: c.id, name: c.name, image: c.image, expansionId: c.expansionId, expName: c.expName, lang: r.lang, cond: r.cond, qty: r.qty, paidCents: r.paidCents }));
      go.disabled = true;
      go.textContent = 'Importo…';
      try {
        const res = await api('/api/collection/import', { method: 'POST', body: JSON.stringify({ items }) });
        close();
        await alert(`${res.added} carte aggiunte${res.merged ? `, ${res.merged} già presenti (copie sommate)` : ''}.${res.limited ? ` ${res.limited} non aggiunte: il tuo piano include ${res.limit} carte diverse.` : ''} I prezzi arrivano nei prossimi minuti.`);
        coll = null;
        loadCollection();
      } catch (e) {
        go.disabled = false;
        draw();
        await alert(e.message);
      }
    });
    ov.append(el('div', { class: 'cs-sheet cs-dialog im', role: 'dialog', 'aria-label': 'Importa la collezione' },
      el('div', { class: 'cs-grab' }), el('div', { class: 'cs-title', text: 'Importa la collezione' }), head, body,
      el('div', { class: 'cs-actions' }, el('button', { class: 'btn', type: 'button', text: 'Annulla', onclick: close }), go)));
    draw();
    document.body.append(ov);
  }
  // ---------- regole ----------
  // Scelta dell'espansione: elenco nostro (non la tendina di sistema), più recenti in alto, filtri per regione.
  // La <select id="cardExp"> nascosta resta il "valore": chi la legge (caricamento carte) non cambia.
  const REGION_LABEL = { INT: '🌍 International', JAP: '🇯🇵 Giappone', CN: '🇨🇳 Cina', KR: '🇰🇷 Corea', Asia: '🌏 Asia' };
  const REGION_CHIPS = [['', 'Tutte'], ['vintage', '🕰️ Vintage'], ['INT', '🌍 Int'], ['JAP', '🇯🇵 Jap'], ['CN', '🇨🇳 Cina'], ['KR', '🇰🇷 Corea'], ['Asia', '🌏 Asia']];
  let expRegion = '';
  const recentExp = () => { try { return JSON.parse(localStorage.getItem('snipe.recentExp') || '[]'); } catch { return []; } };
  function pushRecent(id) {
    try { localStorage.setItem('snipe.recentExp', JSON.stringify([id, ...recentExp().filter((x) => x !== id)].slice(0, 5))); } catch {}
  }
  function expRow(e) {
    const cur = $('cardExp').value === String(e.id);
    return el('button', { class: 'exp-row' + (cur ? ' sel' : ''), type: 'button', onclick: () => chooseExp(String(e.id)) },
      el('span', { class: 'exp-code', text: (e.code || '').slice(0, 7) }),
      el('span', { class: 'exp-txt' }, el('span', { class: 'nm', text: e.name }), el('span', { class: 'sub', text: [e.code, e.released && e.released.slice(0, 4), e.vintage === 'WOTC' ? '🕰️ Era WOTC' : e.vintage === 'EX' ? '🕰️ Era EX' : ''].filter(Boolean).join(' · ') })),
      el('span', { class: `exp-reg ${e.region || 'unk'}`, text: e.region ? REGION_LABEL[e.region] || e.region : 'regione in arrivo' }),
    );
  }
  function fillCardExpansions() {
    const q = $('cardExpFilter').value.trim().toLowerCase();
    const sel = $('cardExp');
    const prev = sel.value;
    sel.replaceChildren(el('option', { value: '' }), el('option', { value: 'all' }), ...expansions.map((e) => el('option', { value: e.id })));
    sel.value = prev;
    // Dalla più recente, con la data di uscita di CardTrader; le espansioni senza data sono le nuovissime.
    const byNew = [...expansions].sort((a, b) => (b.released || '9999').localeCompare(a.released || '9999') || a.name.localeCompare(b.name, undefined, { numeric: true }));
    const items = byNew.filter((e) => (!expRegion || (expRegion === 'vintage' ? !!e.vintage : e.region === expRegion)) && (!q || e.name.toLowerCase().includes(q) || (e.code || '').toLowerCase().includes(q)));
    $('expChips').replaceChildren(...REGION_CHIPS.map(([id, label]) => el('button', { class: 'chip-btn', type: 'button', 'aria-pressed': String(expRegion === id), text: label, onclick: () => { expRegion = id; fillCardExpansions(); } })));
    const recent = !q && !expRegion ? recentExp().map((id) => expansions.find((e) => String(e.id) === id)).filter(Boolean) : [];
    const sec = (t) => el('div', { class: 'exp-sec', text: t });
    $('expList').replaceChildren(
      ...(q || expRegion ? [] : [el('button', { class: 'exp-row all', type: 'button', onclick: () => chooseExp('all') }, el('span', { class: 'exp-code', text: '🔍' }), el('span', { class: 'exp-txt' }, el('span', { class: 'nm', text: 'Tutte le espansioni' }), el('span', { class: 'sub', text: 'cerca un Pokémon per nome in tutti i set' })))]),
      ...(recent.length ? [sec('Usate di recente'), ...recent.map(expRow)] : []),
      ...(items.length ? [sec(q || expRegion ? `${items.length} espansioni` : 'Dalla più recente'), ...items.slice(0, 300).map(expRow)] : [sec('Nessuna espansione')]),
    );
    const cur = prev === 'all' ? { name: 'Tutte le espansioni' } : expansions.find((e) => String(e.id) === prev);
    $('expPick').querySelector('.ep-name').textContent = cur ? cur.name : 'Scegli un’espansione…';
  }
  function openExpPanel(open) {
    $('expPanel').hidden = !open;
    $('expPick').setAttribute('aria-expanded', String(open));
    if (open) fillCardExpansions();
  }
  function chooseExp(id) {
    const sel = $('cardExp');
    if (!sel.querySelector(`option[value="${id}"]`)) sel.append(el('option', { value: id }));
    sel.value = id;
    if (id !== 'all') pushRecent(id);
    $('cardExpFilter').value = '';
    openExpPanel(false);
    fillCardExpansions();
    sel.dispatchEvent(new Event('change'));
  }
  $('expPick').addEventListener('click', () => openExpPanel($('expPanel').hidden));
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
    $('edDrop').hidden = mode !== 'drop';
    $('edStock').hidden = mode !== 'stock';
  }

  // Alert su un intero set: stesso modulo della modifica, con valori di partenza prudenti.
  $('setAlertBtn').addEventListener('click', () => {
    if (!currentExp) return;
    const condNames = ['Poor', 'Heavily Played', 'Played', 'Moderately Played', 'Slightly Played', 'Near Mint', 'Mint'];
    const rank = $('cardCond').value;
    openEdit({
      expansionId: currentExp.id,
      expansionName: currentExp.name,
      minDiscount: 40,
      minPriceCents: 1000,
      minCondition: rank !== '' ? condNames[Number(rank)] : 'Near Mint',
      language: toRuleLang($('cardLang').value),
      zero: '',
      enabled: true,
      isNew: true,
    });
    $('edTitle').textContent = `Nuovo alert: ${currentExp.name}`;
    $('edSub').textContent = 'Scatta per qualunque carta del set che rispetta i filtri.';
  });

  function openEdit(r) {
    editing = r;
    const legacy = !r.blueprintId;
    $('edTitle').textContent = r.cardName || r.expansionName || 'Modifica alert';
    $('edSub').textContent = r.cardName ? r.expansionName || '' : 'Alert su tutta l’espansione';
    const mode = r.cmDiscount ? 'cm' : r.dropPct ? 'drop' : r.stock ? 'stock' : r.maxPriceCents ? 'price' : 'percent';
    document.querySelector(`input[name="emode"][value="${mode}"]`).checked = true;
    document.querySelectorAll('#editDialog .card-only').forEach((x) => (x.hidden = legacy));
    $('edDropPct').value = r.dropPct || 15;
    $('edDropLabel').textContent = `${$('edDropPct').value}%`;
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
  $('edDropPct').addEventListener('input', () => ($('edDropLabel').textContent = `${$('edDropPct').value}%`));
  $('alertDrop').addEventListener('input', () => ($('alertDropLabel').textContent = `${$('alertDrop').value}%`));

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
      enabled: editing.enabled !== false,
      priority: !!editing.priority,
      nameContains: editing.blueprintId ? editing.nameContains : $('edName').value,
      minPrice: editing.blueprintId ? 0 : Number($('edMinPrice').value),
      zero: $('edZero').value,
      minCondition: $('edCond').value,
      language: $('edLang').value,
      minDiscount: pct ? Number($('edPct').value) : editing.minDiscount,
    };
    if (editing.cmId) body.cmId = editing.cmId;
    if (emode === 'cm') {
      body.cmDiscount = Number($('edCmPct').value);
      body.cmId = editing.cmId;
    } else if (emode === 'drop') {
      body.dropPct = Number($('edDropPct').value);
    } else if (emode === 'stock') {
      body.stock = true;
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

  async function explainRule(r, fresh = false) {
    const d = $('explainDialog');
    $('exTitle').textContent = r.cardName || r.expansionName || 'Alert';
    $('exInfo').textContent = 'Controllo gli annunci attuali…';
    $('exRows').replaceChildren();
    openSheet(d);
    try {
      const data = await api(`/api/explain?rule_id=${r.id}${fresh ? '&fresh=1' : ''}`);
      const ok = data.rows.filter((x) => !x.reasons.length).length;
      if (data.note) { $('exInfo').textContent = data.note; return; }
      $('exInfo').textContent = data.rows.length
        ? `${data.cmTrend ? `Tendenza Cardmarket ${money(Math.round(data.cmTrend * 100))}. ` : ''}${data.total} annunci in vendita, i ${data.rows.length} più economici qui sotto. ${ok ? (ok === 1 ? '1 rispetta i filtri e fa scattare l’alert.' : `${ok} rispettano i filtri e fanno scattare l’alert.`) : 'Nessuno rispetta i filtri.'}`
        : 'CardTrader non mostra annunci per questa carta.';
      const dg = data.diag;
      if (dg) {
        const parts = [dg.scanTs ? `prezzi letti dallo scan ${ago(dg.scanTs)}` : 'lo scan non ha ancora letto i prezzi di questa carta', dg.seenCount === 1 ? '1 annuncio già segnalato' : `${dg.seenCount} annunci già segnalati`];
        if (!dg.enabled) parts.unshift('alert in pausa');
        if (dg.lastError) parts.push(`ultimo errore: ${dg.lastError}`);
        $('exInfo').append(el('span', { class: 'ex-diag', text: `Controllo in background: ${parts.join(' · ')}.` }));
        // Annunci appena comparsi: si può chiedere una lettura fresca a CardTrader.
        if (!data.fromScan) $('exInfo').append(el('span', { class: 'ex-diag', text: 'Annunci letti adesso da CardTrader.' }));
        if (data.fromScan) $('exInfo').append(el('button', { class: 'btn mini ex-fresh', type: 'button', text: '↻ Leggi ora da CardTrader', onclick: () => explainRule(r, true) }));
      }
      $('exRows').replaceChildren(
        ...data.rows.map((x) =>
          el('a', { class: 'lrow', href: x.url, target: '_blank', rel: 'noopener', title: 'Apri su CardTrader' },
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

  /** Nome e/o numero: "charizard", "198", "198/195", "Charizard 198/195". */
  function cardMatchesQuery(c, q) {
    const z = (x) => String(x || '').replace(/^0+(?=\d)/, '').toLowerCase();
    const nums = [];
    const rest = q.replace(/#?([a-z]*\d+[a-z]*)\s*\/\s*([a-z]*\d+)/gi, (m, n, t) => { nums.push([z(n), z(t)]); return ' '; });
    const words = plainText(rest).split(/[^a-z0-9]+/).filter(Boolean);
    const named = words.filter((w) => !/^\d+$/.test(w));
    for (const w of words.filter((x) => /^\d+$/.test(x))) nums.push([z(w), '']);
    const name = plainText(c.name);
    if (!named.every((w) => name.includes(w))) return false;
    const cn = z(String(c.number || '').split('/')[0]);
    const ct = z((String(c.version || '').match(/\/\s*([a-z]*\d+)/i) || [])[1] || String(c.number || '').split('/')[1]);
    return nums.every(([n, t]) => cn === n && (!t || !ct || ct === t));
  }

  function renderCards() {
    const q = $('cardSearch').value.trim().toLowerCase();
    const zeroMode = $('cardPriceMode').value === 'zero';
    const singlesOnly = $('cardKind').value === 'single';
    const rar = $('cardRarity').value;
    const list = cards.filter((c) => (!singlesOnly || c.single !== false) && (searchMode || !q || cardMatchesQuery(c, q)) && (!rar || rarityOf(c) === rar));
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
            ownedBadge(c.id),
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

  // ---------- filtro rarità (dalla versione CardTrader: "Special Illustration Rare | 199/165") ----------
  let searchAll = []; // risultati completi della ricerca, prima del filtro rarità
  const rarityOf = (c) => rarityFromVersion(c.version) || '';
  /** Riempie il menu con le rarità presenti, dalla più frequente; lo nasconde se ce n'è meno di due. */
  function fillRarities(list) {
    const count = new Map();
    for (const c of list) { const r = rarityOf(c); if (r) count.set(r, (count.get(r) || 0) + 1); }
    const sel = $('cardRarity');
    const prev = sel.value;
    const opts = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    sel.replaceChildren(el('option', { value: '', text: 'Tutte le rarità' }), ...opts.map(([r, n]) => el('option', { value: r, text: `${r} (${n})` })));
    sel.value = count.has(prev) ? prev : '';
    $('cardRarityRow').hidden = opts.length < 2 && !sel.value;
  }
  /** In ricerca filtra le espansioni prima di caricarle a pagine, così il filtro vale anche per quelle non ancora mostrate. */
  function applySearchRarity() {
    const r = $('cardRarity').value;
    searchSets = !r ? searchAll : searchAll.map((set) => ({ ...set, cards: set.cards.filter((c) => rarityOf(c) === r) })).filter((set) => set.cards.length);
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
    searchAll = [];
    searchTotal = 0;
    shownSets = 0;
    priceNote = '';
    $('moreSets').hidden = true;
    $('cardRarityRow').hidden = !$('cardRarity').value;
    if (q.replace(/\s/g, '').length < 3) { renderCards(); return; }
    $('cardsMsg').hidden = false;
    $('cardsMsg').textContent = 'Cerco…';
    $('cardGrid').replaceChildren(...Array.from({ length: 6 }, () => el('div', { class: 'skel' })));
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (run !== searchRun || !searchMode) return;
      searchAll = data.sets;
      fillRarities(searchAll.flatMap((set) => set.cards));
      applySearchRarity();
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
      // Un attimo di respiro tra un'espansione e l'altra: CardTrader limita le richieste ravvicinate.
      if (n > 1) await new Promise((r) => setTimeout(r, 700));
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
        // CardTrader chiede una pausa: si aspetta il tempo indicato e si riprova la stessa espansione, senza fermarsi.
        const m = /riprovo tra (\d+)s/.exec(e.message);
        if (m && !set.retried) {
          set.retried = true;
          for (let left = Number(m[1]) + 1; left > 0; left--) {
            if (run !== searchRun) return;
            priceNote = `CardTrader chiede una pausa: riprendo tra ${left}s`;
            renderCards();
            await new Promise((r) => setTimeout(r, 1000));
          }
          batch.splice(n, 0, set); // stessa espansione di nuovo, al prossimo giro del ciclo
          n--;
          continue;
        }
        cards = cards.map((c) => (c.expansionId === set.id ? { ...c, loading: false } : c));
        priceNote = 'prezzi non disponibili per alcune espansioni';
      }
      fillLanguages(languagesOf(cards));
    }
    if (run !== searchRun) return;
    if (!/non disponibili/.test(priceNote)) priceNote = '';
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
    fillRarities([]);
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
      fillRarities(cards);
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
  // Cambio di lingua o condizione con la scheda della carta aperta: la scheda si ricalcola.
  for (const id of ['cardCond', 'cardLang']) $(id).addEventListener('change', () => { if ($('cardDialog').open && current) openCard(current); });
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
  $('cardRarity').addEventListener('change', () => {
    if (!searchMode) { renderCards(); return; }
    // In ricerca ripartiamo dalla prima pagina di espansioni con il nuovo filtro.
    searchRun++;
    applySearchRarity();
    cards = [];
    shownSets = 0;
    loadNextSets(searchRun);
  });

  function renderCmBox(c) {
    const box = $('dlgCm');
    if (!c.cm) { box.hidden = true; box.replaceChildren(); $('amodeCmLabel').hidden = true; return; }
    const d = cmDelta(c);
    box.hidden = false;
    const cell = (label, cents) => (cents == null ? null : el('div', { class: 'cmcell' }, el('span', { text: label }), el('b', { text: money(Math.round(cents * 100), c.currency) })));
    const parts = [
      el('div', { class: 'cmtitle', text: 'Cardmarket · tutte le lingue e condizioni' }),
      el('div', { class: 'cmrow' }, ...[cell('tendenza', c.cm.trend), cell('media 30 giorni', c.cm.avg30), cell('più basso', c.cm.low)].filter(Boolean)),
      d == null ? null : el('div', { class: 'delta ' + (d >= 0.05 ? 'good' : d <= -0.05 ? 'bad' : ''), text: d >= 0 ? `CardTrader conviene: −${Math.round(d * 100)}% rispetto alla tendenza Cardmarket` : `Su CardTrader costa il ${Math.round(-d * 100)}% in più della tendenza Cardmarket` }),
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
    // Lingua e condizione si cambiano da qui: toccando la pillola si apre la scelta, e prezzi e annunci si ricalcolano.
    const pick = (cls, text, sel) => el('button', { class: `chip chip-pick ${cls}`, type: 'button', onclick: () => cselOpen($(sel)) }, el('span', { text }), el('span', { class: 'cp-arrow', text: '▾', 'aria-hidden': 'true' }));
    $('dlgLangNote').replaceChildren(
      pick('zero', lang ? `Prezzi in ${LANG_NAMES[lang] || lang.toUpperCase()}` : 'Tutte le lingue', 'cardLang'),
      pick('cond', minRank !== '' ? `${condNames[Number(minRank)]} o migliore` : 'Qualsiasi condizione', 'cardCond'),
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
    if (current.cmId) body.cmId = current.cmId;
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
  $('clearAlerts').addEventListener('click', async () => { if (!(await askConfirm('Gli alert restano attivi: cambia solo l’elenco degli avvisi già ricevuti.', { title: 'Cancellare lo storico avvisi?', ok: 'Cancella', danger: true }))) return; await api('/api/alerts', { method: 'DELETE' }); knownTop = null; refresh(); });

  // ---------- benvenuto ----------
  // Alla prima apertura (nessun alert): tre passi per partire. Si mostra una volta sola per dispositivo.
  function maybeWelcome() {
    let seen = false;
    try { seen = localStorage.getItem('snipe.welcome') === '1'; } catch {}
    if (seen || !state || state.rules.length) return;
    const close = () => { try { localStorage.setItem('snipe.welcome', '1'); } catch {} ov.remove(); };
    const step = (n, title, text, label, action) => el('div', { class: 'wl-step' },
      el('span', { class: 'wl-n', text: String(n) }),
      el('div', { class: 'wl-txt' }, el('b', { text: title }), el('span', { text })),
      el('button', { class: 'btn mini', type: 'button', text: label, onclick: () => { close(); action(); } }));
    const ov = el('div', { class: 'cs-overlay' },
      el('div', { class: 'cs-sheet cs-dialog wl', role: 'dialog', 'aria-label': 'Benvenuto in HoloSnipe' },
        el('div', { class: 'cs-grab' }),
        el('div', { class: 'cs-title', text: 'Benvenuto in HoloSnipe' }),
        el('p', { class: 'cs-text', text: 'HoloSnipe controlla CardTrader al posto tuo e ti avvisa appena una carta scende sotto il prezzo che vuoi. Si parte in tre passi:' }),
        el('div', { class: 'wl-steps' },
          step(1, 'Crea il primo alert', 'Cerca una carta, tocca “Alert” e scegli il prezzo.', 'Cerca', () => goTab('cards')),
          step(2, 'Attiva le notifiche', 'Così l’avviso ti arriva anche ad app chiusa.', 'Attiva', () => { goTab('settings'); $('pushEnable').click(); }),
          step(3, 'Aggiungi la tua collezione', 'Con “Ce l’ho” o scansionando le carte: vedi quanto vale.', 'Scansiona', () => { goTab('cards'); const b = document.querySelector('[data-scan]'); if (b) b.click(); })),
        el('div', { class: 'cs-actions' }, el('button', { class: 'btn primary', type: 'button', text: 'Ho capito', onclick: close }))));
    document.body.append(ov);
  }
  // ---------- avvio ----------
  async function start() {
    state = null;
    await refresh();
    if (!state) { // nessuna sessione (compare l'accesso) o server non raggiungibile
      if ($('login').hidden) showLogin('Connessione non riuscita: riprova.');
      return;
    }
    $('login').hidden = true;
    $('app').hidden = false;
    maybeWelcome();
    // Collezione caricata subito: serve al badge "Ce l'ho" in Cerca, Affari e Regole.
    if (!coll) api('/api/collection').then((d) => { if (!coll) coll = d; render(); renderCards(); if (dealsData) renderDeals(dealsData); }).catch(() => null);
    api('/api/expansions').then((l) => { expansions = l; fillCardExpansions(); if (coll) renderCollection(); }).catch((e) => {
      $('cardsMsg').textContent = `Elenco espansioni non disponibile: ${e.message}`;
      $('cardsMsg').hidden = false;
    });
    clearInterval(timer);
    // Ogni 15 secondi, e solo con l'app in primo piano: ogni aggiornamento è una richiesta al server.
    timer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  }

  $('ruleSearch').addEventListener('input', render);
  const toggleFilters = (open) => { $('ruleFilters').hidden = !open; $('ruleFilterBtn').setAttribute('aria-expanded', String(open)); render(); };
  $('ruleFilterBtn').addEventListener('click', () => toggleFilters($('ruleFilters').hidden));
  $('ruleFilterClose').addEventListener('click', () => toggleFilters(false));
  $('ruleFilterReset').addEventListener('click', () => { ruleState = 'all'; ruleLang = ''; ruleCond = ''; ruleZero = ''; render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state) refresh(); });
  $('setNameSave').addEventListener('click', async () => {
    try {
      await api('/api/profile', { method: 'POST', body: JSON.stringify({ displayName: $('setName').value }) });
      await refresh();
      $('setName').value = '';
    } catch (e) {
      alert(e.message);
    }
  });

  // Lingua dell'app (i18n.js traduce l'interfaccia; cambiare lingua ricarica la pagina).
  if (window.snipeLang) {
    document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => {
      b.classList.toggle('on', b.dataset.lang === window.snipeLang.get());
      b.addEventListener('click', () => window.snipeLang.set(b.dataset.lang));
    });
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  start(); // senza sessione valida la prima richiesta risponde 401 e compare l'accesso
})();
