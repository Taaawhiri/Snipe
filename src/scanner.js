import { DurableObject } from 'cloudflare:workers';
import { CONDITIONS, findDeals, isListable, isSingleCard, isZero, listingLang, normLang, rejectReasons } from './deals.js';
import { generateVapidKeys, sendPush } from './push.js';

const API = 'https://api.cardtrader.com/api/v2';
const SCAN_EVERY_MS = 10_000; // CardTrader mette in cache leggermente le risposte: sotto i 10s non serve
// Limiti CardTrader: 200 richieste/10s in totale, ma sul marketplace la documentazione cita anche
// 1 richiesta al secondo. Restiamo prudenti: tutte le chiamate passano da un unico limitatore.
const MARKETPLACE_GAP_MS = 1200;
const OTHER_GAP_MS = 400;
const MIN_BACKOFF_MS = 30_000;
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
  queue = Promise.resolve();
  lastCall = 0;
  blockedUntil = 0;

  async get(key, fallback) {
    const v = await this.ctx.storage.get(key);
    return v === undefined ? fallback : v;
  }

  /** Mette in fila le chiamate a CardTrader e rispetta la pausa dopo un 429. */
  async throttle(path) {
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
      const gap = path.startsWith('/marketplace') ? MARKETPLACE_GAP_MS : OTHER_GAP_MS;
      const wait = this.lastCall + gap - now;
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
    } finally {
      release();
    }
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

  async ct(path) {
    await this.throttle(path);
    const res = await fetch((this.env.CARDTRADER_API || API) + path, {
      headers: { Authorization: `Bearer ${this.env.CARDTRADER_TOKEN}`, Accept: 'application/json' },
    });
    if (res.status === 429) {
      const retry = parseInt(res.headers.get('retry-after'), 10);
      const pause = Math.max(MIN_BACKOFF_MS, Number.isFinite(retry) ? retry * 1000 : 0);
      this.blockedUntil = Date.now() + pause;
      const err = new Error(`CardTrader ha risposto 429 (troppe richieste): pausa di ${Math.round(pause / 1000)}s`);
      err.rateLimited = true;
      throw err;
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

    if (path === '/api/explain' && method === 'GET') {
      const rule = (await this.get('rules', [])).find((r) => r.id === url.searchParams.get('rule_id'));
      if (!rule) return json({ error: 'Regola non trovata' }, 404);
      try {
        const data = await this.ct(`/marketplace/products?expansion_id=${rule.expansionId}`);
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
        return json({ rows, total: all.length });
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
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'blueprint_id mancante' }, 400);
      try {
        const data = await this.ct(`/marketplace/products?blueprint_id=${id}`);
        const wanted = normLang(url.searchParams.get('lang'));
        const list = (data[id] || data[String(id)] || [])
          .filter(isListable)
          .filter((p) => !wanted || normLang(listingLang(p)) === wanted)
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
      const { endpoint } = await req.json();
      if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint)) return json({ error: 'Endpoint non valido' }, 400);
      await this.ctx.storage.put('origin', url.origin); // serve come "subject" nelle notifiche push
      const subs = await this.get('subs', []);
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
      return json({ sent: await this.notify() });
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
    return {
      id: typeof b.id === 'string' && b.id ? b.id.slice(0, 64) : crypto.randomUUID(),
      expansionId,
      expansionName: String(b.expansionName || '').slice(0, 80),
      blueprintId: Number.isInteger(blueprintId) && blueprintId > 0 ? blueprintId : null,
      cardName: String(b.cardName || '').slice(0, 80),
      cardImage: /^https:\/\//.test(b.cardImage || '') ? String(b.cardImage).slice(0, 300) : null,
      nameContains: String(b.nameContains || '').trim().slice(0, 60),
      // Se presente, l'alert scatta per prezzo assoluto e lo sconto percentuale non conta.
      maxPriceCents: Number.isFinite(maxPrice) && maxPrice > 0 ? Math.round(clamp(maxPrice, 0.01, 100000, 1) * 100) : null,
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

  /** Carte di un'espansione con immagine e prezzo più basso (in totale e con CardTrader Zero). */
  async cardsFor(expansionId) {
    const hit = this.cardCache.get(expansionId);
    if (hit && Date.now() - hit.ts < 30_000) return hit.data;

    const singleIds = await this.singleCategoryIds();
    const bpKey = `bp3:${expansionId}`;
    let blueprints;
    const savedBp = await this.get(bpKey, null);
    if (savedBp && Date.now() - savedBp.ts < 24 * 3600_000) {
      blueprints = savedBp.list;
    } else {
      let raw = await this.ct(`/blueprints/export?expansion_id=${expansionId}`);
      if (!Array.isArray(raw)) raw = (raw && (raw.blueprints || raw.array || raw.data)) || [];
      blueprints = raw.map((b) => ({ id: b.id, name: b.name, version: b.version, image_url: b.image_url, category_id: b.category_id, fp: b.fixed_properties || {} }));
      await this.ctx.storage.put(bpKey, { ts: Date.now(), list: blueprints });
    }
    const products = await this.ct(`/marketplace/products?expansion_id=${expansionId}`);

    const langCount = {};
    const cards = blueprints.map((bp) => {
      const list = (products[bp.id] || products[String(bp.id)] || []).filter(isListable).sort(byPrice);
      const low = list[0];
      const lowZero = list.find(isZero);
      const num = prop(list, /^collector_number$/i) || fixedProp(bp.fp, /collector_number/i);
      // Prezzi più bassi per lingua (codici normalizzati: il giapponese è sempre "jp").
      const langs = {};
      for (const p of list) {
        const code = normLang(listingLang(p)) || 'sconosciuta';
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

  // ---------- Scan ----------

  async ensureAlarm() {
    const rules = (await this.get('rules', [])).filter((r) => r.enabled);
    if (!rules.length) return;
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
    await this.ctx.storage.put('status', status);

    const active = (await this.get('rules', [])).some((r) => r.enabled);
    if (active) await this.ctx.storage.setAlarm(Math.max(Date.now() + SCAN_EVERY_MS, this.blockedUntil));
  }

  async scanOnce(status) {
    if (!this.env.CARDTRADER_TOKEN) throw new Error('CARDTRADER_TOKEN non configurato');
    const rules = (await this.get('rules', [])).filter((r) => r.enabled);
    const baselined = new Set(await this.get('baselined', []));
    const seen = await this.get('seen', {});
    const fresh = [];
    const cache = new Map();
    let requests = 0;

    for (const rule of rules) {
      const key = String(rule.expansionId);
      if (!cache.has(key)) {
        cache.set(key, await this.ct(`/marketplace/products?expansion_id=${rule.expansionId}`));
        requests++;
      }
      const deals = findDeals(cache.get(key), rule);
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

  async notify() {
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
