import { BUILD } from './build.js';
import { DEFAULT_PLAN, PLANS } from './plans.js';
import { billingChange, checkoutUrl, verifySignature } from './billing.js';
import { recognizeCard } from './recognize.js';
import { askAppraiser, askAppraiserWeb } from './appraisal.js';
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

/**
 * Chi è l'utente: l'ID utente CardTrader (user_id). "id" di /info è invece l'"app" creata insieme al token
 * e "name" il suo nome automatico (es. "Mario App 20260715103609"): li usiamo solo come ripiego.
 */
function identityOf(info) {
  return String(info.user_id != null ? info.user_id : info.id);
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
  cachedOwner = { t, id: identityOf(info) };
  return cachedOwner.id;
}

/** Nome mostrato: quello scelto dall'utente, altrimenti "Utente CardTrader <id>" (mai il nome automatico dell'app). */
function displayName(u) {
  return (u && u.displayName) || `Utente CardTrader ${u ? u.id : ''}`;
}

const json = (d, status = 200, headers = {}) => Response.json(d, { status, headers });

/** Login: il token CardTrader identifica l'utente (GET /info). */
async function login(req, env) {
  const ip = req.headers.get('cf-connecting-ip') || 'locale';
  const gate = await registry(env).fetch('https://reg/attempt', { method: 'POST', body: JSON.stringify({ ip }) }).then((r) => r.json());
  if (!gate.ok) return json({ error: `Troppi tentativi di accesso: riprova tra ${gate.retryIn} minuti.` }, 429);
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  if (token.length < 20) return json({ error: 'Incolla il token API di CardTrader.' }, 400);
  const res = await fetch(`${env.CARDTRADER_API || API}/info`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) return json({ error: 'CardTrader non accetta questo token: controlla di averlo copiato tutto.' }, 401);
  if (!res.ok) return json({ error: 'CardTrader non risponde in questo momento: riprova tra poco.' }, 502);
  const info = await res.json();
  if (!info || info.id == null) return json({ error: 'Risposta inattesa da CardTrader.' }, 502);

  // Proprietario = stesso utente CardTrader del Secret, anche se il token è stato rigenerato o copiato diverso.
  const id = identityOf(info);
  const owner = (await ownerId(env)) === id;
  const user = await registry(env)
    .fetch('https://reg/login', {
      method: 'POST',
      // legacyId: gli account creati prima erano registrati con l'ID dell'app; il registro li sposta sull'ID utente.
      body: JSON.stringify({ userId: id, legacyId: info.user_id != null ? String(info.id) : null, appName: info.name, owner, defaultPlan: DEFAULT_PLAN }),
    })
    .then((r) => r.json());
  if (user.blocked) return json({ error: 'Questo account è stato sospeso.' }, 403);
  // Il token resta solo nel server dati dell'utente: non torna mai al telefono.
  await scanner(env, user.doName).fetch('https://do.internal/api/_account', {
    method: 'POST',
    body: JSON.stringify({ token, userId: user.id, name: displayName(user), plan: user.plan, doName: user.doName }),
  });
  const session = await makeSession(await secret(env), user.id);
  return json({ ok: true, name: displayName(user), plan: user.plan }, 200, { 'set-cookie': sessionCookie(session) });
}

/**
 * Errore del servizio: lo registra e, la prima volta (poi al massimo ogni 6 ore per tipo), lo notifica
 * al proprietario sul telefono. Non deve mai far fallire la richiesta che lo ha scoperto.
 */
export async function reportError(env, where, err, userId = null) {
  try {
    const message = String((err && (err.stack || err.message)) || err).split('\n').slice(0, 3).join(' · ');
    const r = await registry(env).fetch('https://reg/error', { method: 'POST', body: JSON.stringify({ where, message, user: userId }) }).then((x) => x.json());
    if (r.notify) {
      await scanner(env, 'main').fetch('https://do.internal/api/_ownerNotice', { method: 'POST', body: JSON.stringify({ text: `${where}: ${message.slice(0, 160)}` }) });
    }
  } catch {
    // niente: il registro errori non deve mai bloccare il servizio
  }
}

/** Cancellazione dell'account: tutti i dati del server dati, la voce nel registro e la sessione. */
async function deleteAccount(req, env, user) {
  const b = await req.json().catch(() => ({}));
  if (b.confirm !== 'ELIMINA') return json({ error: 'Conferma mancante.' }, 400);
  if (user.doName === 'main') return json({ error: "L'account del proprietario contiene anche il catalogo condiviso e non si può eliminare da qui." }, 400);
  await scanner(env, user.doName).fetch('https://do.internal/api/_wipe', { method: 'POST' });
  await registry(env).fetch('https://reg/remove', { method: 'POST', body: JSON.stringify({ id: user.id }) });
  return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
}

