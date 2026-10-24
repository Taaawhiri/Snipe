  // ---------- "＋ Aggiungi" in cima alla collezione: tutti i modi di aggiungere carte in un menu ----------
  $('collAddBtn').addEventListener('click', () => {
    const ov = el('div', { class: 'cs-overlay', onclick: (e) => { if (e.target === ov) ov.remove(); } });
    const item = (icon, title, sub, go) => el('button', { class: 'cs-opt add-opt', type: 'button', onclick: () => { ov.remove(); go(); } },
      el('span', { class: 'ao-i', text: icon }), el('span', { class: 'ao-t' }, el('b', { text: title }), el('small', { text: sub })));
    ov.append(el('div', { class: 'cs-sheet', role: 'dialog', 'aria-label': 'Aggiungi carte' },
      el('div', { class: 'cs-grab' }), el('div', { class: 'cs-title', text: 'Aggiungi carte' }),
      el('div', { class: 'cs-list' },
        item('📷', 'Scansiona una carta', 'Con la fotocamera: la riconosco io', () => document.querySelector('.coll-actions [data-scan]').click()),
        item('🗂️', 'Più carte insieme', 'Scansione di più carte o importazione da file', () => $('batchOpen').click()),
        item('🧾', 'Dagli ordini CardTrader', 'Importa gli acquisti con il prezzo pagato', () => openOrdersImport()),
        item('＋', 'Cerca una carta', 'Per nome o per espansione', () => goTab('cards')))));
    document.body.append(ov);
  });
