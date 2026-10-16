// public/app.js è generato: le parti si modificano in ui/ e si ricompongono con "npm run build".
(() => {
  const $ = (id) => document.getElementById(id);
  // L'accesso è un cookie di sessione (HttpOnly): il token CardTrader resta sul server.
  try { localStorage.removeItem('snipe.key'); } catch {}

  let state = null;
  let expansions = [];
  let knownTop = null;
  let timer = null;

