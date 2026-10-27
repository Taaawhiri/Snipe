  // ---------- impostazioni ----------
  const hhmmss = (ts) => new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

  /** Riga chiave/valore; con meter (0–1) mostra anche una barra di utilizzo. */
  function kvRow(k, v, cls = '', meter = null, progress = false) {
    return el('div', { class: ('kv-item ' + cls).trim() },
      el('span', { class: 'k', text: k }),
      el('span', { class: ('v ' + cls).trim(), text: v }),
      meter == null ? null : el('div', { class: 'meter' + (progress ? ' prog' : meter >= 0.9 ? ' full' : meter >= 0.7 ? ' high' : '') }, el('i', { style: `width:${Math.round(Math.min(1, meter) * 100)}%` })),
    );
  }

  /** Giro degli affari del giorno: quante espansioni sono state lette di recente e quando è stata l'ultima lettura. */
  function dealsRow(d) {
    const late = !d.lastTs || Date.now() - d.lastTs > 15 * 60_000;
    const row = kvRow('Affari del giorno', d.total ? `${d.fresh} espansioni su ${d.total} lette nelle ultime 12 ore` : `${d.fresh} espansioni lette nelle ultime 12 ore`, d.error ? 'bad' : late ? 'warn' : '', d.total ? d.fresh / d.total : null, true);
    row.append(el('span', { class: 'small muted', text: d.lastTs ? `Ultima lettura ${ago(d.lastTs)}${d.last ? `: ${d.last}` : ''}${late ? ' · più lenta del solito' : ''}` : 'Nessuna lettura ancora: parte entro qualche minuto.' }));
    if (d.total) row.append(el('span', { class: 'small muted', text: `Valori delle espansioni calcolati: ${d.probed} su ${d.total} · lette almeno una volta: ${d.everRead}` }));
    if (d.error) row.append(el('span', { class: 'small muted', text: `Ultimo errore: ${friendlyError(d.error)}` }));
    return row;
  }

  /** Avanzamento del riconoscimento delle regioni: trovate in verde, senza annunci in giallo, errori in rosso. */
  function regionsRow(r, error) {
    const left = r.total - r.done;
    const row = kvRow('Regioni delle espansioni', left > 0 ? `${r.done} su ${r.total} · ne mancano ${left}` : `tutte fatte (${r.total})`, '', r.total ? r.done / r.total : null, true); // avanzamento: pieno = finito, sempre verde
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
      ...(sys.reads && active ? [(() => {
        const r = sys.reads;
        const last = r.last ? `ultimo giro: ${r.last.read} letture su ${r.last.want}${r.last.error ? ` (${friendlyError(r.last.error)})` : ''}` : 'nessun giro ancora';
        const row = kvRow('Letture degli alert', `${r.hour} nell'ultima ora (circa ${Math.round(r.hour / 6) / 10} al minuto)`);
        row.append(el('span', { class: 'small muted', text: last }));
        return row;
      })()] : []),
      ...(sys.push ? [(() => {
        const p = sys.push;
        const l = p.last;
        const txt = !p.subs ? 'nessun dispositivo iscritto: premi «Attiva notifiche» qui sotto'
          : !l ? `${p.subs} ${p.subs === 1 ? 'dispositivo' : 'dispositivi'}, nessun invio ancora`
          : l.why === 'quiet' ? `ultimo avviso non inviato: orari silenziosi (${ago(l.ts)})`
          : l.why === 'nosubs' ? 'nessun dispositivo iscritto'
          : `${p.subs} ${p.subs === 1 ? 'dispositivo' : 'dispositivi'} · ultimo invio ${ago(l.ts)}: ${l.sent} consegnat${l.sent === 1 ? 'o' : 'i'} (codici ${l.codes.join(', ')})`;
        return kvRow('Notifiche push', txt, !p.subs || (l && l.codes && l.sent === 0 && l.codes.length) ? 'bad' : '');
      })()] : []),
      ...(st.cycle && active ? [kvRow('Giro completo', `tutti gli alert ricontrollati in ${dur(st.cycle.ms)}`, st.cycle.ms > 20 * 60_000 ? 'warn' : '')] : []),
      kvRow('CardTrader', limited ? `richieste limitate fino alle ${hhmmss(sys.limitUntil)}` : st.lastError ? friendlyError(st.lastError) : 'tutto regolare', limited || st.lastError ? 'bad' : ''),
      ...(sys.regions ? [regionsRow(sys.regions, sys.regionError)] : []),
      ...(sys.deals ? [dealsRow(sys.deals)] : []),
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
    if (free('setOrderAlerts')) $('setOrderAlerts').checked = s.orderAlerts !== false;
    if (free('setReminders')) $('setReminders').checked = s.reminders !== false;
    if (free('setCollMin')) $('setCollMin').value = s.collMinCents ? String(s.collMinCents / 100).replace('.', ',') : '';
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
  $('pushBanner').addEventListener('click', () => { goTab('settings'); setTimeout(() => { const b = $('pushEnable'); if (b) b.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 150); });
  $('setPaused').addEventListener('change', () => saveSettings({ paused: $('setPaused').checked }));
  $('setScan').addEventListener('change', () => saveSettings({ scanEverySec: Number($('setScan').value) }));
  $('setQuiet').addEventListener('change', () => saveSettings({ quietEnabled: $('setQuiet').checked }));
  $('setSummary').addEventListener('change', () => saveSettings({ summary: $('setSummary').checked }));
  $('setReminders').addEventListener('change', () => saveSettings({ reminders: $('setReminders').checked }));
  $('setOrderAlerts').addEventListener('change', () => saveSettings({ orderAlerts: $('setOrderAlerts').checked }));
  $('setCollMin').addEventListener('change', () => {
    const v = parseFloat($('setCollMin').value.replace(',', '.'));
    saveSettings({ collMinCents: Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0 }).then(() => { coll = null; });
  });
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

