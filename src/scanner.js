import { DurableObject } from 'cloudflare:workers';
import { CONDITIONS, condRank, findDeals, isListable, isSingleCard, isZero, listingLang, normLang, rejectReasons } from './deals.js';
import { BUILD } from './build.js';
import { planOf, rulesInPlan } from './plans.js';
import { cheapestShipping } from './shipping.js';
import { addPoint, refWeekAgo } from './history.js';
import { pickDue, pickData } from './sources.js';
import { dealsFromProducts } from './daydeals.js';
import { collKey, priceFor, summarize } from './collection.js';
import { CM_PRICE_URL, cmEntry, maxCentsBelow, parsePriceGuide, shardOf, toShards } from './cardmarket.js';
import { DEFAULT_SETTINGS, cleanSettings, isQuiet, localMinutes } from './settings.js';
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
const DEALS_SETS = 10; // espansioni più recenti controllate per gli affari del giorno
const DEALS_POPULAR = 10; // più le più ricercate del momento dagli utenti di Snipe



/** Toglie gli annunci dei venditori esclusi dall'utente. */
function withoutSellers(data, blocked) {
  const out = {};
  for (const [bp, list] of Object.entries(data)) out[bp] = Array.isArray(list) ? list.filter((p) => !(p.user && blocked.has(p.user.username))) : list;
  return out;
}
const CATALOG = 'main';
const STUCK_MS = 15 * 60_000;
const MKT_BUCKET = 6; // gettoni massimi: permette brevi raffiche (aprire qualche espansione di fila)
const MKT_RESERVE = 3; // gettoni che lo scan lascia sempre all'utente
const MKT_GAP_START = 3000; // un gettone ogni 3 s = 20 letture al minuto
const MKT_GAP_MIN = 2000;
const MKT_GAP_MAX = 15_000; // letture dal marketplace per giro di scan, qualunque sia il numero di alert
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
  histAt = new Map(); // carta -> ultima scrittura dello storico (al massimo ogni 30 minuti)
  bpCache = new Map(); // carta -> { ts, data }: tutti gli annunci di una carta (la lettura per espansione ne dà solo i più economici)
  cmCache = new Map();
  cmRemote = new Map();
  stockState = new Map(); // alert "torna disponibile": quanti annunci adatti c'erano al giro precedente // prezzi Cardmarket chiesti al catalogo condiviso
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

  /** Token CardTrader dell'utente di questo server dati (il Secret vale solo per il vecchio account unico). */
  async token() {
    if (this.tokenCache === undefined) {
      const acc = await this.get('account', null);
      this.tokenCache = (acc && acc.token) || this.env.CARDTRADER_TOKEN || '';
    }
    return this.tokenCache;
  }

  async plan() {
    if (!this.planCache) this.planCache = planOf(await this.get('plan', null));
    return this.planCache;
  }

  /**
   * Stato dello scan, tenuto in memoria e salvato al massimo una volta al minuto (o quando cambia un errore):
   * le scritture sono la risorsa più scarsa del piano gratuito di Cloudflare.
   */
  async status() {
    if (!this.statusMem) this.statusMem = await this.get('status', {});
    return this.statusMem;
  }

  async saveStatus(status, force = false) {
    const sig = [status.lastError, status.cmError, status.indexError, status.stuckNotified].join('|');
    if (!force && sig === this.statusSig && Date.now() - (this.statusSavedAt || 0) < 60_000) return;
    this.statusSig = sig;
    this.statusSavedAt = Date.now();
    status.dayWrites = (status.dayWrites || 0) + 1;
    await this.ctx.storage.put('status', status);
  }

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

  /**
   * Interesse per un'espansione (set aperto, alert creato, carta nei desideri): il catalogo ne tiene un punteggio
   * che si dimezza ogni giorno, così "le più ricercate" sono quelle del momento. Non blocca mai la richiesta.
   */
  bumpExpansion(expansionId, weight = 1) {
    const id = parseInt(expansionId, 10);
    if (!Number.isInteger(id) || id <= 0) return;
    this.ctx.waitUntil(
      this.catalog().fetch('https://do.internal/api/_pop', { method: 'POST', body: JSON.stringify({ id, weight }) }).catch(() => null),
    );
  }

  // ---------- Collezione ----------

  async collectionUpsert(b) {
    const bp = parseInt(b && b.bp, 10);
    if (!Number.isInteger(bp) || bp <= 0) return { error: 'Carta mancante' };
    const lang = normLang(b.lang) || '';
    const cond = CONDITIONS.includes(b.cond) ? b.cond : '';
    const key = collKey(bp, lang, cond);
    const coll = await this.get('coll', []);
    const i = coll.findIndex((c) => c.key === key);
    const prev = i >= 0 ? coll[i] : null;
    let qty = Math.max(0, Math.min(999, parseInt(b.qty, 10) || 0));
    if (b.add && prev) qty += prev.qty;
    if (!qty) {
      if (i >= 0) coll.splice(i, 1);
    } else {
      if (!prev) {
        const plan = await this.plan();
        if (coll.length >= plan.maxColl) return { error: `Il piano ${plan.label} include ${plan.maxColl} carte diverse nella collezione.`, upgrade: true, status: 403 };
      }
      const paid = Number.isFinite(Number(b.paidCents)) && Number(b.paidCents) > 0 ? Math.round(Number(b.paidCents)) : null;
      // Prezzo pagato: media ponderata quando si aggiungono copie con un prezzo nuovo.
      const paidCents = paid == null ? (prev ? prev.paidCents : null)
        : b.add && prev && prev.paidCents ? Math.round((prev.paidCents * prev.qty + paid * (qty - prev.qty)) / qty) : paid;
      const item = {
        key, bp, lang, cond, qty, paidCents,
        name: String(b.name || (prev && prev.name) || '').slice(0, 120),
        image: /^https:\/\//.test(b.image || '') ? String(b.image).slice(0, 300) : prev ? prev.image : null,
        expansionId: parseInt(b.expansionId, 10) || (prev && prev.expansionId) || null,
        expName: String(b.expName || (prev && prev.expName) || '').slice(0, 80),
        cmId: parseInt(b.cmId, 10) || (prev && prev.cmId) || null,
        ts: prev ? prev.ts : Date.now(),
      };
      if (i >= 0) coll[i] = item; else coll.unshift(item);
      if (!prev) this.bumpExpansion(item.expansionId, 2);
    }
    await this.ctx.storage.put('coll', coll);
    await this.collectionPrices(true);
    await this.ensureAlarm();
    return { ok: true };
  }

  /** Aggiorna i prezzi della collezione con gli annunci già letti e salva un punto al giorno del valore. */
  async collectionPrices(force = false) {
    const coll = await this.get('coll', []);
    if (!coll.length) return;
    const prices = await this.get('collPrices', {});
    let changed = false;
    for (const c of coll) {
      const hit = this.bpCache.get(c.bp);
      if (!hit) continue;
      const old = prices[c.key];
      if (!force && old && old.ts >= hit.ts) continue;
      const pr = priceFor(hit.data[c.bp] || hit.data[String(c.bp)], c.lang, c.cond);
      prices[c.key] = pr ? { ...pr, ts: hit.ts } : { cents: null, ts: hit.ts };
      changed = true;
    }
    if (!changed) return;
    await this.ctx.storage.put('collPrices', prices);
    const items = coll.map((c) => ({ ...c, price: prices[c.key] && prices[c.key].cents != null ? prices[c.key] : null }));
    const cm = await this.cmLookup(coll.map((c) => c.cmId).filter(Boolean));
    for (const it of items) { const e = it.cmId && cm.get(it.cmId); it.cmCents = e && e.trend ? Math.round(e.trend * 100) : null; }
    const sum = summarize(items);
    const hist = await this.get('collHist', []);
    const d = new Date().toISOString().slice(0, 10);
    const point = { d, value: sum.value, cm: sum.cm, qty: sum.qty };
    if (hist.length && hist[hist.length - 1].d === d) hist[hist.length - 1] = point; else hist.push(point);
    await this.ctx.storage.put('collHist', hist.slice(-400));
  }

  async collectionView() {
    const coll = await this.get('coll', []);
    const prices = await this.get('collPrices', {});
    const cm = await this.cmLookup(coll.map((c) => c.cmId).filter(Boolean));
    const plan = await this.plan();
    const items = coll.map((c) => {
      const p = prices[c.key];
      const e = c.cmId && cm.get(c.cmId);
      return { ...c, price: p && p.cents != null ? p : null, cmCents: e && e.trend ? Math.round(e.trend * 100) : null };
    });
    // Variazione a 7 giorni dallo storico prezzi della carta (prezzo più basso in assoluto).
    for (const it of items) {
      const h = await this.get(`h:${it.bp}`, []);
      const old = h.length > 1 ? h[Math.max(0, h.length - 8)] : null;
      const last = h[h.length - 1];
      it.change7 = old && last && old.min ? last.min / old.min - 1 : null;
    }
    const hist = (await this.get('collHist', [])).slice(-plan.historyDays);
    return { items, summary: summarize(items), history: hist, limit: plan.maxColl, unlimited: plan.unlimited };
  }

  /** Una volta al giorno segnala al catalogo le espansioni dei propri alert e desideri (interesse di fondo). */
  async reportInterest() {
    const today = new Date().toISOString().slice(0, 10);
    if ((await this.get('popDay', null)) === today) return;
    await this.ctx.storage.put('popDay', today);
    const ids = new Set();
    for (const r of await this.get('rules', [])) if (r.enabled) ids.add(r.expansionId);
    for (const w of await this.get('wish', [])) if (w.expansionId) ids.add(w.expansionId);
    for (const id of ids) this.bumpExpansion(id, 1);
  }

  /** Il catalogo condiviso (indice dei nomi e listino Cardmarket) vive nel server dati 'main'. */
  async isCatalog() {
    return (await this.get('doName', CATALOG)) === CATALOG;
  }

  catalog() {
    return this.env.SCANNER.get(this.env.SCANNER.idFromName(CATALOG));
  }

  async catalogInfo(status) {
    const m = await this.get('ixmeta', null);
    return {
      index: m ? { done: m.done.length, total: m.total || null, complete: !!m.complete, withCards: m.have.length } : null,
      indexError: (status && status.indexError) || null,
      cm: await this.get('cmmeta', null),
      cmError: (status && status.cmError) || null,
    };
  }

  async systemInfo(status) {
    const cat = (await this.isCatalog())
      ? await this.catalogInfo(status)
      : await this.catalog().fetch('https://do.internal/api/_catinfo').then((r) => r.json()).catch(() => ({}));
    return {
      build: BUILD,
      ...cat,
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
      headers: { Authorization: `Bearer ${await this.token()}`, Accept: 'application/json' },
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
    if (path.startsWith('/marketplace')) this.lastMarketOk = Date.now();
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

    if (path === '/api/_account' && method === 'POST') {
      const b = await req.json();
      const prev = await this.get('account', null);
      await this.ctx.storage.put('account', { token: String(b.token || ''), userId: String(b.userId || ''), name: String(b.name || ''), since: (prev && prev.since) || Date.now() });
      await this.ctx.storage.put('plan', String(b.plan || ''));
      if (b.doName) await this.ctx.storage.put('doName', String(b.doName));
      this.tokenCache = undefined;
      this.planCache = null;
      if (prev && prev.token !== b.token) this.blockedUntil = 0;
      await this.ensureAlarm();
      return json({ ok: true });
    }

    if (path === '/api/deals' && method === 'GET') {
      if (!(await this.isCatalog())) return json({ error: 'not found' }, 404);
      await this.ensureAlarm();
      try {
        return json(await this.dealsList());
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }

    if (path === '/api/_pop' && method === 'POST') {
      const { id, weight } = await req.json();
      const pop = await this.get('pop', { ts: Date.now(), s: {} });
      const days = (Date.now() - pop.ts) / 86400_000;
      if (days >= 1) {
        // Dimezza i punteggi per ogni giorno passato e scarta quelli ormai trascurabili.
        const f = 0.5 ** Math.floor(days);
        for (const k of Object.keys(pop.s)) { pop.s[k] *= f; if (pop.s[k] < 0.1) delete pop.s[k]; }
        pop.ts = Date.now();
      }
      pop.s[id] = (pop.s[id] || 0) + Math.min(5, Math.max(0, Number(weight) || 1));
      await this.ctx.storage.put('pop', pop);
      return json({ ok: true });
    }

    if (path === '/api/_catinfo') return json(await this.catalogInfo(await this.status()));

    if (path === '/api/_cm' && method === 'POST') {
      const ids = ((await req.json()).ids || []).slice(0, 5000);
      return json([...(await this.cmLookup(ids))]);
    }

    if (path === '/api/_stats') {
      const [rules, alerts, status, subs, wish, bought] = await Promise.all(['rules', 'alerts', 'status', 'subs', 'wish', 'bought'].map((k) => (k === 'status' ? this.status() : this.get(k, []))));
      return json({
        rules: rules.length,
        activeRules: rules.filter((r) => r.enabled).length,
        alerts: alerts.length,
        wish: wish.length,
        bought: bought.length,
        devices: subs.length,
        lastScan: status.lastScan || null,
        // Per la stima del consumo: ogni giro di scan è una richiesta al server dati.
        scanSec: rules.some((r) => r.enabled) && !(await this.settings()).paused && !(await this.get('suspended', false))
          ? Math.max((await this.settings()).scanEverySec, (await this.plan()).scanSec)
          : null,
        today: status.day === new Date().toISOString().slice(0, 10) ? { alarms: status.dayAlarms || 0, writes: status.dayWrites || 0 } : { alarms: 0, writes: 0 },
        lastError: status.lastError || null,
        scans: status.scans || 0,
        requests: status.requests || 0,
      });
    }

    if (path === '/api/_admin' && method === 'POST') {
      const b = await req.json();
      await this.ctx.storage.put('plan', String(b.plan || ''));
      this.planCache = null;
      await this.ctx.storage.put('suspended', !!b.blocked);
      if (b.blocked) await this.ctx.storage.deleteAlarm();
      else await this.ensureAlarm();
      return json({ ok: true });
    }

    // Il Worker indica il piano a ogni richiesta: lo teniamo anche per gli scan in background.
    // x-do = server dati dell'utente che fa la richiesta. La ricerca passa dal catalogo ('main'):
    // lì il piano di chi cerca non deve sostituire quello del proprietario.
    const xdo = req.headers.get('x-do');
    if (xdo && !['/api/search', '/api/index/refresh', '/api/deals'].includes(path) && !(await this.ctx.storage.get('doName'))) await this.ctx.storage.put('doName', xdo);
    const mine = !xdo || xdo === (await this.get('doName', CATALOG));
    const planHeader = mine ? req.headers.get('x-plan') : null;
    if (planHeader && planHeader !== (await this.get('plan', null))) {
      await this.ctx.storage.put('plan', planHeader);
      this.planCache = null;
    }

    if (path === '/api/latest' && method === 'GET') {
      const alerts = await this.get('alerts', []);
      // L'ultima cosa da notificare: un avviso, un problema dello scan o il riepilogo del mattino.
      const items = [alerts[0], await this.get('notice', null), await this.get('summaryNotice', null)].filter(Boolean);
      return json(items.sort((x, y) => y.ts - x.ts)[0] || null);
    }

    if (path === '/api/_version') {
      const m = await this.get('ixmeta', null);
      const st = await this.status();
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
      await this.maybeSummary().catch(() => null);
      await this.reportInterest().catch(() => null);
      const b = await req.json().catch(() => ({}));
      if (b.doName && b.doName !== (await this.get('doName', null))) await this.ctx.storage.put('doName', b.doName);
      if (b.plan && b.plan !== (await this.get('plan', null))) {
        await this.ctx.storage.put('plan', b.plan);
        this.planCache = null;
      }
      await this.ensureAlarm();
      return json({ ok: true });
    }

    if (path === '/api/state' && method === 'GET') {
      const [rules, alerts, status, subs] = await Promise.all([
        this.get('rules', []),
        this.get('alerts', []),
        this.status(),
        this.get('subs', []),
      ]);
      return json({
        rules,
        alerts: alerts.slice(0, 60),
        status,
        pushDevices: subs.length,
        outOfPlan: ((inPlan) => rules.filter((r) => r.enabled && !inPlan.has(r.id)).map((r) => r.id))(rulesInPlan(rules, await this.plan())),
        account: { name: ((await this.get('account', null)) || {}).name || decodeURIComponent(req.headers.get('x-user-name') || ''), plan: await this.plan() },
        bought: await this.get('bought', []),
        sellers: await this.get('sellers', { fav: [], block: [] }),
        settings: await this.settings(),
        system: await this.systemInfo(status),
        vapidPublic: (await this.vapid()).publicKey,
        conditions: CONDITIONS,
        wish: await Promise.all((await this.get('wish', [])).map(async (w) => {
          const h = await this.get(`h:${w.id}`, []);
          return { ...w, last: h[h.length - 1] || null, prev: h[h.length - 8] || h[0] || null };
        })),
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
        this.bumpExpansion(id, 1);
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
        if (rules.length >= (await this.plan()).maxRules) break;
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

    if (path === '/api/history' && method === 'GET') {
      const id = parseInt(url.searchParams.get('blueprint_id'), 10);
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'blueprint_id mancante' }, 400);
      const days = (await this.plan()).historyDays;
      return json((await this.get(`h:${id}`, [])).slice(-days));
    }

    if (path === '/api/sellers' && method === 'POST') {
      // { username, action: 'fav' | 'block' | 'none', country }
      const b = await req.json();
      const username = String((b && b.username) || '').trim().slice(0, 60);
      if (!username) return json({ error: 'Venditore mancante' }, 400);
      const sel = await this.get('sellers', { fav: [], block: [] });
      sel.fav = sel.fav.filter((f) => f.username !== username);
      sel.block = sel.block.filter((u) => u !== username);
      if (b.action === 'fav') sel.fav.unshift({ username, country: String(b.country || '').slice(0, 4), ts: Date.now() });
      if (b.action === 'block') sel.block.unshift(username);
      sel.fav = sel.fav.slice(0, 200);
      sel.block = sel.block.slice(0, 500);
      await this.ctx.storage.put('sellers', sel);
      this.blockedSellers = null;
      return json(sel);
    }

    if (path === '/api/seller' && method === 'GET') {
      // Annunci del venditore tra quelli letti di recente (CardTrader non permette di chiederli tutti).
      const username = url.searchParams.get('username') || '';
      const seen = new Map();
      for (const cache of [this.bpCache, this.productCache]) {
        for (const { data } of cache.values()) {
          for (const list of Object.values(data || {})) {
            if (!Array.isArray(list)) continue;
            for (const p of list) {
              if (!p || !p.user || p.user.username !== username || !isListable(p) || seen.has(p.id)) continue;
              const h = p.properties_hash || {};
              seen.set(p.id, {
                id: p.id,
                blueprintId: p.blueprint_id,
                name: p.name_en,
                expansion: p.expansion && p.expansion.name_en,
                cents: p.price.cents,
                currency: p.price.currency || 'EUR',
                condition: h.condition || null,
                language: listingLang(p),
                zero: isZero(p),
                quantity: p.quantity,
              });
            }
          }
        }
      }
      const rows = [...seen.values()].sort((a, b) => b.cents - a.cents).slice(0, 200);
      return json({ rows, sources: this.bpCache.size + this.productCache.size });
    }

    if (path === '/api/collection' && method === 'GET') {
      return json(await this.collectionView());
    }

    if (path === '/api/collection' && method === 'POST') {
      // { bp, name, image, expansionId, expName, cmId, lang, cond, qty (0 = togli), paidCents, add (true = somma alla quantità) }
      const b = await req.json();
      const res = await this.collectionUpsert(b);
      if (res.error) return json({ error: res.error, upgrade: res.upgrade }, res.status || 400);
      return json(await this.collectionView());
    }

    if (path === '/api/wish' && method === 'GET') {
      return json(await this.get('wish', []));
    }

    if (path === '/api/wish' && method === 'POST') {
      const b = await req.json();
      const id = parseInt(b && b.id, 10);
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'id mancante' }, 400);
      let wish = (await this.get('wish', [])).filter((w) => w.id !== id);
      if (b.remove !== true) {
        this.bumpExpansion(b.expansionId, 2);
        const plan = await this.plan();
        if (wish.length >= plan.maxWish) return json({ error: `Il piano ${plan.label} include ${plan.maxWish} carte nella lista dei desideri.`, upgrade: true }, 403);
        wish = [{
          id,
          name: String(b.name || '').slice(0, 120),
          image: /^https:\/\//.test(b.image || '') ? String(b.image).slice(0, 300) : null,
          expansionId: parseInt(b.expansionId, 10) || null,
          expName: String(b.expName || '').slice(0, 80),
          ts: Date.now(),
        }, ...wish].slice(0, (await this.plan()).maxWish);
      }
      await this.ctx.storage.put('wish', wish);
      return json(wish);
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
        const blockedSet = new Set((await this.get('sellers', { fav: [], block: [] })).block);
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
              blocked: !!(p.user && blockedSet.has(p.user.username)),
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
      const plan = await this.plan();
      if (!plan.priority) rule.priority = false;
      const i = rules.findIndex((r) => r.id === rule.id);
      if (i < 0) {
        const cards = rules.filter((r) => r.blueprintId).length;
        const sets = rules.length - cards;
        if (rule.blueprintId && cards >= plan.maxRules) return json({ error: `Il piano ${plan.label} include ${plan.maxRules} alert su una carta: passa a un piano superiore per aggiungerne altri.`, upgrade: true }, 403);
        if (!rule.blueprintId && sets >= plan.maxSetRules) return json({ error: plan.maxSetRules ? `Il piano ${plan.label} include ${plan.maxSetRules} alert su un set.` : `Gli alert su tutto un set sono inclusi nei piani Pro e Sniper.`, upgrade: true }, 403);
      }
      if (i >= 0) {
        const old = rules[i];
        rules[i] = rule;
        // Se cambiano i criteri, gli annunci già visti vanno rivalutati con i criteri nuovi.
        const keys = ['dropPct', 'stock', 'maxPriceCents', 'minDiscount', 'minPriceCents', 'zero', 'language', 'minCondition', 'nameContains'];
        if (keys.some((k) => old[k] !== rule[k])) await this.resetRuleMemory(rule.id);
      } else {
        rules.push(rule);
        this.bumpExpansion(rule.expansionId, 3);
      }
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

    if (path === '/api/alerts/mark' && method === 'POST') {
      const b = await req.json();
      const mark = b && (b.mark === 'seen' || b.mark === 'bought') ? b.mark : null;
      const alerts = await this.get('alerts', []);
      const a = alerts.find((x) => x.id === (b && b.id));
      if (!a) return json({ error: 'Avviso non trovato' }, 404);
      a.mark = mark;
      await this.ctx.storage.put('alerts', alerts);
      if (mark === 'bought') {
        const log = await this.get('bought', []);
        if (!log.some((x) => x.id === a.id)) {
          log.unshift({ id: a.id, ts: Date.now(), name: a.name, cents: a.cents, refCents: a.refCents, ship: a.ship ? a.ship.cents : 0 });
          await this.ctx.storage.put('bought', log.slice(0, 500));
          // Quello che compri entra nella collezione, con il prezzo pagato (spedizione compresa).
          const bp = a.bp || parseInt(String(a.url || '').split('/').pop(), 10);
          if (bp) {
            await this.collectionUpsert({
              bp, name: a.name, image: a.cardImage, expansionId: a.expansionId, expName: a.expansion,
              lang: a.language, cond: a.condition, qty: 1, add: true, paidCents: a.cents + (a.ship ? a.ship.cents : 0),
            }).catch(() => null);
          }
        }
      } else {
        const log = (await this.get('bought', [])).filter((x) => x.id !== a.id);
        await this.ctx.storage.put('bought', log);
      }
      return json(a);
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
    const dropPct = Number(b.dropPct);
    const drop = !cm && Number.isFinite(dropPct) && dropPct > 0 && Number.isInteger(blueprintId) && blueprintId > 0;
    const stock = !cm && !drop && b.stock === true && Number.isInteger(blueprintId) && blueprintId > 0;
    return {
      id: typeof b.id === 'string' && b.id ? b.id.slice(0, 64) : crypto.randomUUID(),
      expansionId,
      expansionName: String(b.expansionName || '').slice(0, 80),
      blueprintId: Number.isInteger(blueprintId) && blueprintId > 0 ? blueprintId : null,
      cardName: String(b.cardName || '').slice(0, 80),
      cardImage: /^https:\/\//.test(b.cardImage || '') ? String(b.cardImage).slice(0, 300) : null,
      nameContains: String(b.nameContains || '').trim().slice(0, 60),
      // Se presente, l'alert scatta per prezzo assoluto e lo sconto percentuale non conta.
      maxPriceCents: !cm && !drop && !stock && Number.isFinite(maxPrice) && maxPrice > 0 ? Math.round(clamp(maxPrice, 0.01, 100000, 1) * 100) : null,
      // Alert "almeno X% sotto la tendenza Cardmarket": la soglia in euro si calcola a ogni controllo.
      cmDiscount: cm ? clamp(cmDiscount, 5, 90, 20) : null,
      cmId: cm ? cmId : null,
      // Alert "calo di prezzo": scatta se il prezzo più basso scende di dropPct% rispetto a 7 giorni prima.
      dropPct: drop ? clamp(dropPct, 5, 80, 15) : null,
      // Alert "torna disponibile": scatta quando la carta passa da nessun annuncio adatto ad almeno uno.
      stock,
      zero: b.zero === 'only' || b.zero === 'exclude' ? b.zero : '',
      minDiscount: clamp(Number(b.minDiscount), 5, 90, 30),
      minPriceCents: Math.round(clamp(Number(b.minPrice), 0, 100000, 5) * 100),
      language: /^[a-z]{2}$/.test(language) ? language : '',
      minCondition: CONDITIONS.includes(b.minCondition) ? b.minCondition : 'Slightly Played',
      priority: b.priority === true,
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
      // Lo storico delle carte seguite si aggiorna anche dalla lettura per espansione.
      for (const bp of await this.trackedCards()) {
        const list = data[bp] || data[String(bp)];
        if (list) await this.recordHistory(bp, list);
      }
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
      await this.recordHistory(blueprintId, data[blueprintId] || data[String(blueprintId)]);
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

  // ---------- Affari del giorno (solo nel catalogo condiviso) ----------

  /** Ogni 10 minuti si rilegge un'espansione (10 recenti + fino a 10 più ricercate): ognuna circa ogni 3 ore. */
  async dealsDue() {
    if (!(await this.isCatalog())) return false;
    const st = await this.get('ddState', { i: 0, ts: 0 });
    return Date.now() - st.ts > 10 * 60_000;
  }

  async recentExpansions() {
    const meta = await this.get('ixmeta', null);
    const have = new Set(meta ? meta.have : []);
    const exps = await this.pokemonExpansions();
    const usable = exps.filter((e) => !have.size || have.has(e.id));
    const recent = [...usable].sort((a, b) => b.id - a.id).slice(0, DEALS_SETS);
    // Più le più ricercate del momento dagli utenti di Snipe, escluse quelle già tra le recenti.
    const pop = (await this.get('pop', { s: {} })).s;
    const taken = new Set(recent.map((e) => e.id));
    const popular = usable
      .filter((e) => !taken.has(e.id) && pop[e.id] > 0)
      .sort((a, b) => pop[b.id] - pop[a.id])
      .slice(0, DEALS_POPULAR)
      .map((e) => ({ ...e, popular: true }));
    return [...recent, ...popular];
  }

  async dealsStep() {
    if (!(await this.dealsDue())) return;
    const st = await this.get('ddState', { i: 0, ts: 0 });
    await this.ctx.storage.put('ddState', { i: st.i + 1, ts: Date.now() });
    const exps = await this.recentExpansions();
    if (!exps.length) return;
    const exp = exps[st.i % exps.length];
    const { cards } = await this.cardsFor(exp.id);
    const products = await this.productsFor(exp.id);
    await this.ctx.storage.put(`dd:${exp.id}`, { ts: Date.now(), exp: { id: exp.id, name: exp.name }, items: dealsFromProducts(cards, products) });
  }

  async dealsList() {
    const exps = await this.recentExpansions();
    const got = await this.ctx.storage.get(exps.map((e) => `dd:${e.id}`));
    const items = [];
    let ts = 0;
    for (const v of got.values()) {
      ts = Math.max(ts, v.ts);
      for (const it of v.items) items.push({ ...it, expansionId: v.exp.id, expName: v.exp.name, ts: v.ts });
    }
    items.sort((a, b) => b.discount - a.discount);
    return { items: items.slice(0, 80), ts, sets: exps.map((e) => e.name), popular: exps.filter((e) => e.popular).map((e) => e.name) };
  }

  // ---------- Prezzi Cardmarket (listino pubblico giornaliero) ----------

  /** Il listino va scaricato se manca o ha più di 20 ore; dopo un errore si aspettano 30 minuti. */
  async cmDue() {
    if (!(await this.isCatalog())) return false; // il listino lo scarica solo il catalogo condiviso
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
    if (!(await this.isCatalog())) {
      // Chiede al catalogo condiviso, con una piccola cache locale di 10 minuti per prodotto.
      const out = new Map();
      const now = Date.now();
      const need = [];
      for (const id of ids) {
        const c = this.cmRemote.get(id);
        if (c && now - c.ts < 10 * 60_000) { if (c.e) out.set(id, c.e); } else if (id) need.push(id);
      }
      if (need.length) {
        const got = await this.catalog().fetch('https://do.internal/api/_cm', { method: 'POST', body: JSON.stringify({ ids: need }) }).then((r) => r.json()).catch(() => []);
        const map = new Map(got);
        for (const id of need) {
          const e = map.get(id) || null;
          this.cmRemote.set(id, { ts: now, e });
          if (e) out.set(id, e);
        }
      }
      return out;
    }
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
    if (!(await this.isCatalog())) return false;
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
    if (await this.get('suspended', false)) return;
    const rules = (await this.get('rules', [])).filter((r) => r.enabled);
    const paused = (await this.settings()).paused;
    const hasColl = (await this.get('coll', [])).length > 0;
    if ((paused || !rules.length) && !hasColl && !(await this.indexPending()) && !(await this.cmDue()) && !(await this.dealsDue())) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  async alarm() {
    if (await this.get('suspended', false)) return; // account sospeso dalla pagina admin
    const status = await this.status();
    const day = new Date().toISOString().slice(0, 10);
    if (status.day !== day) Object.assign(status, { day, dayAlarms: 0, dayWrites: 0 });
    status.dayAlarms = (status.dayAlarms || 0) + 1;
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
      await this.dealsStep();
    } catch (e) {
      status.dealsError = String(e.message || e);
    }
    try {
      await this.indexStep();
      status.indexError = null;
    } catch (e) {
      status.indexError = String(e.message || e);
    }
    await this.checkStuck(status);
    await this.maybeSummary();
    await this.saveStatus(status);

    const settings = await this.settings();
    const scanning = !settings.paused && (await this.get('rules', [])).some((r) => r.enabled);
    const busy = (await this.indexPending()) || (await this.cmDue());
    const hasColl = (await this.get('coll', [])).length > 0;
    if (scanning || busy || hasColl || (await this.isCatalog())) {
      // La frequenza scelta in Impostazioni, ma mai più veloce di quella del piano.
      // Il catalogo senza altro da fare si sveglia solo per gli affari del giorno (ogni 10 minuti).
      const every = scanning ? Math.max(settings.scanEverySec, (await this.plan()).scanSec) * 1000 : busy ? SCAN_EVERY_MS : hasColl ? 5 * 60_000 : 10 * 60_000;
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
    const add = (k, src) => {
      const prev = sources.get(k);
      sources.set(k, { ...src, prio: Math.max(src.prio, prev ? prev.prio : 0) });
    };
    for (const r of rules) {
      add(`e:${r.expansionId}`, { kind: 'e', id: r.expansionId, prio: r.priority ? 3 : 1 });
      if (r.blueprintId) add(`b:${r.blueprintId}`, { kind: 'b', id: r.blueprintId, prio: r.priority ? 3 : 1 });
    }
    // Lista dei desideri: le carte si aggiornano, ma senza fretta (al massimo ogni 15 minuti).
    for (const w of await this.get('wish', [])) {
      if (!sources.has(`b:${w.id}`)) sources.set(`b:${w.id}`, { kind: 'b', id: w.id, prio: 1, minAge: 15 * 60_000 });
    }
    // Collezione: ogni carta si rilegge al massimo una volta all'ora.
    for (const c of await this.get('coll', [])) {
      if (!sources.has(`b:${c.bp}`)) sources.set(`b:${c.bp}`, { kind: 'b', id: c.bp, prio: 1, minAge: 60 * 60_000 });
    }
    const age = (src) => {
      const hit = (src.kind === 'b' ? this.bpCache : this.productCache).get(src.id);
      return hit ? hit.ts : 0;
    };
    // Gli alert con la stella contano come se i loro dati fossero tre volte più vecchi: si aggiornano più spesso.
    const due = pickDue([...sources.values()], age, Date.now(), MARKET_PER_SCAN);
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

  /** Carte di cui teniamo lo storico in ogni caso: quelle con un alert e quelle nella lista dei desideri. */
  async trackedCards() {
    const ids = new Set();
    for (const r of await this.get('rules', [])) if (r.blueprintId) ids.add(r.blueprintId);
    for (const w of await this.get('wish', [])) ids.add(w.id);
    return [...ids];
  }

  async recordHistory(blueprintId, products) {
    if (!Array.isArray(products) || !products.length) return;
    const last = this.histAt.get(blueprintId) || 0;
    if (Date.now() - last < 30 * 60_000) return;
    this.histAt.set(blueprintId, Date.now());
    const key = `h:${blueprintId}`;
    await this.ctx.storage.put(key, addPoint(await this.get(key, []), products));
  }

  /** Annunci più recenti disponibili per una regola: quelli della carta o quelli dell'espansione. */
  dataForRule(rule) {
    const exp = this.productCache.get(rule.expansionId);
    const bp = rule.blueprintId && this.bpCache.get(rule.blueprintId);
    return pickData(exp, bp, Date.now());
  }

  /** Spedizione stimata del venditore (cache di un giorno). Gli annunci Zero passano dal magazzino CardTrader. */
  async shippingFor(username) {
    const key = `ship:${username}`;
    const hit = await this.get(key, null);
    if (hit && Date.now() - hit.ts < 24 * 3600_000) return hit.best;
    const methods = await this.ct(`/shipping_methods?username=${encodeURIComponent(username)}`);
    const best = cheapestShipping(methods);
    await this.ctx.storage.put(key, { ts: Date.now(), best });
    return best;
  }

  async addShipping(alerts) {
    for (const a of alerts.slice(0, 8)) {
      if (a.zero || !a.seller) continue;
      try {
        const s = await this.shippingFor(a.seller);
        if (s) a.ship = s;
      } catch {
        // senza stima l'alert parte comunque
      }
    }
  }

  /** Riepilogo del mattino (dalle 9, ora italiana): una notifica al giorno, solo se c'è qualcosa da dire. */
  async maybeSummary() {
    const settings = await this.settings();
    if (settings.summary === false || (await this.get('suspended', false))) return;
    const now = new Date();
    if (localMinutes(now, settings.tz) < 9 * 60) return;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: settings.tz || 'Europe/Rome' }).format(now);
    if ((await this.get('summaryDay', null)) === today) return;
    await this.ctx.storage.put('summaryDay', today);
    if (!(await this.get('subs', [])).length) return;

    const since = Date.now() - 86400_000;
    const recent = (await this.get('alerts', [])).filter((a) => !a.test && a.ts >= since);
    const best = recent.reduce((b, a) => (!b || a.discount > b.discount ? a : b), null);
    let dropCents = 0;
    let dropCards = 0;
    for (const w of await this.get('wish', [])) {
      const h = await this.get(`h:${w.id}`, []);
      if (h.length < 2) continue;
      const diff = h[h.length - 2].min - h[h.length - 1].min;
      if (diff > 0) { dropCents += diff; dropCards++; }
    }
    if (!recent.length && !dropCards) return;
    const money = (c) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(c / 100);
    const parts = [];
    if (recent.length) parts.push(`${recent.length} ${recent.length === 1 ? 'affare' : 'affari'} nelle ultime 24 ore${best && best.discount >= 0.01 ? `, il migliore −${Math.round(best.discount * 100)}% su ${best.name}` : ''}.`);
    if (dropCards) parts.push(`${dropCards} ${dropCards === 1 ? 'carta' : 'carte'} della lista dei desideri ${dropCards === 1 ? 'è scesa' : 'sono scese'} di ${money(dropCents)} in totale.`);
    await this.ctx.storage.put('summaryNotice', { id: `summary:${today}`, ts: Date.now(), kind: 'system', name: 'il riepilogo di oggi', text: parts.join(' ') });
    await this.notify();
  }

  /** Se per 15 minuti CardTrader non dà annunci nuovi mentre ci sono alert attivi, avvisa una volta. */
  async checkStuck(status) {
    if (this.lastMarketOk) status.lastMarketOk = this.lastMarketOk;
    const active = !(await this.settings()).paused && (await this.get('rules', [])).some((r) => r.enabled);
    const since = status.lastMarketOk || status.stuckWatchFrom || (status.stuckWatchFrom = Date.now());
    const stuck = active && Date.now() - since > STUCK_MS;
    if (stuck && !status.stuckNotified) {
      status.stuckNotified = true;
      const why = status.lastError ? ` Ultimo errore: ${status.lastError}` : '';
      await this.ctx.storage.put('notice', { id: `notice:${Date.now()}`, ts: Date.now(), kind: 'system', name: 'Scan fermo', text: `Da ${Math.round((Date.now() - since) / 60_000)} minuti CardTrader non risponde: gli alert non vengono controllati.${why}` });
      await this.notify();
    } else if (!stuck && status.stuckNotified) {
      status.stuckNotified = false;
      await this.ctx.storage.delete('notice');
    }
  }

  async scanOnce(status) {
    if (await this.get('suspended', false)) return;
    if (!(await this.token())) throw new Error('Token CardTrader mancante: esci e rientra');
    if ((await this.settings()).paused) return;
    const all = await this.get('rules', []);
    const plan = await this.plan();
    const inPlan = rulesInPlan(all, plan);
    // Il piano decide quanti alert si controllano; senza stella prioritaria nei piani che non la includono.
    const rules = all.filter((r) => inPlan.has(r.id)).map((r) => (plan.priority ? r : { ...r, priority: false }));
    const baselined = new Set(await this.get('baselined', []));
    const seen = await this.get('seen', {});
    const seenBefore = Object.keys(seen).length;
    const baselinedBefore = baselined.size;
    const fresh = [];
    const requests = await this.refreshSources(rules);
    await this.collectionPrices();
    const blocked = new Set((await this.get('sellers', { fav: [], block: [] })).block);

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
      let data = this.dataForRule(rule);
      if (!data) continue; // nessun dato ancora: arriverà a uno dei prossimi giri
      if (blocked.size) data = withoutSellers(data, blocked);
      let refKind = cmRef ? 'cardmarket' : null;
      let dropRef = null;
      if (rule.dropPct) {
        dropRef = refWeekAgo(await this.get(`h:${rule.blueprintId}`, []));
        if (!dropRef) continue; // servono almeno 3 giorni di storico
        evalRule = { ...rule, maxPriceCents: Math.floor(dropRef * (1 - rule.dropPct / 100)) };
        refKind = 'drop';
      }
      let deals;
      if (rule.stock) {
        const list = (data[rule.blueprintId] || data[String(rule.blueprintId)] || []).filter((p) => !rejectReasons(p, rule).length).sort((a, b) => a.price.cents - b.price.cents);
        const prev = this.stockState.get(rule.id);
        this.stockState.set(rule.id, list.length);
        deals = prev === 0 && list.length ? [{ product: list[0], cents: list[0].price.cents, refCents: null, discount: 0 }] : [];
        refKind = 'stock';
      } else {
        deals = findDeals(data, evalRule).map((d) =>
          cmRef ? { ...d, refCents: Math.round(cmRef * 100), discount: Math.max(0, 1 - d.cents / (cmRef * 100)) }
          : dropRef ? { ...d, refCents: dropRef, discount: Math.max(0, 1 - d.cents / dropRef) } : d,
        );
      }
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
          refKind,
          seller: p.user && p.user.username,
          country: p.user && p.user.country_code,
          zero: isZero(p),
          cardImage: rule.cardImage || null,
          url: `https://www.cardtrader.com/cards/${p.blueprint_id}`,
          bp: p.blueprint_id,
          expansionId: rule.expansionId,
        });
      }
      baselined.add(rule.id);
    }

    // Pulizia di seen: scarta i più vecchi oltre il limite o dopo 7 giorni.
    const cutoff = Date.now() - 7 * 86400_000;
    let entries = Object.entries(seen).filter(([, t]) => t > cutoff);
    if (entries.length > MAX_SEEN) entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN);

    // Si salva solo se è cambiato qualcosa: la maggior parte dei giri non trova annunci nuovi.
    if (Object.keys(seen).length !== seenBefore || entries.length !== seenBefore || baselined.size !== baselinedBefore) {
      await this.ctx.storage.put({ seen: Object.fromEntries(entries), baselined: [...baselined] });
    }

    status.requests = (status.requests || 0) + requests;
    status.scans = (status.scans || 0) + 1;

    if (fresh.length) {
      if ((await this.plan()).shipping) await this.addShipping(fresh);
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
