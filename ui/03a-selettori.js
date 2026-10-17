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
