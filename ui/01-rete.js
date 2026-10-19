  // ---------- rete ----------
  /**
   * Messaggio d'errore comprensibile: niente codici, nomi tecnici o testo in inglese dei servizi.
   * I messaggi già scritti per l'utente (frasi italiane dell'app) passano così come sono.
   */
  function friendlyError(msg) {
    const m = String(msg || '');
    if (/failed to fetch|networkerror|load failed|network request failed|internet/i.test(m)) return 'Connessione assente o instabile: controlla internet e riprova.';
    if (/timeout|timed out|aborterror|aborted/i.test(m)) return 'La risposta sta tardando troppo: riprova tra poco.';
    if (/unexpected token|json|syntaxerror|is not valid/i.test(m)) return 'Risposta non valida dal server: riprova tra poco.';
    if (/^Errore 5\d\d$|HTTP 5\d\d|internal server error|bad gateway|service unavailable/i.test(m)) return 'Il servizio non risponde in questo momento: riprova tra poco.';
    if (/^Errore 4\d\d$|HTTP 4\d\d/i.test(m)) return 'Richiesta non riuscita: ricarica l’app e riprova.';
    if (/\{.*\}|anthropic|api[_ ]?key|workers ai|undefined|null|TypeError|ReferenceError|Cannot read/i.test(m)) return 'Qualcosa non è andato come previsto: riprova tra poco.';
    return m;
  }
  async function api(path, opts = {}) {
    let res;
    try {
      res = await fetch(path, {
        ...opts,
        credentials: 'same-origin',
        headers: opts.body ? { 'content-type': 'application/json' } : {},
      });
    } catch (e) {
      throw new Error(friendlyError(e && e.message ? e.message : 'network'));
    }
    if (res.status === 401) {
      showLogin('');
      throw new Error('401');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(friendlyError(data.error || `Errore ${res.status}`));
    return data;
  }

