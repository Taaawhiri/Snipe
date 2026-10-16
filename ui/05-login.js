  // ---------- login ----------
  function showLogin(msg) {
    if (!$('loginPlans').childElementCount) $('loginPlans').replaceChildren(...planTable('free'));
    clearInterval(timer);
    $('app').hidden = true;
    $('login').hidden = false;
    const e = $('loginError');
    e.hidden = !msg;
    e.textContent = msg || '';
  }
  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter || $('loginForm').querySelector('button');
    btn.disabled = true;
    try {
      const res = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: $('keyInput').value.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
      $('keyInput').value = '';
      start();
    } catch (e) {
      showLogin(e.message);
    } finally {
      btn.disabled = false;
    }
  });
  $('logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
    showLogin('');
  });

