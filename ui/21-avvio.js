  // ---------- avvio ----------
  async function start() {
    state = null;
    await refresh();
    if (!state) { // nessuna sessione (compare l'accesso) o server non raggiungibile
      if ($('login').hidden) showLogin('Connessione non riuscita: riprova.');
      return;
    }
    $('login').hidden = true;
    $('app').hidden = false;
    maybeWelcome();
    api('/api/expansions').then((l) => { expansions = l; fillCardExpansions(); }).catch((e) => {
      $('cardsMsg').textContent = `Elenco espansioni non disponibile: ${e.message}`;
      $('cardsMsg').hidden = false;
    });
    clearInterval(timer);
    // Ogni 15 secondi, e solo con l'app in primo piano: ogni aggiornamento è una richiesta al server.
    timer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  }

  $('ruleSearch').addEventListener('input', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state) refresh(); });
  $('setNameSave').addEventListener('click', async () => {
    try {
      await api('/api/profile', { method: 'POST', body: JSON.stringify({ displayName: $('setName').value }) });
      await refresh();
      $('setName').value = '';
    } catch (e) {
      alert(e.message);
    }
  });

  // Lingua dell'app (i18n.js traduce l'interfaccia; cambiare lingua ricarica la pagina).
  if (window.snipeLang) {
    $('setLang').value = window.snipeLang.get();
    $('setLang').addEventListener('change', () => window.snipeLang.set($('setLang').value));
    document.querySelectorAll('.lang-switch [data-lang]').forEach((b) => {
      b.classList.toggle('on', b.dataset.lang === window.snipeLang.get());
      b.addEventListener('click', () => window.snipeLang.set(b.dataset.lang));
    });
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  start(); // senza sessione valida la prima richiesta risponde 401 e compare l'accesso
})();