/** Pagina admin: solo per il piano Proprietario. */
async function admin(req, env, url, me) {
  if (me.plan !== 'owner') return json({ error: 'Solo il proprietario può gestire gli utenti.' }, 403);
  if (url.pathname === '/api/admin/users' && req.method === 'GET') {
    const users = await registry(env).fetch('https://reg/users').then((r) => r.json());
    const out = await Promise.all(
      users.map(async (u) => {
        const stats = await scanner(env, u.doName).fetch('https://do.internal/api/_stats').then((r) => r.json()).catch(() => null);
        return { ...u, name: displayName(u), me: u.id === me.id, stats };
      }),
    );
    out.sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
    return json({ users: out, plans: Object.entries(PLANS).map(([id, p]) => ({ id, label: p.label })) });
  }
  if (url.pathname === '/api/admin/errors' && req.method === 'GET') {
    return json(await registry(env).fetch('https://reg/errors').then((r) => r.json()));
  }
  if (url.pathname === '/api/admin/errors/clear' && req.method === 'POST') {
    return json(await registry(env).fetch('https://reg/errors/clear', { method: 'POST' }).then((r) => r.json()));
  }
  if (url.pathname === '/api/admin/user' && req.method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (String(b.id) === me.id) return json({ error: 'Non puoi modificare il tuo account da qui.' }, 400);
    const patch = {};
    if (b.plan !== undefined) {
      if (!PLANS[b.plan]) return json({ error: 'Piano sconosciuto' }, 400);
      patch.plan = b.plan;
    }
    if (b.blocked !== undefined) patch.blocked = !!b.blocked;
    if (b.note !== undefined) patch.note = String(b.note).slice(0, 200);
    const res = await registry(env).fetch('https://reg/update', { method: 'POST', body: JSON.stringify({ id: String(b.id), patch }) });
    const u = await res.json();
    if (!res.ok) return json(u, res.status);
    // Il server dati dell'utente aggiorna subito piano e, se sospeso, ferma lo scan.
    await scanner(env, u.doName).fetch('https://do.internal/api/_admin', { method: 'POST', body: JSON.stringify({ plan: u.plan, blocked: !!u.blocked }) }).catch(() => null);
    return json(u);
  }
  return json({ error: 'Pagina non trovata: ricarica l’app.' }, 404);
}

/** Inoltra al server dati; se si sta riavviando per una versione nuova, riprova una volta. */
async function forward(env, doName, req, headers) {
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer();
  const send = () => scanner(env, doName).fetch(new Request(req.url, { method: req.method, headers, body }));
  let res = await send().catch(() => null);
  for (let i = 0; i < 3 && (!res || res.headers.get('x-stale')); i++) {
    await new Promise((r) => setTimeout(r, 400));
    res = await send().catch(() => null);
  }
  return res || json({ error: 'Server dati non raggiungibile: riprova.' }, 503);
}

/**
 * Parere dell'esperto (Claude). I dati e i limiti li gestisce il server dati; la chiamata all'API la facciamo qui nel Worker:
 * dal server dati, che può trovarsi in un'altra zona, Anthropic rispondeva 403 "Request not allowed".
 */
async function appraise(req, env, user, headers) {
  const url = new URL(req.url);
  const prep = new URL(url);
  prep.searchParams.set('prep', '1');
  const first = await forward(env, user.doName, new Request(prep, { method: 'GET', headers }), headers);
  const out = await first.json().catch(() => null);
  if (!first.ok || !out) return json(out || { error: 'Server dati non raggiungibile: riprova.' }, first.status || 503);
  const todo = out.todo;
  if (!todo) return json(out);
  delete out.todo;
  if (!env.GROQ_API_KEY) { out.note = 'Manca il segreto GROQ_API_KEY tra i Secret del Worker.'; return json(out); }
  const clean = (e) => String((e && e.message) || e).replace(/sk-[A-Za-z0-9_-]+/g, '…').slice(0, 220);
  try {
    let saved;
    if (todo.kind === 'web') {
      const w = await askAppraiserWeb(env, todo.card, out.facts, out.verdict);
      if (!w) { out.note = 'La ricerca sul web non è riuscita: nessuna risposta.'; return json(out); }
      saved = { kind: 'web', text: w.text, sources: w.sources, searched: w.searched };
      out.web = { ...w, ts: Date.now() };
    } else {
      const c = await askAppraiser(env, todo.card, out.facts, out.verdict);
      if (!c) { out.note = 'Il parere dell’esperto non è riuscito: nessuna risposta.'; return json(out); }
      saved = { kind: 'comment', text: c };
      out.comment = c;
      out.commentTs = Date.now();
    }
    const h = new Headers(headers);
    h.set('content-type', 'application/json');
    await scanner(env, user.doName).fetch(new Request(new URL('/api/appraisal/save', url), { method: 'POST', headers: h, body: JSON.stringify({ rule_id: url.searchParams.get('rule_id'), low: todo.low, ...saved }) })).catch(() => null);
  } catch (e) {
    out.note = `${todo.kind === 'web' ? 'La ricerca sul web' : 'Il parere dell’esperto'} non è riuscito: ${clean(e)}`;
  }
  return json(out);
}

