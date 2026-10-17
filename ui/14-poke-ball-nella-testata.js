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
  // Anello del prossimo controllo: si svuota fino al prossimo giro, al centro i secondi dall'ultimo scan.
  // Toccandolo si apre il fumetto con i dettagli; dal fumetto si va in Opzioni.
  const RING = 2 * Math.PI * 15;
  function tickRing() {
    if (!state) return;
    const s = state.status || {};
    const top = document.querySelector('header.top');
    const active = state.rules.some((r) => r.enabled);
    const paused = state.settings && state.settings.paused;
    const plan = (state.account && state.account.plan) || {};
    const every = Math.max((state.settings && state.settings.scanEverySec) || 30, plan.scanSec || 10) * 1000;
    const err = top.classList.contains('ball-err');
    const age = s.lastScan ? Date.now() - s.lastScan : null;
    let label = '…', frac = 0, mode = 'ok';
    if (err) { label = '!'; mode = 'err'; frac = 0; }
    else if (paused || !active) { label = paused ? 'II' : '–'; mode = 'off'; }
    else if (top.classList.contains('ball-scan')) { label = '•••'; frac = 1; }
    else if (age != null) {
      label = age < 60_000 ? `${Math.round(age / 1000)}s` : age < 3600_000 ? `${Math.floor(age / 60_000)}m` : `${Math.floor(age / 3600_000)}h`;
      frac = Math.max(0, 1 - age / every); // pieno subito dopo lo scan, vuoto quando sta per arrivare il prossimo
      if (age > every * 3) mode = 'late';
    }
    const st = document.querySelector('header.top .ring-status');
    st.dataset.mode = mode;
    $('ringLabel').textContent = label;
    $('ringProg').style.strokeDasharray = String(RING);
    $('ringProg').style.strokeDashoffset = String(RING * (1 - frac));
    const cyc = s.cycle && s.cycle.ms ? ` · giro ogni ${dur(s.cycle.ms)}` : '';
    const n = state.rules.filter((r) => r.enabled).length;
    $('ringSub').textContent = mode === 'off' ? (paused ? 'Scan in pausa da Opzioni' : 'Nessun alert attivo') : `${n} ${n === 1 ? 'alert attivo' : 'alert attivi'}${cyc}`;
    if ((mode === 'ok' || mode === 'late') && label !== '•••' && s.lastScan) $('statusText').textContent = `Ultimo scan ${ago(s.lastScan)}`;
    st.setAttribute('aria-label', `Stato del controllo: ${$('statusText').textContent}`);
  }
  setInterval(() => { if (!document.hidden) tickRing(); }, 1000);
  const ringEl = document.querySelector('header.top .ring-status');
  const closePop = () => { $('ringPop').hidden = true; ringEl.setAttribute('aria-expanded', 'false'); };
  ringEl.addEventListener('click', (e) => {
    if (e.target.closest('.ring-pop')) { closePop(); goTab('settings'); return; }
    const open = $('ringPop').hidden;
    $('ringPop').hidden = !open;
    ringEl.setAttribute('aria-expanded', String(open));
    tickRing();
  });
  ringEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ringEl.click(); } if (e.key === 'Escape') closePop(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('header.top .ring-status')) closePop(); });

