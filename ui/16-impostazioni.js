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
      kvRow('CardTrader', limited ? `richieste limitate fino alle ${hhmmss(sys.limitUntil)}` : st.lastError ? st.lastError : 'tutto regolare', limited || st.lastError ? 'bad' : ''),
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
    const ok = window.prompt('Eliminare definitivamente il tuo account Snipe? Alert, collezione, lista dei desideri, avvisi e impostazioni verranno cancellati e non si potranno recuperare. Il tuo account CardTrader non viene toccato.\n\nScarica prima i tuoi dati se vuoi conservarli. Per confermare scrivi ELIMINA.');
    if (ok == null) return;
    if (ok.trim().toUpperCase() !== 'ELIMINA') { alert('Account non eliminato: conferma non corretta.'); return; }
    try {
      await api('/api/account/delete', { method: 'POST', body: JSON.stringify({ confirm: 'ELIMINA' }) });
      alert('Account eliminato. Grazie per aver usato Snipe.');
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

