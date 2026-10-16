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
        await saveOwn({ bp: c.id, name: c.name + (c.version ? ` (${c.version})` : ''), image: c.image, expansionId: c.expansionId, expName: c.expName, lang: row.lang, cond: row.cond, qty: row.qty, add: true, paidCents: paid > 0 ? Math.round(paid * 100) : null });
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