/** Scanner: foto della carta -> lettura (nome, numero, lingua) -> carte candidate nell'indice. */
async function scanCard(req, env, user) {
  const b = await req.json().catch(() => ({}));
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(b.image || ''));
  if (!m) return json({ error: 'Foto mancante o in un formato non supportato.' }, 400);
  if (m[2].length > 3_000_000) return json({ error: 'Foto troppo grande.' }, 413);
  const quota = await scanner(env, user.doName).fetch('https://do.internal/api/_scanquota', { method: 'POST' }).then((r) => r.json());
  if (!quota.ok) return json({ error: `Hai usato le ${quota.limit} scansioni del mese incluse nel piano ${quota.plan}.`, upgrade: true }, 403);
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let result;
  try {
    result = await recognizeCard(env, bytes, m[1]);
  } catch (e) {
    await scanner(env, user.doName).fetch('https://do.internal/api/_scanquota', { method: 'POST', body: JSON.stringify({ refund: true }) }).catch(() => null);
    // Gli errori del servizio di riconoscimento sono tecnici (in inglese, con codici): all'utente una frase semplice.
    const own = /riconoscimento delle foto/i.test(String(e.message || ''));
    return json({ error: own ? String(e.message) : 'Il riconoscimento non ha risposto: riprova tra poco, magari con più luce.' }, 502);
  }
  const scan = result.scan;
  if (!scan || (!scan.name && !scan.number)) return json({ scan, engine: result.engine, candidates: [], used: quota.used, limit: quota.limit });
  const found = await scanner(env, 'main').fetch('https://do.internal/api/_identify', { method: 'POST', body: JSON.stringify(scan) }).then((r) => r.json());
  return json({ scan, engine: result.engine, exact: found.exact !== false, candidates: found.candidates || [], used: quota.used, limit: quota.limit });
}

/** Lemon Squeezy: eventi di abbonamento -> piano dell'utente. */
async function billingWebhook(req, env) {
  const raw = await req.text();
  if (!(await verifySignature(env.LS_WEBHOOK_SECRET, raw, req.headers.get('x-signature')))) return json({ error: 'firma non valida' }, 401);
  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'json' }, 400); }
  const ch = billingChange(env, payload);
  if (!ch) return json({ ok: true, ignored: true });
  const user = await registry(env).fetch(`https://reg/user?id=${encodeURIComponent(ch.userId)}`).then((r) => (r.ok ? r.json() : null));
  if (!user) return json({ ok: true, ignored: 'utente sconosciuto' });
  if (user.plan === 'owner') return json({ ok: true, ignored: 'owner' });
  await registry(env).fetch('https://reg/update', { method: 'POST', body: JSON.stringify({ id: user.id, patch: { plan: ch.plan, billing: ch.billing } }) });
  await scanner(env, user.doName).fetch('https://do.internal/api/_admin', { method: 'POST', body: JSON.stringify({ plan: ch.plan, blocked: false }) }).catch(() => null);
  return json({ ok: true, plan: ch.plan });
}

