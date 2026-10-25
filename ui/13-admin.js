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
    plus: 'M12 5v14M5 12h14',
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

