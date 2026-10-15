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
        new Intl.NumberFormat('it-IT', { style: 'currency', currency: cur || 'EUR' }).format((c || 0) / 100);
      const title = a ? (a.test ? 'Snipe: notifica di prova' : `−${Math.round(a.discount * 100)}% ${a.name}`) : 'Snipe';
      const body = a && !a.test ? `${money(a.cents, a.currency)} (rif. ${money(a.refCents, a.currency)}) · ${a.expansion || ''}` : 'Le notifiche funzionano.';
      await self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: a ? a.id : 'snipe',
        data: { url: a && a.url ? a.url : '/' },
        requireInteraction: true,
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.openWindow(url));
});
