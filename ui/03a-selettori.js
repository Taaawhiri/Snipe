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
