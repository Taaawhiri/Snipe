export { Scanner } from './scanner.js';

function stub(env) {
  return env.SCANNER.get(env.SCANNER.idFromName('main'));
}

function sameKey(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // I file statici li serve Cloudflare direttamente: qui arrivano solo le API.
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    // /api/latest è pubblico: lo legge il service worker per mostrare la notifica.
    if (url.pathname !== '/api/latest') {
      if (!env.APP_KEY) {
        return Response.json({ error: 'APP_KEY non configurata su Cloudflare' }, { status: 500 });
      }
      const given = req.headers.get('x-app-key') || '';
      if (!sameKey(given, env.APP_KEY)) return Response.json({ error: 'Chiave non valida' }, { status: 401 });
    }
    return stub(env).fetch(req);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(stub(env).fetch('https://do.internal/api/_tick', { method: 'POST' }));
  },
};
