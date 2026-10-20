  // ---------- pannelli a comparsa ----------
  const sheets = ['cardDialog', 'editDialog', 'explainDialog', 'sellerDialog', 'ownDialog', 'scanDialog', 'batchDialog'].map((id) => $(id));
  // Il tasto/gesto indietro del telefono chiude il pannello aperto invece di uscire dall'app.
  let sheetEntry = false;
  let skipPop = false;
  function openSheet(d) {
    if (!sheetEntry) { history.pushState({ sheet: 1 }, ''); sheetEntry = true; }
    if (!d.open) d.show(); // non modale: il browser non usa il livello superiore
    // L'ultima scheda aperta va sopra le altre (es. "Ce l'ho" aperta dalla scansione).
    sheets.forEach((s) => { s.style.zIndex = ''; });
    d.style.zIndex = 49;
    $('sheetBackdrop').hidden = false;
    document.documentElement.classList.add('noscroll');
    d.scrollTop = 0;
  }
  function closeSheets() { sheets.forEach((s) => s.open && s.close()); }
  sheets.forEach((d) => d.addEventListener('close', () => {
    if (sheets.some((s) => s.open)) return;
    $('sheetBackdrop').hidden = true;
    document.documentElement.classList.remove('noscroll');
    if (sheetEntry) { sheetEntry = false; skipPop = true; history.back(); }
  }));
  $('sheetBackdrop').addEventListener('click', closeSheets);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

