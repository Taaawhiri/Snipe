import { DurableObject } from 'cloudflare:workers';
import { CONDITIONS, findDeals, isListable, isZero } from './deals.js';
import { sendPush } from './push.js';

const API = 'https://api.cardtrader.com/api/v2';
const SCAN_EVERY_MS = 10_000; // CardTrader mette in cache leggermente le risposte: sotto i 10s non serve
const REQUEST_GAP_MS = 250; // ~4 richieste/s, sotto il limite di 10/s sul marketplace
const MAX_RULES = 30;
const MAX_ALERTS = 200;
const MAX_SEEN = 20_000;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const imageUrl = (u) => (!u ? null : /^https?:/.test(u) ? u : `https://www.cardtrader.com${u.startsWith('/') ? '' : '/'}${u}`);
const byPrice = (a, b) => a.price.cents - b.price.cents;
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

  async get(key, fallback) {
    const v = await this.ctx.storage.get(key);
    return v === undefined ? fallback : v;
  }

  async ct(path) {
    const res = await fetch((this.env.CARDTRADER_API || API) + path, {
      headers: { Authorization: `Bearer ${this.env.CARDTRADER_TOKEN}`, Accept: 'application/json' },
    });
    if (res.status === 429) {
      const err = new Error('CardTrader: troppe richieste (429)');
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
        vapidPublic: this.env.VAPID_PUBLIC_KEY || null,
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

    if (path === '/api/listings' && method === 'GET') {
      const id = parseInt(url.searchParams.get('blueprint_id'), 10);
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'blueprint_id mancante' }, 400);
      try {
        const data = await this.ct(`/marketplace/products?blueprint_id=${id}`);
        const list = (data[id] || data[String(id)] || []).filter(isListable).sort(byPrice).slice(0, 12);
        return json(
          list.map((p) => {
            const h = p.properties_hash || {};
            return {
              id: p.id,
              cents: p.price.cents,
              currency: p.price.currency || 'EUR',
              condition: h.condition || null,
              language: h.pokemon_language || h.language || h.mtg_language || null,
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
      if (i >= 0) rules[i] = rule;
      else if (rules.length >= MAX_RULES) return json({ error: `Massimo ${MAX_RULES} regole` }, 400);
      else rules.push(rule);
      await this.ctx.storage.put('rules', rules);
      await this.ensureAlarm();
      return json(rule);
    }

    if (path.startsWith('/api/rules/') && method === 'DELETE') {
      const id = path.split('/').pop();
      const rules = (await this.get('rules', [])).filter((r) => r.id !== id);
      await this.ctx.storage.put('rules', rules);
      return json({ ok: true });
    }

    if (path === '/api/subscribe' && method === 'POST') {
      const { endpoint } = await req.json();
      if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint)) return json({ error: 'Endpoint non valido' }, 400);
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
    if (cached && Date.now() - cached.ts < 24 * 3600_000) return cached.list;
    const games = await this.ct('/games');
    const list = Array.isArray(games) ? games : games.array || [];
    const game = list.find((g) => /pok[eé]mon/i.test(`${g.name} ${g.display_name}`));
    if (!game) throw new Error('Gioco Pokémon non trovato su CardTrader');
    const exps = await this.ct('/expansions');
    const out = exps
      .filter((e) => e.game_id === game.id)
      .map((e) => ({ id: e.id, code: e.code, name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    await this.ctx.storage.put('expansions', { ts: Date.now(), list: out });
    return out;
  }

  /** Carte di un'espansione con immagine e prezzo più basso (in totale e con CardTrader Zero). */
  async cardsFor(expansionId) {
    const hit = this.cardCache.get(expansionId);
    if (hit && Date.now() - hit.ts < 30_000) return hit.data;

    const blueprints = await this.ct(`/blueprints/export?expansion_id=${expansionId}`);
    await sleep(REQUEST_GAP_MS);
    const products = await this.ct(`/marketplace/products?expansion_id=${expansionId}`);

    const cards = blueprints.map((bp) => {
      const list = (products[bp.id] || products[String(bp.id)] || []).filter(isListable).sort(byPrice);
      const low = list[0];
      const lowZero = list.find(isZero);
      const num = prop(list, /^collector_number$/i);
      return {
        id: bp.id,
        name: bp.name,
        version: bp.version || null,
        image: imageUrl(bp.image_url),
        number: num,
        rarity: prop(list, /rarity/i),
        listings: list.length,
        currency: (low && low.price.currency) || 'EUR',
        lowest: low ? low.price.cents : null,
        lowestZero: lowZero ? lowZero.price.cents : null,
      };
    });
    cards.sort((a, b) => {
      const na = parseInt(a.number, 10);
      const nb = parseInt(b.number, 10);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.name.localeCompare(b.name);
    });

    const data = { expansionId, cards };
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
      if (e.rateLimited) await sleep(20_000);
    }
    status.lastScan = Date.now();
    await this.ctx.storage.put('status', status);

    const active = (await this.get('rules', [])).some((r) => r.enabled);
    if (active) await this.ctx.storage.setAlarm(Date.now() + SCAN_EVERY_MS);
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
      const key = `${rule.expansionId}|${rule.language}`;
      if (!cache.has(key)) {
        if (requests > 0) await sleep(REQUEST_GAP_MS);
        const qs = `expansion_id=${rule.expansionId}${rule.language ? `&language=${rule.language}` : ''}`;
        cache.set(key, await this.ct(`/marketplace/products?${qs}`));
        requests++;
      }
      const deals = findDeals(cache.get(key), rule);
      const firstRun = !baselined.has(rule.id);

      for (const d of deals) {
        const sid = `${d.product.id}:${d.cents}`;
        if (seen[sid]) continue;
        seen[sid] = Date.now();
        if (firstRun) continue; // alla prima scansione registriamo solo ciò che c'è già
        const p = d.product;
        fresh.push({
          id: sid,
          ts: Date.now(),
          ruleId: rule.id,
          name: p.name_en,
          expansion: (p.expansion && p.expansion.name_en) || rule.expansionName,
          condition: p.properties_hash && p.properties_hash.condition,
          language: p.properties_hash && (p.properties_hash.pokemon_language || p.properties_hash.language),
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
    if (!this.env.VAPID_PUBLIC_KEY || !this.env.VAPID_PRIVATE_KEY) return 0;
    const subs = await this.get('subs', []);
    const alive = [];
    let sent = 0;
    for (const endpoint of subs) {
      try {
        const status = await sendPush(this.env, endpoint);
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
