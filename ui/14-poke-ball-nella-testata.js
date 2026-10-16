  // ---------- Poké Ball nella testata: traballa a ogni scan, grigia in errore o in pausa ----------
  let lastSeenScan = null;
  let ballTimer = null;
  let pauseTimer = null;

  function updateBall(s, active) {
    const top = document.querySelector('header.top');
    const sys = state.system || {};
    const until = sys.limitUntil && sys.limitUntil > Date.now() ? sys.limitUntil : null;
    const bad = !!(until || s.lastError);
    top.classList.toggle('ball-err', bad);
    if (bad) $('dot').className = 'dot err';
    clearInterval(pauseTimer);
    if (until) {
      // Conto alla rovescia fino alla fine della pausa chiesta da CardTrader.
      const tick = () => {
        const left = Math.max(0, Math.round((until - Date.now()) / 1000));
        $('statusText').textContent = `In pausa · riprende tra ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        if (!left) { clearInterval(pauseTimer); refresh(); }
      };
      tick();
      pauseTimer = setInterval(tick, 1000);
    } else if (s.lastError && active) {
      $('statusText').textContent = 'Problema con CardTrader · tocca';
    }
    // Uno scan nuovo rispetto all'ultimo visto: la Poké Ball traballa per un attimo.
    if (!bad && active && s.lastScan && lastSeenScan && s.lastScan !== lastSeenScan) {
      top.classList.remove('ball-scan');
      void top.offsetWidth; // riavvia l'animazione
      top.classList.add('ball-scan');
      $('statusText').textContent = 'Sto controllando…';
      clearTimeout(ballTimer);
      ballTimer = setTimeout(() => {
        top.classList.remove('ball-scan');
        if (state) $('statusText').textContent = `Ultimo scan ${ago(state.status.lastScan)}`;
      }, 1400);
    }
    lastSeenScan = s.lastScan || lastSeenScan;
  }
  document.querySelector('header.top .brand').addEventListener('click', () => goTab('settings'));
  document.querySelector('header.top .status').addEventListener('click', () => goTab('settings'));

