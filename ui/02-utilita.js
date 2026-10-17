  // ---------- utilità ----------
  const plainText = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  /** Numeri grandi in poco spazio: 8.086 · 12,3 mila · 1,2 Mln. */
  const compactNum = (n) => (n < 10_000 ? n.toLocaleString('it-IT') : n < 1_000_000 ? `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace('.', ',').replace(',0', '')} mila` : `${(n / 1e6).toFixed(1).replace('.', ',').replace(',0', '')} Mln`);
  function el(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) if (c) n.append(c);
    return n;
  }
  const cardUrl = (blueprintId) => `https://www.cardtrader.com/cards/${blueprintId}`;
  const cmSearchUrl = (c) => `https://www.cardmarket.com/en/Pokemon/Products/Search?searchString=${encodeURIComponent([c.name, c.number].filter(Boolean).join(' '))}`;
  const chip = (text, cls = '') => el('span', { class: ('chip ' + cls).trim(), text });
  const thumb = (src) => (src ? el('img', { class: 'thumbimg', src, alt: '', loading: 'lazy' }) : el('div', { class: 'thumbimg ph', 'aria-hidden': 'true' }));
  const money = (c, cur) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: cur || 'EUR' }).format((c || 0) / 100);
  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s fa`;
    if (s < 3600) return `${Math.floor(s / 60)}m fa`;
    if (s < 86400) return `${Math.floor(s / 3600)}h fa`;
    return `${Math.floor(s / 86400)}g fa`;
  }
  function soundOn() { try { return localStorage.getItem('snipe.sound') !== '0'; } catch { return true; } }
  function beep() {
    if (!soundOn()) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.08;
      o.start(); o.stop(ctx.currentTime + 0.18);
    } catch {}
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  }

