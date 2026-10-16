  // ---------- pannelli a comparsa ----------
  const sheets = ['cardDialog', 'editDialog', 'explainDialog', 'sellerDialog', 'ownDialog', 'scanDialog', 'batchDialog'].map((id) => $(id));
  function openSheet(d) {
    if (!d.open) d.show(); // non modale: il browser non usa il livello superiore
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

