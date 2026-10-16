  // ---------- notifiche ----------
  function urlB64ToUint8(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  }
  let pushSynced = false;
  // Ogni dispositivo ricorda la propria iscrizione: quando cambia, il server sostituisce quella vecchia invece di aggiungerne un'altra.
  function subscribeOnServer(endpoint, only = false) {
    let replaces = null;
    try { replaces = localStorage.getItem('snipe.pushEndpoint'); } catch {}
    return api('/api/subscribe', { method: 'POST', body: JSON.stringify({ endpoint, replaces, only }) }).then((r) => {
      try { localStorage.setItem('snipe.pushEndpoint', endpoint); } catch {}
      return r;
    });
  }
  let resubscribing = false;

  async function updatePushUI() {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const badge = $('pushBadge');
    const setBadge = (cls, text) => { badge.className = 'state ' + cls; badge.textContent = text; };
    document.querySelectorAll('[data-ios]').forEach((li) => (li.hidden = !ios));

    if (!supported || (ios && !standalone)) {
      setBadge('off', 'Non disponibili');
      $('pushInfo').textContent = ios && !standalone
        ? 'Su iPhone le notifiche funzionano solo dall’app installata: aggiungila alla Home e aprila da lì.'
        : 'Questo browser non supporta le notifiche push.';
      $('pushEnable').disabled = true;
      $('pushTest').disabled = true;
      return;
    }
    if (Notification.permission === 'denied') {
      setBadge('off', 'Bloccate');
      $('pushInfo').textContent = 'Le notifiche sono bloccate per questo sito: riabilitale dalle impostazioni del browser.';
      $('pushEnable').disabled = true;
      $('pushTest').disabled = true;
      return;
    }
    let sub = null;
    try {
      const reg = await navigator.serviceWorker.ready;
      sub = await reg.pushManager.getSubscription();
    } catch {}
    // Il telefono a volte cancella l'iscrizione (risparmio energetico, permessi revocati per inattività):
    // se il permesso c'è ancora ma l'iscrizione no, la rifacciamo da soli senza chiedere nulla.
    if (!sub && Notification.permission === 'granted' && state && state.vapidPublic && !resubscribing) {
      resubscribing = true;
      try {
        const reg = await navigator.serviceWorker.ready;
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(state.vapidPublic) });
        await subscribeOnServer(sub.endpoint);
        pushSynced = true;
      } catch {} finally { resubscribing = false; }
    }
    if (sub && Notification.permission === 'granted') {
      if (!pushSynced) {
        pushSynced = true;
        subscribeOnServer(sub.endpoint).catch(() => {});
      }
      setBadge('on', 'Attive');
      $('pushInfo').textContent = 'Questo dispositivo riceve una notifica quando un annuncio rispetta uno dei tuoi alert.';
      $('pushEnable').textContent = 'Notifiche attive';
      $('pushEnable').disabled = true;
      $('pushTest').disabled = false;
    } else {
      setBadge('', 'Non attive');
      $('pushInfo').textContent = 'Attivale per ricevere un avviso anche con l’app chiusa.';
      $('pushEnable').textContent = 'Attiva notifiche';
      $('pushEnable').disabled = !state || !state.vapidPublic;
      $('pushTest').disabled = true;
    }
  }

  $('pushEnable').addEventListener('click', async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { await updatePushUI(); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(state.vapidPublic) });
      await subscribeOnServer(sub.endpoint);
      pushSynced = true;
      await refresh();
    } catch (e) {
      $('pushInfo').textContent = `Impossibile attivare le notifiche: ${e.message}`;
    }
  });
  $('pushOnly').addEventListener('click', async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { $('pushInfo').textContent = 'Attiva prima le notifiche su questo dispositivo.'; return; }
      await subscribeOnServer(sub.endpoint, true);
      await refresh();
      $('pushInfo').textContent = 'Ora le notifiche arrivano solo a questo dispositivo.';
    } catch (e) { $('pushInfo').textContent = e.message; }
  });
  $('pushTest').addEventListener('click', async () => {
    try {
      const r = await api('/api/test-push', { method: 'POST' });
      $('pushInfo').textContent = r.sent ? 'Notifica di prova inviata: dovrebbe arrivare entro pochi secondi.' : 'Non è stato possibile inviarla: riattiva le notifiche su questo dispositivo.';
      await refresh();
    } catch (e) { $('pushInfo').textContent = e.message; }
  });
  $('clearAlerts').addEventListener('click', async () => { await api('/api/alerts', { method: 'DELETE' }); knownTop = null; refresh(); });

