import { BUILD } from './build.js';
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

    // Diagnosi: dice solo quali Secret sono presenti, mai i valori.
    if (url.pathname === '/api/health') {
      const has = (k) => typeof env[k] === 'string' && env[k].trim().length > 0;
      // La versione che sta girando nel server dati: se è diversa dal Worker, l'aggiornamento non è ancora arrivato.
      const data = await stub(env)
        .fetch('https://do.internal/api/_version')
        .then((r) => r.json())
        .catch(() => null);
      return Response.json({
        build: BUILD,
        dataServerBuild: (data && data.build) || 'precedente (non ancora aggiornato)',
        indice: data ? data.indice : null,
        erroreIndice: data ? data.erroreIndice : null,
        erroreScan: data ? data.erroreScan : null,
        limiteRichiesteFinoA: data ? data.limiteRichiesteFinoA : null,
        APP_KEY: has('APP_KEY'),
        CARDTRADER_TOKEN: has('CARDTRADER_TOKEN'),
        VAPID_PUBLIC_KEY: has('VAPID_PUBLIC_KEY'),
        VAPID_PRIVATE_KEY: has('VAPID_PRIVATE_KEY'),
        host: url.host,
      });
    }

    // /api/latest è pubblico: lo legge il service worker per mostrare la notifica.
    if (url.pathname !== '/api/latest') {
      if (!env.APP_KEY) {
        return Response.json({ error: 'APP_KEY non configurata su Cloudflare' }, { status: 500 });
      }
      const given = req.headers.get('x-app-key') || '';
      if (!sameKey(given.trim(), String(env.APP_KEY).trim())) return Response.json({ error: 'Chiave non valida' }, { status: 401 });
    }
    return stub(env).fetch(req);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(stub(env).fetch('https://do.internal/api/_tick', { method: 'POST' }));
  },
};
