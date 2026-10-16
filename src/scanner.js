import { DurableObject } from 'cloudflare:workers';
import { CONDITIONS, condRank, findDeals, isListable, isSingleCard, isZero, listingLang, normLang, rejectReasons } from './deals.js';
import { BUILD } from './build.js';
import { CM_PRICE_URL, cmEntry, maxCentsBelow, parsePriceGuide, shardOf, toShards } from './cardmarket.js';
import { DEFAULT_SETTINGS, cleanSettings, isQuiet } from './settings.js';
import { generateVapidKeys, sendPush } from './push.js';
import { matchesTerms, normText, packImg, queryTerms, relevance, unpackImg } from './search.js';

const API = 'https://api.cardtrader.com/api/v2';
const SCAN_EVERY_MS = 10_000; // CardTrader mette in cache leggermente le risposte: sotto i 10s non serve
// Limiti CardTrader: 200 richieste/10s in totale, ma sul marketplace la documentazione cita anche
// 1 richiesta al secondo. Restiamo prudenti: tutte le chiamate passano da un unico limitatore.
const MARKETPLACE_GAP_MS = 1200;
const OTHER_GAP_MS = 400;
const MIN_BACKOFF_MS = 30_000;
const MARKET_PER_SCAN = 2;
const MKT_BUCKET = 6; // gettoni massimi: permette brevi raffiche (aprire qualche espansione di fila)
const MKT_RESERVE = 3; // gettoni che lo scan lascia sempre all'utente
const MKT_GAP_START = 3000; // un gettone ogni 3 s = 20 letture al minuto
const MKT_GAP_MIN = 2000;
const MKT_GAP_MAX = 15_000; // letture dal marketplace per giro di scan, qualunque sia il numero di alert
const MAX_RULES = 30;
const MAX_ALERTS = 200;
const MAX_SEEN = 20_000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const imageUrl = (u) => (!u ? null : /^(https?|data):/.test(u) ? u : `https://www.cardtrader.com${u.startsWith('/') ? '' : '/'}${u}`);
const byPrice = (a, b) => a.price.cents - b.price.cents;
const fixedProp = (fp, re) => {
  const k = Object.keys(fp || {}).find((x) => re.test(x));
  return k && fp[k] !== null && fp[k] !== undefined && fp[k] !== '' ? String(fp[k]) : null;
};
const prop = (list, re) => {
  for (const p of list) {
    const h = p.properties_hash || {};
    const k = Object.keys(h).find((x) => re.test(x));
    if (k && h[k] !== null && h[k] !== undefined && h[k] !== '') return String(h[k]);
  }
  return null;
};


export class Scanner extends DurableObject {
  cardCache = new Map();
  productCache = new Map(); // espansione -> { ts, data }: annunci letti da CardTrader, condivisi da scan e pagine
  bpCache = new Map(); // carta -> { ts, data }: tutti gli annunci di una carta (la lettura per espansione ne dà solo i più economici)
  cmCache = new Map();
  cmFailedAt = 0;
  queue = Promise.resolve();
  lastCall = 0;
  blockedUntil = 0;
  // Secchiello per il marketplace: ogni lettura consuma un gettone, che si ricarica ogni mktGap ms.
  // Dopo un 429 la ricarica rallenta, dopo molte risposte buone accelera di nuovo (mai sotto MKT_GAP_MIN).
  tokens = MKT_BUCKET;
  tokensAt = Date.now();
  mktGap = MKT_GAP_START;
  okStreak = 0;
  recent429 = [];

  async settings() {
    return { ...DEFAULT_SETTINGS, ...(await this.get('settings', {})) };
  }

  async get(key, fallback) {
    const v = await this.ctx.storage.get(key);
    return v === undefined ? fallback : v;
  }

  /** Mette in fila le chiamate a CardTrader e rispetta la pausa dopo un 429. */
  refill() {
    const now = Date.now();
    const add = (now - this.tokensAt) / this.mktGap;
    if (add > 0) {
      this.tokens = Math.min(MKT_BUCKET, this.tokens + add);
      this.tokensAt = now;
    }
  }

  /**
   * Prende un gettone del marketplace. Le richieste in background (lo scan) non aspettano e
   * lasciano sempre MKT_RESERVE gettoni a quelle aperte dall'utente, che invece attendono il loro turno.
   */
  async takeToken(background) {
    if (!this.gapLoaded) {
      this.gapLoaded = true;
      this.mktGap = await this.get('mktGap', MKT_GAP_START);
    }
    for (;;) {
      this.refill();
      const floor = background ? MKT_RESERVE + 1 : 1;
      if (this.tokens >= floor) {
        this.tokens -= 1;
        return;
      }
      if (background) {
        const err = new Error('budget di richieste esaurito per questo giro');
        err.budget = true;
        throw err;
      }
      await sleep(Math.ceil((1 - this.tokens) * this.mktGap) + 20);
    }
  }

  async throttle(path, background = false) {
    const prev = this.queue;
    let release;
    this.queue = new Promise((r) => (release = r));
    await prev;
    try {
      const now = Date.now();
      if (this.blockedUntil > now) {
        const err = new Error(`CardTrader sta limitando le richieste: riprovo tra ${Math.ceil((this.blockedUntil - now) / 1000)}s`);
        err.rateLimited = true;
        throw err;
      }
      if (path.startsWith('/marketplace')) await this.takeToken(background);
      const gap = path.startsWith('/marketplace') ? MARKETPLACE_GAP_MS : OTHER_GAP_MS;
      const wait = this.lastCall + gap - now;
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
    } finally {
      release();
    }
  }