export default {
  async fetch(req, env, ctx) {
    try {
      const res = await handle(req, env);
      // Errore inatteso del server dati (500): lo segnaliamo al proprietario.
      if (res.status === 500) ctx.waitUntil(reportError(env, `API ${new URL(req.url).pathname}`, await res.clone().text()));
      return res;
    } catch (e) {
      ctx.waitUntil(reportError(env, `Worker ${new URL(req.url).pathname}`, e));
      return json({ error: 'Errore inatteso: è stato segnalato, riprova tra poco.' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    return scheduled(event, env, ctx);
  },
};

async function handle(req, env) {
  {
    const url = new URL(req.url);
    // I file statici li serve Cloudflare direttamente: qui arrivano solo le API.
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });

    if (url.pathname === '/api/health') {
      return json({ build: BUILD, host: url.host });
    }
    if (url.pathname === '/api/login' && req.method === 'POST') return login(req, env);
    if (url.pathname === '/api/logout' && req.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': clearCookie() });

    if (url.pathname === '/api/billing/webhook' && req.method === 'POST') return billingWebhook(req, env);

    // Le rotte con "_" sono interne (tra Worker e server dati).
    if (url.pathname.startsWith('/api/_')) return json({ error: 'Pagina non trovata: ricarica l’app.' }, 404);

    const userId = await readSession(await secret(env), getCookie(req, COOKIE));
    if (!userId) return json({ error: 'Accesso richiesto' }, 401);
    const user = await registry(env).fetch(`https://reg/user?id=${userId}`).then((r) => (r.ok ? r.json() : null));
    if (!user) return json({ error: 'Accesso richiesto' }, 401, { 'set-cookie': clearCookie() });
    if (user.blocked) return json({ error: 'Questo account è stato sospeso.' }, 401, { 'set-cookie': clearCookie() });

    if (url.pathname.startsWith('/api/admin/')) return admin(req, env, url, user);
    if (url.pathname === '/api/scan' && req.method === 'POST') return scanCard(req, env, user);
    if (url.pathname === '/api/account/delete' && req.method === 'POST') return deleteAccount(req, env, user);
    if (url.pathname === '/api/billing/links') {
      const link = (v) => checkoutUrl(v, user.id);
      return json({
        pro: { monthly: link(env.LS_CHECKOUT_PRO_MONTHLY), yearly: link(env.LS_CHECKOUT_PRO_YEARLY) },
        sniper: { monthly: link(env.LS_CHECKOUT_SNIPER_MONTHLY), yearly: link(env.LS_CHECKOUT_SNIPER_YEARLY) },
        billing: user.billing || null,
      });
    }
    if (url.pathname === '/api/profile' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const name = String(b.displayName || '').trim().slice(0, 40);
      const u = await registry(env).fetch('https://reg/update', { method: 'POST', body: JSON.stringify({ id: user.id, patch: { displayName: name } }) }).then((r) => r.json());
      return json({ ok: true, name: displayName(u) });
    }

    // Il server dati riceve chi è l'utente e il suo piano; le intestazioni del client con lo stesso nome vengono sostituite.
    const headers = new Headers(req.headers);
    headers.set('x-user', user.id);
    headers.set('x-plan', user.plan);
    headers.set('x-do', user.doName);
    headers.set('x-build', BUILD);
    headers.set('x-user-name', encodeURIComponent(displayName(user)));
    if (url.pathname === '/api/appraisal' && req.method === 'GET' && (url.searchParams.get('comment') || url.searchParams.get('web'))) return appraise(req, env, user, headers);
    // Ricerca per nome e rinnovo dell'indice usano il catalogo condiviso (server dati 'main').
    if (url.pathname === '/api/search') return forward(env, 'main', req, headers);
    if (url.pathname === '/api/deals') return forward(env, 'main', req, headers);
    if (url.pathname === '/api/collection/match') return forward(env, 'main', req, headers);
    if (url.pathname.startsWith('/api/regions/')) {
      if (user.plan !== 'owner') return json({ error: 'Solo il proprietario può modificare le regioni.' }, 403);
      return forward(env, 'main', req, headers);
    }
    if (url.pathname === '/api/ratios' && user.plan !== 'owner') return json({ error: 'Solo per il proprietario.' }, 403);
    if (url.pathname === '/api/index/refresh') {
      if (user.plan !== 'owner') return json({ error: 'Solo il proprietario può rinnovare l’indice.' }, 403);
      return forward(env, 'main', req, headers);
    }
    return forward(env, user.doName, req, headers);
  }
}

async function scheduled(_event, env, ctx) {
    // Ogni minuto rimette in moto lo scan di ogni utente, se per qualsiasi motivo si fosse fermato.
    ctx.waitUntil(
      (async () => {
        const users = await registry(env).fetch('https://reg/users').then((r) => r.json()).catch(() => []);
        const list = users.length ? users : [{ doName: 'main', plan: '' }];
        // Con il tick arriva anche il piano aggiornato, così gli scan in background lo rispettano.
        await Promise.all(list.map((u) => scanner(env, u.doName).fetch('https://do.internal/api/_tick', { method: 'POST', body: JSON.stringify({ plan: u.blocked ? '' : u.plan, blocked: !!u.blocked, doName: u.doName }) }).catch(() => null)));
      })(),
    );
  }
