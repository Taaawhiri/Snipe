// Il push arriva senza contenuto: scarichiamo l'ultimo alert e mostriamo la notifica.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let a = null;
      try {
        const res = await fetch('/api/latest', { cache: 'no-store' });
        a = await res.json();
      } catch {}
      const money = (c, cur) =>
        new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur || 'EUR' }).format((c || 0) / 100);
      if (a && a.kind === 'system') {
        await self.registration.showNotification(`HoloSnipe: ${a.name}`, { body: a.text, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'snipe-system', data: { url: '/' } });
        return;
      }
      if (a && a.kind === 'group') {
        const lines = a.top.map((t) => `${t.name} ${money(t.cents, t.currency)}${t.discount >= 0.01 ? ` (−${Math.round(t.discount * 100)}%)` : ''}`).join('\n');
        await self.registration.showNotification(`HoloSnipe: ${a.n} nuovi alert`, { body: a.n > a.top.length ? `${lines}\n…e altri ${a.n - a.top.length}` : lines, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'snipe-group', data: { url: '/' }, requireInteraction: true });
        return;
      }
      const title0 = a ? (a.test ? 'HoloSnipe: notifica di prova' : a.refKind === 'stock' ? `Di nuovo disponibile: ${a.name}` : a.refKind === 'drop' ? `Calo −${Math.round(a.discount * 100)}%: ${a.name}` : `−${Math.round(a.discount * 100)}% ${a.name}`) : 'HoloSnipe';
      const title = a && a.reminder && !a.test ? `Promemoria, ancora in vendita: ${a.name}` : title0;
      const ship = a && !a.test ? (a.zero ? ' · Zero' : a.ship ? ` · ${money(a.cents + a.ship.cents, a.currency)} con spedizione` : '') : '';
      const extra = a && !a.test ? [a.condition, a.language && a.language.toUpperCase()].filter(Boolean).join(' · ') : '';
      const body = a && !a.test ? `${money(a.cents, a.currency)}${a.refCents ? ` (${a.refKind === 'drop' ? '7 giorni fa' : 'rif.'} ${money(a.refCents, a.currency)})` : ''}${ship}${a.cmCents && a.refKind !== 'cardmarket' ? ` · Cardmarket ${money(a.cmCents, a.currency)}` : ''}\n${[extra, a.expansion].filter(Boolean).join(' · ')}` : 'Le notifiche funzionano.';
      await self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: a ? a.id : 'snipe',
        image: a && a.cardImage ? a.cardImage : undefined,
        data: { url: a && a.url ? a.url : '/' },
        actions: a && a.url && !a.test ? [{ action: 'open', title: 'Apri su CardTrader' }, { action: 'app', title: 'Apri HoloSnipe' }] : [],
        requireInteraction: true,
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Dalla notifica il link si apre nel browser, fuori dalla webapp. "Apri HoloSnipe" apre l'app.
  const url = event.action === 'app' ? '/' : (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.openWindow(url));
});
