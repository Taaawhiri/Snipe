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