  async systemInfo(status) {
    const m = await this.get('ixmeta', null);
    return {
      build: BUILD,
      index: m ? { done: m.done.length, total: m.total || null, complete: !!m.complete, withCards: m.have.length } : null,
      indexError: (status && status.indexError) || null,
      cm: await this.get('cmmeta', null),
      cmError: (status && status.cmError) || null,
      limitUntil: this.blockedUntil > Date.now() ? this.blockedUntil : null,
      market: { gapMs: this.mktGap, tokens: Math.floor(this.tokens), recent429: this.recent429 },
    };
  }

  /** Chiavi per le notifiche push: se non impostate a mano come Secret, le genera il server una volta sola. */
  async vapid() {
    const env = this.env;
    let keys = null;
    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      keys = { publicKey: String(env.VAPID_PUBLIC_KEY).trim(), privateKey: String(env.VAPID_PRIVATE_KEY).trim() };
    } else {
      keys = await this.get('vapid', null);
      if (!keys) {
        keys = await generateVapidKeys();
        await this.ctx.storage.put('vapid', keys);
      }
    }
    const configured = env.VAPID_SUBJECT && !/CHANGE_ME/.test(env.VAPID_SUBJECT) ? env.VAPID_SUBJECT : null;
    const origin = await this.get('origin', null);
    return { ...keys, subject: configured || origin || 'https://workers.dev' };
  }

  async ct(path, background = false) {
    await this.throttle(path, background);
    const res = await fetch((this.env.CARDTRADER_API || API) + path, {
      headers: { Authorization: `Bearer ${this.env.CARDTRADER_TOKEN}`, Accept: 'application/json' },
    });
    if (res.status === 429) {
      const retry = parseInt(res.headers.get('retry-after'), 10);
      // 429 di fila: la pausa raddoppia (30s, 1, 2, 4 min, poi massimo 5) finché CardTrader non risponde di nuovo.
      this.strikes = (this.strikes || 0) + 1;
      if (path.startsWith('/marketplace')) {
        this.mktGap = Math.min(MKT_GAP_MAX, Math.round(this.mktGap * 1.5));
        this.okStreak = 0;
        this.tokens = 0;
        this.recent429 = [...this.recent429, { ts: Date.now(), path: path.split('&')[0] }].slice(-10);
        await this.ctx.storage.put('mktGap', this.mktGap);
      }
      const backoff = Math.min(MIN_BACKOFF_MS * 2 ** (this.strikes - 1), 5 * 60_000);
      const pause = Math.max(backoff, Number.isFinite(retry) ? retry * 1000 : 0);
      this.blockedUntil = Date.now() + pause;
      const err = new Error(`CardTrader ha risposto 429 (troppe richieste): pausa di ${Math.round(pause / 1000)}s`);
      err.rateLimited = true;
      throw err;
    }
    this.strikes = 0;
    if (path.startsWith('/marketplace') && ++this.okStreak >= 40 && this.mktGap > MKT_GAP_MIN) {
      this.mktGap = Math.max(MKT_GAP_MIN, this.mktGap - 500);
      this.okStreak = 0;
      await this.ctx.storage.put('mktGap', this.mktGap);
    }
    if (!res.ok) throw new Error(`CardTrader ${path.split('?')[0]} → HTTP ${res.status}`);
    return res.json();
  }

  // ---------- HTTP ----------

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (path === '/api/latest' && method === 'GET') {
      const alerts = await this.get('alerts', []);
      return json(alerts[0] || null);
    }

    if (path === '/api/_version') {
      const m = await this.get('ixmeta', null);
      const st = await this.get('status', {});
      return json({
        build: BUILD,
        indice: m
          ? { fatte: m.done.length, totale: m.total || null, completo: !!m.complete, conCarte: m.have.length, errori: Object.keys(m.errors || {}).length }
          : 'non ancora avviato',
        erroreIndice: st.indexError || null,
        erroreScan: st.lastError || null,
        limiteRichiesteFinoA: this.blockedUntil > Date.now() ? new Date(this.blockedUntil).toISOString() : null,
      });
    }

    if (path === '/api/_tick' && method === 'POST') {
      await this.ensureAlarm();
      return json({ ok: true });
    }

    if (path === '/api/state' && method === 'GET') {
      const [rules, alerts, status, subs] = await Promise.all([
        this.get('rules', []),
        this.get('alerts', []),
        this.get('status', {}),
        this.get('subs', []),
      ]);
      return json({
        rules,
        alerts: alerts.slice(0, 60),
        status,
        pushDevices: subs.length,
        settings: await this.settings(),
        system: await this.systemInfo(status),
        vapidPublic: (await this.vapid()).publicKey,
        conditions: CONDITIONS,
      });
    }

    if (path === '/api/expansions' && method === 'GET') {
      try {
        return json(await this.pokemonExpansions());
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }

    if (path === '/api/cards' && method === 'GET') {
      const id = parseInt(url.searchParams.get('expansion_id'), 10);
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'expansion_id mancante' }, 400);
      try {
        return json(await this.cardsFor(id));
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }

    if (path === '/api/settings' && method === 'POST') {
      const next = cleanSettings(await req.json(), await this.settings());
      await this.ctx.storage.put('settings', next);
      if (!next.paused) await this.ensureAlarm();
      return json(next);
    }

    if (path === '/api/export' && method === 'GET') {
      return json({ app: 'snipe', version: 1, exportedAt: new Date().toISOString(), rules: await this.get('rules', []), settings: await this.settings() });
    }

    if (path === '/api/import' && method === 'POST') {
      const body = await req.json();
      const incoming = Array.isArray(body && body.rules) ? body.rules : [];
      const rules = await this.get('rules', []);
      let added = 0;
      for (const raw of incoming) {
        if (rules.length >= MAX_RULES) break;
        const rule = this.cleanRule({ ...raw, id: undefined }); // nuovo id: non sovrascrive quelli esistenti
        if (!rule) continue;
        rules.push(rule);
        added++;
      }
      await this.ctx.storage.put('rules', rules);
      if (added) await this.ensureAlarm();
      return json({ added, skipped: incoming.length - added });
    }

    if (path === '/api/index/refresh' && method === 'POST') {
      const meta = (await this.get('ixmeta', null)) || { have: [] };
      await this.ctx.storage.put('ixmeta', { ...meta, done: [], complete: false, errors: {} });
      await this.ensureAlarm();
      return json({ ok: true });
    }

    if (path === '/api/search' && method === 'GET') {
      const terms = queryTerms(url.searchParams.get('q') || '');
      if (terms.join('').length < 3) return json({ error: 'Scrivi almeno 3 lettere' }, 400);
      try {
        await this.startIndexIfNeeded();
        return json(await this.searchIndex(terms));
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }

    if (path === '/api/explain' && method === 'GET') {
      let rule = (await this.get('rules', [])).find((r) => r.id === url.searchParams.get('rule_id'));
      if (!rule) return json({ error: 'Regola non trovata' }, 404);
      try {
        let cmTrend = null;
        if (rule.cmDiscount && rule.cmId) {
          const e = (await this.cmLookup([rule.cmId])).get(rule.cmId);
          if (!e) return json({ rows: [], total: 0, note: 'Per questa carta non c’è un prezzo Cardmarket: l’alert non può scattare.' });
          cmTrend = e.trend;
          rule = { ...rule, maxPriceCents: maxCentsBelow(e.trend, rule.cmDiscount) };
        }
        const data = rule.blueprintId ? await this.productsForCard(rule.blueprintId, 60_000) : await this.productsFor(rule.expansionId, 60_000);
        const all = rule.blueprintId ? data[rule.blueprintId] || data[String(rule.blueprintId)] || [] : Object.values(data).flat();
        const rows = all
          .filter((p) => p && p.price)
          .sort((a, b) => a.price.cents - b.price.cents)
          .slice(0, 15)
          .map((p) => {
            const reasons = rejectReasons(p, rule);
            if (!reasons.length && rule.maxPriceCents && p.price.cents > rule.maxPriceCents) reasons.push('sopra il prezzo impostato');
            return {
              cents: p.price.cents,
              currency: p.price.currency || 'EUR',
              condition: (p.properties_hash && p.properties_hash.condition) || null,
              language: listingLang(p),
              zero: isZero(p),
              seller: p.user && p.user.username,
              reasons,
            };
          });
        return json({ rows, total: all.length, cmTrend });
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }

    if (path === '/api/debug' && method === 'GET') {
      // Diagnosi: riassume cosa risponde CardTrader, senza dati personali.
      const out = { steps: [] };
      try {
        let id = parseInt(url.searchParams.get('expansion_id'), 10);
        const exps = await this.pokemonExpansions();
        out.expansionsCount = exps.length;
        if (!Number.isInteger(id)) id = (exps.find((e) => /151/.test(e.name)) || exps[0] || {}).id;
        out.expansionId = id;
        out.expansionName = (exps.find((e) => e.id === id) || {}).name;

        const bp = await this.ct(`/blueprints/export?expansion_id=${id}`);
        out.blueprints = {
          type: Array.isArray(bp) ? 'array' : typeof bp,
          count: Array.isArray(bp) ? bp.length : null,
          keys: Array.isArray(bp) ? undefined : Object.keys(bp || {}).slice(0, 10),
          first: Array.isArray(bp) ? bp[0] : undefined,
        };

        const pr = await this.ct(`/marketplace/products?expansion_id=${id}`);
        const keys = Object.keys(pr || {});
        // Quali proprietà e quali valori di lingua hanno gli annunci: serve a capire dove sta la lingua.
        const propKeys = {};
        const langValues = {};
        for (const list of Object.values(pr || {})) {
          for (const p of Array.isArray(list) ? list : []) {
            const h = p.properties_hash || {};
            for (const [key, val] of Object.entries(h)) {
              propKeys[key] = (propKeys[key] || 0) + 1;
              if (/lang/i.test(key)) {
                langValues[`${key}=${val}`] = (langValues[`${key}=${val}`] || 0) + 1;
              }
            }
          }
        }
        out.propertyKeys = propKeys;
        out.languageValues = langValues;
        out.products = {
          type: Array.isArray(pr) ? 'array' : typeof pr,
          blueprintKeys: keys.length,
          firstKeys: keys.slice(0, 5),
          sample: keys.length ? (pr[keys[0]] || [])[0] : undefined,
        };
        if (out.products.sample && out.products.sample.user) {
          out.products.sample = { ...out.products.sample, user: { ...out.products.sample.user, username: '(nascosto)' } };
        }
        try {
          const gameId = await this.get('gameId', null);
          const cats = await this.ct(`/categories${gameId ? `?game_id=${gameId}` : ''}`);
          out.categories = (Array.isArray(cats) ? cats : []).map((c) => ({ id: c.id, name: c.name, game_id: c.game_id }));
        } catch (e) {
          out.categories = `non disponibili: ${String(e.message || e)}`;
        }
        out.singleCategoryIds = await this.singleCategoryIds();
        out.ok = true;
      } catch (e) {
        out.ok = false;
        out.error = String(e.message || e);
      }
      return json(out);
    }

    if (path === '/api/listings' && method === 'GET') {
      const id = parseInt(url.searchParams.get('blueprint_id'), 10);
      const expId = parseInt(url.searchParams.get('expansion_id'), 10);
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'blueprint_id mancante' }, 400);
      try {
        // Aprire una carta legge tutti i suoi annunci (una richiesta), se non sono già freschi.
        let data;
        try {
          data = await this.productsForCard(id, 2 * 60_000);
        } catch (e) {
          if (!(Number.isInteger(expId) && expId > 0)) throw e;
          data = await this.productsFor(expId);
        }
        const wanted = normLang(url.searchParams.get('lang'));
        const list = (data[id] || data[String(id)] || [])
          .filter(isListable)
          .filter((p) => !wanted || normLang(listingLang(p)) === wanted)
          .filter((p) => {
            const minRank = parseInt(url.searchParams.get('minrank'), 10);
            const r = condRank(p.properties_hash && p.properties_hash.condition);
            return !Number.isInteger(minRank) || r < 0 || r >= minRank;
          })
          .sort(byPrice)
          .slice(0, 12);
        return json(
          list.map((p) => {
            const h = p.properties_hash || {};
            return {
              id: p.id,
              cents: p.price.cents,
              currency: p.price.currency || 'EUR',
              condition: h.condition || null,
              language: listingLang(p),
              zero: isZero(p),
              seller: p.user && p.user.username,
              country: p.user && p.user.country_code,
              quantity: p.quantity,
            };
          }),
        );
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }

    if (path === '/api/rules' && method === 'POST') {
      const rules = await this.get('rules', []);
      const rule = this.cleanRule(await req.json());
      if (!rule) return json({ error: 'Regola non valida' }, 400);
      const i = rules.findIndex((r) => r.id === rule.id);
      if (i >= 0) {
        const old = rules[i];
        rules[i] = rule;
        // Se cambiano i criteri, gli annunci già visti vanno rivalutati con i criteri nuovi.
        const keys = ['maxPriceCents', 'minDiscount', 'minPriceCents', 'zero', 'language', 'minCondition', 'nameContains'];
        if (keys.some((k) => old[k] !== rule[k])) await this.resetRuleMemory(rule.id);
      } else if (rules.length >= MAX_RULES) return json({ error: `Massimo ${MAX_RULES} regole` }, 400);
      else rules.push(rule);
      await this.ctx.storage.put('rules', rules);
      await this.ensureAlarm();
      return json(rule);
    }

    if (path.startsWith('/api/rules/') && method === 'DELETE') {
      const id = path.split('/').pop();
      const rules = (await this.get('rules', [])).filter((r) => r.id !== id);
      const alerts = (await this.get('alerts', [])).filter((a) => a.ruleId !== id);
      await this.ctx.storage.put({ rules, alerts });
      await this.resetRuleMemory(id);
      return json({ ok: true });
    }

    if (path === '/api/subscribe' && method === 'POST') {
      const { endpoint, replaces, only } = await req.json();
      if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint)) return json({ error: 'Endpoint non valido' }, 400);
      await this.ctx.storage.put('origin', url.origin); // serve come "subject" nelle notifiche push
      // "replaces": l'iscrizione precedente dello stesso dispositivo; "only": tieni solo questo dispositivo.
      let subs = only ? [] : (await this.get('subs', [])).filter((e) => e !== replaces);
      if (!subs.includes(endpoint)) subs.push(endpoint);
      await this.ctx.storage.put('subs', subs.slice(-20));
      return json({ ok: true });
    }

    if (path === '/api/unsubscribe' && method === 'POST') {
      const { endpoint } = await req.json();
      const subs = (await this.get('subs', [])).filter((e) => e !== endpoint);
      await this.ctx.storage.put('subs', subs);
      return json({ ok: true });
    }

    if (path === '/api/test-push' && method === 'POST') {
      const alert = {
        id: `test-${Date.now()}`,
        ts: Date.now(),
        name: 'Notifica di prova',
        expansion: 'Snipe',
        cents: 0,
        refCents: 0,
        currency: 'EUR',
        discount: 0,
        url: '/',
        test: true,
      };
      const alerts = await this.get('alerts', []);
      await this.ctx.storage.put('alerts', [alert, ...alerts].slice(0, MAX_ALERTS));
      return json({ sent: await this.notify(true) });
    }

    if (path === '/api/alerts' && method === 'DELETE') {
      await this.ctx.storage.put('alerts', []);
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  }

  async resetRuleMemory(ruleId) {
    const seen = await this.get('seen', {});
    for (const k of Object.keys(seen)) if (k.startsWith(`${ruleId}:`)) delete seen[k];
    const baselined = (await this.get('baselined', [])).filter((id) => id !== ruleId);
    await this.ctx.storage.put({ seen, baselined });
  }

  cleanRule(b) {
    if (!b || typeof b !== 'object') return null;
    const expansionId = parseInt(b.expansionId, 10);
    if (!Number.isInteger(expansionId) || expansionId <= 0) return null;
    const clamp = (n, lo, hi, d) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
    const language = String(b.language || '').toLowerCase();
    const blueprintId = parseInt(b.blueprintId, 10);
    const maxPrice = Number(b.maxPrice);
    const cmDiscount = Number(b.cmDiscount);
    const cmId = parseInt(b.cmId, 10);
    const cm = Number.isFinite(cmDiscount) && cmDiscount > 0 && Number.isInteger(cmId) && cmId > 0;
    return {
      id: typeof b.id === 'string' && b.id ? b.id.slice(0, 64) : crypto.randomUUID(),
      expansionId,
      expansionName: String(b.expansionName || '').slice(0, 80),
      blueprintId: Number.isInteger(blueprintId) && blueprintId > 0 ? blueprintId : null,
      cardName: String(b.cardName || '').slice(0, 80),
      cardImage: /^https:\/\//.test(b.cardImage || '') ? String(b.cardImage).slice(0, 300) : null,
      nameContains: String(b.nameContains || '').trim().slice(0, 60),
      // Se presente, l'alert scatta per prezzo assoluto e lo sconto percentuale non conta.
      maxPriceCents: !cm && Number.isFinite(maxPrice) && maxPrice > 0 ? Math.round(clamp(maxPrice, 0.01, 100000, 1) * 100) : null,
      // Alert "almeno X% sotto la tendenza Cardmarket": la soglia in euro si calcola a ogni controllo.
      cmDiscount: cm ? clamp(cmDiscount, 5, 90, 20) : null,
      cmId: cm ? cmId : null,
      zero: b.zero === 'only' || b.zero === 'exclude' ? b.zero : '',
      minDiscount: clamp(Number(b.minDiscount), 5, 90, 30),
      minPriceCents: Math.round(clamp(Number(b.minPrice), 0, 100000, 5) * 100),
      language: /^[a-z]{2}$/.test(language) ? language : '',
      minCondition: CONDITIONS.includes(b.minCondition) ? b.minCondition : 'Slightly Played',
      enabled: b.enabled !== false,
    };
  }

  async pokemonExpansions() {
    const cached = await this.get('expansions', null);
    const savedGame = await this.get('gameId', null);
    if (cached && savedGame && Date.now() - cached.ts < 24 * 3600_000) return cached.list;
    const games = await this.ct('/games');
    const list = Array.isArray(games) ? games : games.array || [];
    const game = list.find((g) => /pok[eé]mon/i.test(`${g.name} ${g.display_name}`));
    if (!game) throw new Error('Gioco Pokémon non trovato su CardTrader');
    const exps = await this.ct('/expansions');
    const out = exps
      .filter((e) => e.game_id === game.id)
      .map((e) => ({ id: e.id, code: e.code, name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    await this.ctx.storage.put({ expansions: { ts: Date.now(), list: out }, gameId: game.id });
    return out;
  }

  /** Id delle categorie "carta singola" per Pokémon, se l'API le espone. null = sconosciute. */
  async singleCategoryIds() {
    const saved = await this.get('cats2', null);
    if (saved && Date.now() - saved.ts < 7 * 86400_000) return saved.ids;
    if (this.catsFailedAt && Date.now() - this.catsFailedAt < 10 * 60_000) return null;
    try {
      let gameId = await this.get('gameId', null);
      if (!gameId) {
        await this.pokemonExpansions();
        gameId = await this.get('gameId', null);
      }
      if (!gameId) return null;
      const raw = await this.ct('/categories');
      const arr = Array.isArray(raw) ? raw : (raw && (raw.array || raw.categories || raw.data)) || [];
      // Solo le categorie del gioco Pokémon: l'elenco di CardTrader contiene tutti i giochi.
      const ids = arr.filter((c) => c.game_id === gameId && /single/i.test(c.name || '')).map((c) => c.id);
      const value = ids.length ? ids : null;
      await this.ctx.storage.put('cats2', { ts: Date.now(), ids: value });
      return value;
    } catch {
      this.catsFailedAt = Date.now();
      return null;
    }
  }

  /**
   * Annunci di un'espansione. Le pagine non chiamano CardTrader a ogni apertura: usano la copia in memoria
   * (aggiornata anche dallo scan) e la rinnovano al massimo ogni 5 minuti. Se CardTrader limita, si usa la copia vecchia.
   */
  async productsFor(expansionId, maxAgeMs = 5 * 60_000, background = false) {
    const hit = this.productCache.get(expansionId);
    if (hit && Date.now() - hit.ts < maxAgeMs) return hit.data;
    try {
      const data = await this.ct(`/marketplace/products?expansion_id=${expansionId}`, background);
      this.productCache.set(expansionId, { ts: Date.now(), data });
      return data;
    } catch (e) {
      if (hit) return hit.data;
      throw e;
    }
  }

  /** Tutti gli annunci di una carta: la lettura per espansione restituisce solo i più economici di ogni carta. */
  async productsForCard(blueprintId, maxAgeMs = 5 * 60_000, background = false) {
    const hit = this.bpCache.get(blueprintId);
    if (hit && Date.now() - hit.ts < maxAgeMs) return hit.data;
    try {
      const data = await this.ct(`/marketplace/products?blueprint_id=${blueprintId}`, background);
      this.bpCache.set(blueprintId, { ts: Date.now(), data });
      return data;
    } catch (e) {
      if (hit) return hit.data;
      throw e;
    }
  }

  /** Carte di un'espansione con immagine e prezzo più basso (in totale e con CardTrader Zero). */
  async cardsFor(expansionId) {
    const hit = this.cardCache.get(expansionId);
    const prodHit = this.productCache.get(expansionId);
    if (hit && prodHit && hit.ts >= prodHit.ts) return hit.data; // calcolate sugli annunci più recenti

    const singleIds = await this.singleCategoryIds();
    const bpKey = `bp4:${expansionId}`;
    let blueprints;
    const savedBp = await this.get(bpKey, null);
    if (savedBp && Date.now() - savedBp.ts < 24 * 3600_000) {
      blueprints = savedBp.list;
    } else {
      let raw = await this.ct(`/blueprints/export?expansion_id=${expansionId}`);
      if (!Array.isArray(raw)) raw = (raw && (raw.blueprints || raw.array || raw.data)) || [];
      blueprints = raw.map((b) => ({ id: b.id, name: b.name, version: b.version, image_url: b.image_url, category_id: b.category_id, fp: b.fixed_properties || {}, cm: Array.isArray(b.card_market_ids) ? b.card_market_ids[0] || null : null }));
      await this.ctx.storage.put(bpKey, { ts: Date.now(), list: blueprints });
    }
    const products = await this.productsFor(expansionId);

    const cmMap = await this.cmLookup(blueprints.map((b) => b.cm).filter(Boolean));
    const langCount = {};
    const cards = blueprints.map((bp) => {
      const list = (products[bp.id] || products[String(bp.id)] || []).filter(isListable).sort(byPrice);
      const low = list[0];
      const lowZero = list.find(isZero);
      const num = prop(list, /^collector_number$/i) || fixedProp(bp.fp, /collector_number/i);
      // Prezzi più bassi per lingua (codici normalizzati: il giapponese è sempre "jp").
      const langs = {};
      const lc = {}; // "lingua|condizione" -> [prezzo più basso, prezzo più basso Zero]; condizione = posizione 0-6, -1 se ignota
      for (const p of list) {
        const code = normLang(listingLang(p)) || 'sconosciuta';
        const key = `${code}|${condRank(p.properties_hash && p.properties_hash.condition)}`;
        const cell = (lc[key] = lc[key] || [null, null]);
        if (cell[0] == null) cell[0] = p.price.cents;
        if (cell[1] == null && isZero(p)) cell[1] = p.price.cents;
        langCount[code] = (langCount[code] || 0) + 1;
        const e = (langs[code] = langs[code] || { lowest: null, lowestZero: null });
        if (e.lowest == null) e.lowest = p.price.cents;
        if (e.lowestZero == null && isZero(p)) e.lowestZero = p.price.cents;
      }
      const single = isSingleCard(bp, singleIds);
      return {
        single,
        id: bp.id,
        name: bp.name,
        version: bp.version || null,
        image: imageUrl(bp.image_url),
        number: num,
        rarity: prop(list, /rarity/i) || fixedProp(bp.fp, /rarity/i),
        listings: list.length,
        currency: (low && low.price.currency) || 'EUR',
        lowest: low ? low.price.cents : null,
        lowestZero: lowZero ? lowZero.price.cents : null,
        langs,
        lc,
        cmId: bp.cm || null,
        cm: (bp.cm && cmMap.get(bp.cm)) || null,
      };
    });
    cards.sort((a, b) => {
      const na = parseInt(a.number, 10);
      const nb = parseInt(b.number, 10);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.name.localeCompare(b.name);
    });

    const languages = Object.keys(langCount).sort((a, b) => langCount[b] - langCount[a]);
    const data = { expansionId, cards, languages };
    this.cardCache.set(expansionId, { ts: Date.now(), data });
    return data;
  }

  // ---------- Prezzi Cardmarket (listino pubblico giornaliero) ----------

  /** Il listino va scaricato se manca o ha più di 20 ore; dopo un errore si aspettano 30 minuti. */
  async cmDue() {
    const m = await this.get('cmmeta', null);
    const stale = !m || Date.now() - m.ts > 20 * 3600_000;
    return stale && !(this.cmFailedAt && Date.now() - this.cmFailedAt < 30 * 60_000);
  }

  async cmStep() {
    if (!(await this.cmDue())) return;
    try {
      const res = await fetch(this.env.CM_PRICE_URL || CM_PRICE_URL, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`Listino Cardmarket: HTTP ${res.status}`);
      const rows = parsePriceGuide(await res.text());
      if (rows.length < 1000) throw new Error('Listino Cardmarket incompleto');
      const entries = {};
      toShards(rows).forEach((shard, i) => (entries[`cm:${i}`] = shard));
      await this.ctx.storage.put(entries);
      await this.ctx.storage.put('cmmeta', { ts: Date.now(), count: rows.length });
      this.cmCache.clear();
      this.cmFailedAt = 0;
    } catch (e) {
      this.cmFailedAt = Date.now();
      throw e;
    }
  }

  /** Prezzi Cardmarket (tendenza, media 30 giorni, minimo) per un elenco di prodotti. Map id -> prezzi. */
  async cmLookup(ids) {
    const out = new Map();
    const need = new Set();
    const fresh = (c) => c && Date.now() - c.ts < 10 * 60_000;
    for (const id of ids) if (id && !fresh(this.cmCache.get(shardOf(id)))) need.add(shardOf(id));
    if (need.size) {
      const got = await this.ctx.storage.get([...need].map((n) => `cm:${n}`));
      for (const [k, data] of got) this.cmCache.set(Number(k.slice(3)), { ts: Date.now(), data });
    }
    for (const id of ids) {
      const c = this.cmCache.get(shardOf(id));
      const e = c && cmEntry(c.data[id]);
      if (e) out.set(id, e);
    }
    return out;
  }

  // ---------- Indice dei nomi (ricerca su tutte le espansioni) ----------

  async indexMeta() {
    return (await this.get('ixmeta', null)) || { have: [], done: [], complete: false, ts: 0 };
  }

  async indexPending() {
    const m = await this.get('ixmeta', null);
    return !!m && !m.complete;
  }

  /** Avvia il primo indice, o lo rinnova se ha più di due settimane. */
  async startIndexIfNeeded() {
    const meta = await this.get('ixmeta', null);
    const stale = meta && meta.complete && Date.now() - meta.ts > 14 * 86400_000;
    if (!meta) await this.ctx.storage.put('ixmeta', { have: [], done: [], complete: false, ts: 0 });
    else if (stale) await this.ctx.storage.put('ixmeta', { ...meta, done: [], complete: false });
    if (await this.indexPending()) await this.ensureAlarm();
  }

  /** Scarica le carte singole di alcune espansioni, entro un tempo massimo, e le salva nell'indice. */
  async indexStep(budgetMs = 20_000) {
    const meta = await this.get('ixmeta', null);
    if (!meta || meta.complete) return;
    const exps = await this.pokemonExpansions();
    const singleIds = await this.singleCategoryIds();
    const done = new Set(meta.done);
    const have = new Set(meta.have);
    const errors = meta.errors || {};
    const t0 = Date.now();
    try {
      for (const e of exps) {
        if (done.has(e.id)) continue;
        if (Date.now() - t0 > budgetMs) break;
        let raw;
        try {
          raw = await this.ct(`/blueprints/export?expansion_id=${e.id}`);
        } catch (err) {
          if (err.rateLimited) break;
          errors[e.id] = (errors[e.id] || 0) + 1;
          if (errors[e.id] >= 2) done.add(e.id); // non riesce: lo saltiamo
          continue;
        }
        if (!Array.isArray(raw)) raw = (raw && (raw.blueprints || raw.array || raw.data)) || [];
        const rows = raw
          .filter((b) => isSingleCard(b, singleIds))
          .map((b) => [b.id, b.name, b.version || '', b.category_id || 0, packImg(b.id, b.image_url)]);
        if (rows.length) {
          await this.ctx.storage.put(`ix:${e.id}`, rows);
          have.add(e.id);
        }
        done.add(e.id);
      }
    } finally {
      const complete = exps.every((e) => done.has(e.id));
      await this.ctx.storage.put('ixmeta', {
        have: [...have],
        done: [...done],
        errors,
        complete,
        ts: complete ? Date.now() : meta.ts,
        total: exps.length,
      });
    }
  }

  /** Cerca per nome in tutte le espansioni indicizzate: risultati raggruppati per espansione, dalle più recenti. */
  async searchIndex(terms) {
    const meta = await this.indexMeta();
    const exps = await this.pokemonExpansions().catch(() => []);
    const byId = new Map(exps.map((e) => [e.id, e]));
    const sets = [];
    let totalCards = 0;
    for (let i = 0; i < meta.have.length; i += 100) {
      const ids = meta.have.slice(i, i + 100);
      const got = await this.ctx.storage.get(ids.map((id) => `ix:${id}`));
      for (const [key, rows] of got) {
        const expId = parseInt(key.slice(3), 10);
        const hits = [];
        for (const r of rows) {
          const n = normText(r[1]);
          if (matchesTerms(n, terms)) hits.push({ rank: relevance(n, terms), id: r[0], name: r[1], version: r[2] || null, image: unpackImg(r[0], r[4]) });
        }
        if (!hits.length) continue;
        hits.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
        totalCards += hits.length;
        const e = byId.get(expId) || {};
        sets.push({ id: expId, name: e.name || `Espansione ${expId}`, code: e.code || '', cards: hits.map(({ rank, ...c }) => c) });
      }
    }
    sets.sort((a, b) => b.id - a.id); // id più alto = espansione più recente
    return {
      sets,
      totalCards,
      index: { done: meta.done.length, total: meta.total || exps.length, complete: !!meta.complete },
    };
  }

  // ---------- Scan ----------

  async ensureAlarm() {
    const rules = (await this.get('rules', [])).filter((r) => r.enabled);
    const paused = (await this.settings()).paused;
    if ((paused || !rules.length) && !(await this.indexPending()) && !(await this.cmDue())) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  async alarm() {
    const status = await this.get('status', {});
    try {
      await this.scanOnce(status);
      status.lastError = null;
    } catch (e) {
      status.lastError = String(e.message || e);
    }
    status.lastScan = Date.now();
    try {
      await this.cmStep();
      status.cmError = null;
    } catch (e) {
      status.cmError = String(e.message || e);
    }
    try {
      await this.indexStep();
      status.indexError = null;
    } catch (e) {
      status.indexError = String(e.message || e);
    }
    await this.ctx.storage.put('status', status);

    const settings = await this.settings();
    const scanning = !settings.paused && (await this.get('rules', [])).some((r) => r.enabled);
    if (scanning || (await this.indexPending()) || (await this.cmDue())) {
      const every = scanning ? settings.scanEverySec * 1000 : SCAN_EVERY_MS;
      await this.ctx.storage.setAlarm(Math.max(Date.now() + every, this.blockedUntil));
    }
  }

  /**
   * Aggiorna al massimo MARKET_PER_SCAN letture dal marketplace per giro, scegliendo le più vecchie:
   * le espansioni delle regole e, per gli alert su una carta, tutti gli annunci di quella carta
   * (la lettura per espansione dà solo i più economici di ogni carta). Così le richieste restano
   * costanti anche con molti alert, e ogni fonte si aggiorna a turno.
   */
  async refreshSources(rules) {
    const sources = new Map();
    for (const r of rules) {
      sources.set(`e:${r.expansionId}`, { kind: 'e', id: r.expansionId });
      if (r.blueprintId) sources.set(`b:${r.blueprintId}`, { kind: 'b', id: r.blueprintId });
    }
    const age = (src) => {
      const hit = (src.kind === 'b' ? this.bpCache : this.productCache).get(src.id);
      return hit ? hit.ts : 0;
    };
    const due = [...sources.values()].sort((a, b) => age(a) - age(b)).slice(0, MARKET_PER_SCAN);
    let n = 0;
    let error = null;
    for (const src of due) {
      try {
        if (src.kind === 'b') await this.productsForCard(src.id, 0, true);
        else await this.productsFor(src.id, 0, true);
        n++;
      } catch (e) {
        error = e; // i dati già letti restano validi: le regole si valutano comunque
        if (e.rateLimited || e.budget) break;
      }
    }
    if (error && error.budget) error = null; // budget finito: non è un errore, si riprende al giro dopo
    if (error && !n && ![...sources.values()].some((src) => age(src))) throw error;
    return n;
  }

  /** Annunci più recenti disponibili per una regola: quelli della carta o quelli dell'espansione. */
  dataForRule(rule) {
    const exp = this.productCache.get(rule.expansionId);
    const bp = rule.blueprintId && this.bpCache.get(rule.blueprintId);
    if (bp && (!exp || bp.ts >= exp.ts || Date.now() - bp.ts < 3 * 60_000)) return bp.data;
    return exp ? exp.data : null;
  }

  async scanOnce(status) {
    if (!this.env.CARDTRADER_TOKEN) throw new Error('CARDTRADER_TOKEN non configurato');
    if ((await this.settings()).paused) return;
    const rules = (await this.get('rules', [])).filter((r) => r.enabled);
    const baselined = new Set(await this.get('baselined', []));
    const seen = await this.get('seen', {});
    const fresh = [];
    const requests = await this.refreshSources(rules);

    for (const rule of rules) {
      let evalRule = rule;
      let cmRef = null;
      if (rule.cmDiscount && rule.cmId) {
        const e = (await this.cmLookup([rule.cmId])).get(rule.cmId);
        const max = e && maxCentsBelow(e.trend, rule.cmDiscount);
        if (!max) continue; // senza prezzo Cardmarket non c'è un riferimento: nessun alert
        cmRef = e.trend;
        evalRule = { ...rule, maxPriceCents: max };
      }
      const data = this.dataForRule(rule);
      if (!data) continue; // nessun dato ancora: arriverà a uno dei prossimi giri
      const deals = findDeals(data, evalRule).map((d) =>
        cmRef ? { ...d, refCents: Math.round(cmRef * 100), discount: Math.max(0, 1 - d.cents / (cmRef * 100)) } : d,
      );
      // Gli alert su una carta valutano subito anche gli annunci già in vendita. Solo le vecchie regole
      // su un'intera espansione, che potrebbero produrre decine di alert, alla prima scansione
      // memorizzano soltanto ciò che c'è.
      const firstRun = !baselined.has(rule.id) && !rule.blueprintId;

      for (const d of deals) {
        const sid = `${rule.id}:${d.product.id}:${d.cents}`; // per regola: due alert sulla stessa carta non si oscurano
        if (seen[sid]) continue;
        seen[sid] = Date.now();
        if (firstRun) continue; // alla prima scansione registriamo solo ciò che c'è già
        const p = d.product;
        fresh.push({
          id: sid,
          ts: Date.now(),
          ruleId: rule.id,
          name: p.name_en || rule.cardName,
          expansion: (p.expansion && p.expansion.name_en) || rule.expansionName,
          condition: p.properties_hash && p.properties_hash.condition,
          language: listingLang(p),
          cents: d.cents,
          refCents: d.refCents,
          currency: p.price.currency || 'EUR',
          discount: d.discount,
          refKind: cmRef ? 'cardmarket' : null,
          seller: p.user && p.user.username,
          country: p.user && p.user.country_code,
          zero: isZero(p),
          cardImage: rule.cardImage || null,
          url: `https://www.cardtrader.com/cards/${p.blueprint_id}`,
        });
      }
      baselined.add(rule.id);
    }

    // Pulizia di seen: scarta i più vecchi oltre il limite o dopo 7 giorni.
    const cutoff = Date.now() - 7 * 86400_000;
    let entries = Object.entries(seen).filter(([, t]) => t > cutoff);
    if (entries.length > MAX_SEEN) entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN);

    await this.ctx.storage.put({
      seen: Object.fromEntries(entries),
      baselined: [...baselined],
    });

    status.requests = (status.requests || 0) + requests;
    status.scans = (status.scans || 0) + 1;

    if (fresh.length) {
      const alerts = await this.get('alerts', []);
      await this.ctx.storage.put('alerts', [...fresh.sort((a, b) => b.discount - a.discount), ...alerts].slice(0, MAX_ALERTS));
      await this.notify();
    }
  }

  async notify(force = false) {
    if (!force && isQuiet(await this.settings())) return 0; // orari silenziosi: l'avviso resta nell'elenco
    const subs = await this.get('subs', []);
    if (!subs.length) return 0;
    const keys = await this.vapid();
    const alive = [];
    let sent = 0;
    for (const endpoint of subs) {
      try {
        const status = await sendPush(keys, endpoint);
        if (status === 404 || status === 410) continue; // iscrizione scaduta
        alive.push(endpoint);
        if (status >= 200 && status < 300) sent++;
      } catch {
        alive.push(endpoint);
      }
    }
    if (alive.length !== subs.length) await this.ctx.storage.put('subs', alive);
    return sent;
  }
}
