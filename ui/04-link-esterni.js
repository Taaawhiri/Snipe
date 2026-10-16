  // ---------- link esterni ----------
  // Su telefono, toccando un link a CardTrader o Cardmarket si apre il menu "Apri con un'altra app" del sistema:
  // da lì si sceglie il browser, e la pagina si apre fuori dalla webapp. Su computer il link si apre normalmente.
  const isMobileOS = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest && ev.target.closest('a[target="_blank"]');
    if (!a || a.dataset.direct || !isMobileOS || !navigator.share) return;
    let u;
    try { u = new URL(a.href); } catch { return; }
    if (u.origin === location.origin || !/^https?:$/.test(u.protocol)) return;
    ev.preventDefault();
    const title = (a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) || 'Snipe';
    navigator.share({ title, url: u.href }).catch(() => { /* menu chiuso senza scegliere */ });
  });

