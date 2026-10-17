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
