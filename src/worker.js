import { BUILD } from './build.js';
import { DEFAULT_PLAN } from './plans.js';
import { COOKIE, clearCookie, getCookie, makeSession, readSession, sessionCookie } from './session.js';
export { Scanner } from './scanner.js';
export { Registry } from './registry.js';

const API = 'https://api.cardtrader.com/api/v2';

function registry(env) {
  return env.REGISTRY.get(env.REGISTRY.idFromName('registry'));
}

function scanner(env, doName) {
  return env.SCANNER.get(env.SCANNER.idFromName(doName));
}

let cachedSecret = null;
async function secret(env) {
  if (!cachedSecret) cachedSecret = (await registry(env).fetch('https://reg/secret').then((r) => r.json())).secret;
  return cachedSecret;
}

let cachedOwner = null;
async function ownerId(env) {
  const t = String(env.CARDTRADER_TOKEN || '').trim();
  if (!t) return null;
  if (cachedOwner && cachedOwner.t === t) return cachedOwner.id;
  const res = await fetch(`${env.CARDTRADER_API || API}/info`, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } }).catch(() => null);
  if (!res || !res.ok) return null;
  const info = await res.json().catch(() => null);
  if (!info || info.id == null) return null;
  cachedOwner = { t, id: String(info.id) };
  return cachedOwner.id;
}

const json = (d, status = 200, headers = {}) => Response.json(d, { status, headers });

/** Login: il token CardTrader identifica l'utente (GET /info). */
async function login(req, env) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  if (token.length < 20) return json({ error: 'Incolla il token API di CardTrader.' }, 400);
  const res = await fetch(`${env.CARDTRADER_API || API}/info`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) return json({ error: 'CardTrader non accetta questo token: controlla di averlo copiato tutto.' }, 401);
  if (!res.ok) return json({ error: `CardTrader non risponde (HTTP ${res.status}): riprova tra poco.` }, 502);
  const info = await res.json();
  if (!info || info.id == null) return json({ error: 'Risposta inattesa da CardTrader.' }, 502);

  // Proprietario = stesso utente CardTrader del Secret, anche se il token è stato rigenerato o copiato diverso.
  const owner = (await ownerId(env)) === String(info.id);
  const user = await registry(env)
    .fetch('https://reg/login', { method: 'POST', body: JSON.stringify({ userId: info.id, name: info.name, owner, defaultPlan: DEFAULT_PLAN }) })
    .then((r) => r.json());
  // Il token resta solo nel server dati dell'utente: non torna mai al telefono.
  await scanner(env, user.doName).fetch('https://do.internal/api/_account', {
    method: 'POST',
    body: JSON.stringify({ token, userId: user.id, name: user.name, plan: user.plan }),
  });
  const session = await makeSession(await secret(env), user.id);
  return json({ ok: true, name: user.name, plan: user.plan }, 200, { 'set-cookie': sessionCookie(session) });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // I file statici li serve Cloudflare direttamente: qui arrivano solo le API.
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    if (url.pathname === '/api/health') {
      return json({ build: BUILD, host: url.host });
    }
    if (url.pathname === '/api/login' && req.method === 'POST') return login(req, env);
    if (url.pathname === '/api/logout' && req.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': clearCookie() });

    // Le rotte con "_" sono interne (tra Worker e server dati).
    if (url.pathname.startsWith('/api/_')) return json({ error: 'not found' }, 404);

    const userId = await readSession(await secret(env), getCookie(req, COOKIE));
    if (!userId) return json({ error: 'Accesso richiesto' }, 401);
    const user = await registry(env).fetch(`https://reg/user?id=${userId}`).then((r) => (r.ok ? r.json() : null));
    if (!user) return json({ error: 'Accesso richiesto' }, 401, { 'set-cookie': clearCookie() });

    // Il server dati riceve chi è l'utente e il suo piano; le intestazioni del client con lo stesso nome vengono sostituite.
    const headers = new Headers(req.headers);
    headers.set('x-user', user.id);
    headers.set('x-plan', user.plan);
    headers.set('x-user-name', encodeURIComponent(user.name || ''));
    return scanner(env, user.doName).fetch(new Request(req, { headers }));
  },

  async scheduled(_event, env, ctx) {
    // Ogni minuto rimette in moto lo scan di ogni utente, se per qualsiasi motivo si fosse fermato.
    ctx.waitUntil(
      (async () => {
        const users = await registry(env).fetch('https://reg/users').then((r) => r.json()).catch(() => []);
        const names = new Set(users.map((u) => u.doName));
        if (!names.size) names.add('main');
        await Promise.all([...names].map((n) => scanner(env, n).fetch('https://do.internal/api/_tick', { method: 'POST' }).catch(() => null)));
      })(),
    );
  },
};
