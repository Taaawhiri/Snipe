import { DurableObject } from 'cloudflare:workers';
import { CONDITIONS, alertDue, condRank, cheapestPerCard, findDeals, gradeOf, isGraded, isListable, isRiskySeller, sellLimitOf, isSingleCard, isZero, listingLang, normLang, parseGradeLabel, rejectReasons, replaceAlerts } from './deals.js';
import { BUILD } from './build.js';
import { planOf, rulesInPlan } from './plans.js';
import { cheapestShipping } from './shipping.js';
import { addPoint, currentLow, refWeekAgo } from './history.js';
import { pickDue, pickData, slimProducts, slimSig } from './sources.js';
import { DEAL_LANGS, DAY_RULE, bogusRef, dealsFromProducts, zeroDealsFromProducts } from './daydeals.js';
import { checkAgainstHistory, cmCappable, collKey, gradedFromBase, pickPrice, priceFor, summarize, useCmPrice } from './collection.js';
import { scoreRow } from './cardid.js';
import { CM_PRICE_URL, cmEntry, maxCentsBelow, parsePriceGuide, shardOf, toShards } from './cardmarket.js';
import { DEFAULT_SETTINGS, cleanSettings, isQuiet, localMinutes } from './settings.js';
import { generateVapidKeys, sendPush } from './push.js';
import { REGION_FIXED, regionFromLangs, regionFromName } from './region.js';
import { vintageEra } from './vintage.js';
import { expansionNameOf, nextOrderStates, orderChanges, trackingCodeOf, trackingUrlOf } from './orders.js';
import { addSamples, isReverse, mergeRatios, samplesFromCard, summarizeRatios } from './ratios.js';
import { RELEASED } from './expdates.js';
import { expScore, mapRows, parseCsv } from './importcsv.js';
import { matchesQuery, matchesRarity, matchesTerms, normText, packImg, queryTerms, relevance, splitQuery, unpackImg } from './search.js';

const API = 'https://api.cardtrader.com/api/v2';
const PRICE_V = 12; // versione del calcolo dei prezzi della collezione: cambiandola si ricalcolano tutti (es. stime delle gradate)
const SCAN_EVERY_MS = 10_000; // CardTrader mette in cache leggermente le risposte: sotto i 10s non serve
// Limiti CardTrader: 200 richieste/10s in totale, ma sul marketplace la documentazione cita anche
// 1 richiesta al secondo. Restiamo prudenti: tutte le chiamate passano da un unico limitatore.
const MARKETPLACE_GAP_MS = 1200;
const OTHER_GAP_MS = 400;
const MIN_BACKOFF_MS = 30_000;
/** Numero della versione ("#024 Arbok · ..." -> 24). */
function buildNumber(b) {
  const m = /#(\d+)/.exec(String(b || ''));
  return m ? Number(m[1]) : 0;
}

const MARKET_PER_SCAN = 2;
const MARKET_MAX_SCAN = 6; // letture normali al massimo per giro, quando i gettoni avanzano
const FAST_SHARE = 0.5; // corsia veloce: quota dei gettoni di un giro riservata agli alert con la stella (il resto va agli altri)
const FAST_MIN_AGE_MS = 8_000; // una carta appena letta (anche dall'utente) non si rilegge subito
const DEALS_SETS = 10; // espansioni più recenti controllate per gli affari del giorno
const DEALS_EVERY_MS = 60_000; // una espansione ogni minuto
const DEALS_MAX_AGE_MS = 12 * 3600_000; // un affare più vecchio di così non si mostra più



/** Toglie gli annunci dei venditori esclusi dall'utente (e, se richiesto, di quelli segnalati da CardTrader). */
function withoutSellers(data, blocked, risky = false) {
  const out = {};
  for (const [bp, list] of Object.entries(data)) out[bp] = Array.isArray(list) ? list.filter((p) => !(p.user && blocked.has(p.user.username)) && !(risky && isRiskySeller(p))) : list;
  return out;
}
const CATALOG = 'main';
const STUCK_MS = 15 * 60_000;
const MKT_BUCKET = 9; // gettoni massimi: permette brevi raffiche (aprire qualche espansione di fila)
const MKT_RESERVE = 2; // gettoni che lo scan lascia sempre all'utente
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
  startedAt = Date.now(); // avvio del server: dopo un aggiornamento i controlli ripartono
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
        const err = new Error('Troppe richieste in poco tempo: riprovo al prossimo giro.');
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
      let now = Date.now();
      // Richieste aperte dall'utente: se la pausa chiesta da CardTrader è breve, aspettiamo invece di fallire.
      if (!background && this.blockedUntil > now && this.blockedUntil - now <= 45_000) {
        await sleep(this.blockedUntil - now + 200);
        now = Date.now();
      }
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

  // ---------- Scanner: dalla lettura della foto alle carte dell'indice ----------

  async identify(scan) {
    if (!scan || (!scan.name && !scan.number)) return { candidates: [] };
    const meta = await this.indexMeta();
    const exps = await this.pokemonExpansions().catch(() => []);
    const byId = new Map(exps.map((e) => [e.id, e]));
    const regMap = await this.regions().catch(() => ({}));
    const regionOf = (e) => regMap[e.id] || REGION_FIXED[e.id] || regionFromName(e.name || '') || '';
    const best = [];
    for (let i = 0; i < meta.have.length; i += 100) {
      const ids = meta.have.slice(i, i + 100);
      const got = await this.ctx.storage.get(ids.map((id) => `ix:${id}`));
      for (const [key, rows] of got) {
        const expId = parseInt(key.slice(3), 10);
        const e = byId.get(expId) || {};
        for (const r of rows) {
          const score = scoreRow(r, scan, e.code, e.name, regionOf(e), { era: vintageEra(expId) ? 'vintage' : 'modern' });
          // Con un nome letto serve che il nome corrisponda; senza, numero e totale esatti.
          const nameOk = !scan.name || normText(r[1]).split(' ').some((w) => normText(scan.name).split(' ').includes(w));
          // Sotto 8 teniamo solo chi ha il nome giusto: serve quando il numero è letto male (es. carte cinesi).
          // Nome tradotto diverso (es. "Lucinda" = Dawn): basta numero, totale e codice del set esatti.
          // Numero e totale esatti (con la lingua compatibile) bastano anche senza codice del set.
          const byNumber = !nameOk && scan.number && scan.total
            && scoreRow(r, { number: scan.number, total: scan.total }, '', '') >= 8 // numero E totale esatti
            && scoreRow(r, { language: scan.language }, '', e.name, regionOf(e)) >= 0; // lingua non in contrasto
          if (!byNumber && (!nameOk || score < (scan.name ? 5 : 8))) continue;
          const numHit = !scan.number || scoreRow(r, { number: scan.number }, '', '') > 0;
          best.push({ score: byNumber ? Math.max(score, 8) : score, numHit, id: r[0], name: r[1], version: r[2] || null, image: unpackImg(r[0], r[4]), expansionId: expId, expName: e.name || '', expCode: e.code || '' });
        }
      }
    }
    best.sort((a, b) => b.score - a.score || b.expansionId - a.expansionId);
    // Se c'è almeno una corrispondenza piena mostriamo solo quelle; altrimenti le carte con lo stesso nome.
    const strong = best.filter((x) => x.score >= 8 && x.numHit);
    return { exact: strong.length > 0, candidates: (strong.length ? strong : best).slice(0, strong.length ? 6 : 12).map(({ numHit, ...c }) => c), indexComplete: !!meta.complete };
  }

  /**
   * Importazione: per ogni riga del file le carte dell'indice che corrispondono.
   * status: 'found' (una sola carta sicura), 'choose' (più carte possibili), 'none'.
   */
  async matchImport(items) {
    const meta = await this.indexMeta();
    const exps = await this.pokemonExpansions().catch(() => []);
    const byId = new Map(exps.map((e) => [e.id, e]));
    const ix = new Map();
    for (let i = 0; i < meta.have.length; i += 100) {
      const got = await this.ctx.storage.get(meta.have.slice(i, i + 100).map((id) => `ix:${id}`));
      for (const [k, rows] of got) ix.set(parseInt(k.slice(3), 10), rows);
    }
    const bpIndex = new Map();
    const card = (r, expId) => {
      const e = byId.get(expId) || {};
      return { id: r[0], name: r[1], version: r[2] || null, image: unpackImg(r[0], r[4]), expansionId: expId, expName: e.name || '' };
    };
    if (items.some((it) => it.bp)) for (const [expId, rows] of ix) for (const r of rows) bpIndex.set(r[0], card(r, expId));
    return items.map((it) => {
      if (it.bp && bpIndex.has(it.bp)) return { ...it, status: 'found', candidates: [bpIndex.get(it.bp)] };
      // Espansioni che somigliano a quanto scritto; se non c'è o non somiglia a nulla, tutte.
      let expIds = [...ix.keys()];
      if (it.set) {
        const scored = exps.map((e) => [e.id, expScore(it.set, e)]).filter(([id, sc]) => sc >= 4 && ix.has(id)).sort((a, b) => b[1] - a[1]);
        if (scored.length) { const top = scored[0][1]; expIds = scored.filter(([, sc]) => sc >= top - 2).map(([id]) => id).slice(0, 8); }
      }
      const scan = { name: it.name, number: it.number, total: it.total, language: it.lang === 'jp' ? 'jp' : it.lang === 'ko' || it.lang === 'zh' ? it.lang : '' };
      const best = [];
      for (const expId of expIds) {
        const e = byId.get(expId) || {};
        for (const r of ix.get(expId) || []) {
          const sc = scoreRow(r, scan, e.code, e.name);
          const nameOk = !it.name || normText(r[1]).split(' ').some((w) => normText(it.name).split(' ').includes(w));
          // Nome scritto male: basta il numero completo (numero/totale), e la carta finisce tra quelle da scegliere.
          if ((nameOk && sc >= 4) || (it.number && it.total && sc >= 8)) best.push({ sc, c: card(r, expId) });
        }
      }
      best.sort((a, b) => b.sc - a.sc);
      const top = best.slice(0, 5);
      // Sicura: punteggio alto (nome + numero) e nessun'altra carta vicina.
      const sure = top.length && top[0].sc >= 9 && (top.length === 1 || top[0].sc - top[1].sc >= 3);
      return { ...it, status: !top.length ? 'none' : sure ? 'found' : 'choose', candidates: (sure ? top.slice(0, 1) : top).map((x) => x.c) };
    });
  }

  /**
   * Righe degli ordini CardTrader (come compratore) pronte per la collezione. Si leggono al momento, non si salvano.
   * Le carte già importate da un ordine (ordImp) non si riproporranno; quelle che sembrano già in collezione (stesso
   * blueprint e stessa lingua, magari aggiunte a mano) sono segnate con dup, così l'utente sceglie.
   */
  async importableFromOrders(includeDone = false) {
    const asList = (raw) => (Array.isArray(raw) ? raw : (raw && (raw.array || raw.orders || raw.data)) || []);
    const orders = [];
    for (let page = 1; page <= 10; page++) {
      const list = asList(await this.ct(`/orders?${new URLSearchParams({ order_as: 'buyer', limit: '20', page: String(page), sort: 'date.desc' })}`));
      orders.push(...list);
      if (list.length < 20) break;
    }
    const imported = new Set(await this.get('ordImp', []));
    const coll = await this.get('coll', []);
    const owned = new Set(coll.map((c) => `${c.bp}|${c.lang || ''}`));
    const items = [];
    for (const o of orders) {
      if (!o || o.state === 'canceled' || o.state === 'lost') continue;
      for (const it of Array.isArray(o.order_items) ? o.order_items : []) {
        if (!it || it.deleted_at || it.graded || !it.blueprint_id) continue; // le gradate non hanno il voto negli ordini: si aggiungono a mano
        const pr = it.properties || {};
        const iid = Number(it.id);
        const lang = normLang(pr.pokemon_language) || '';
        const row = {
          iid, oid: o.id, code: o.code || null, date: o.paid_at || null, state: o.state || null,
          bp: Number(it.blueprint_id), name: it.name || it.name_en || 'Carta', expansion: expansionNameOf(it), qty: it.quantity || 1,
          cents: it.buyer_price ? it.buyer_price.cents : null, condition: CONDITIONS.includes(pr.condition) ? pr.condition : '', lang,
          first: pr.first_edition === true, reverse: pr.pokemon_reverse === true, cmId: it.mkm_id || null,
          done: imported.has(iid), dup: owned.has(`${Number(it.blueprint_id)}|${lang}`),
        };
        if (row.done && !includeDone) continue;
        items.push(row);
      }
    }
    return { items, orders: orders.length };
  }

  /**
   * Prezzo (centesimi) con cui una carta nuova entrerebbe in collezione, dagli annunci già letti; null se ancora non si sa.
   * Serve per la soglia "valore minimo in collezione": senza prezzo noto la carta entra (la nasconde poi la vista).
   */
  async knownCents(bp, lang, cond, first, reverse) {
    const hit = this.bpCache.get(bp);
    if (!hit || (hit.slim && (first || reverse || parseGradeLabel(cond)))) return null;
    const blocked = new Set((await this.get('sellers', { fav: [], block: [] })).block);
    const reliable = (await this.settings()).collReliable !== false;
    const pr = priceFor(hit.data[bp] || hit.data[String(bp)], lang, cond, { blocked, first, reverse, reliable });
    return pr && pr.cents != null ? pr.cents : null;
  }

  /** Aggiunge molte carte in una volta (importazione): una sola scrittura, prezzi letti dal giro in background. */
  async collectionImport(list) {
    const coll = await this.get('coll', []);
    const plan = await this.plan();
    let added = 0;
    let merged = 0;
    let limited = 0;
    let skipped = 0;
    const min = Number((await this.settings()).collMinCents) || 0;
    const skippedNames = [];
    for (const b of list.slice(0, 2000)) {
      const bp = parseInt(b.bp, 10);
      if (!Number.isInteger(bp) || bp <= 0) continue;
      const lang = normLang(b.lang) || '';
      const cond = CONDITIONS.includes(b.cond) || parseGradeLabel(b.cond) ? b.cond : ''; // condizione o voto ('PSA 10')
      const first = !!b.first;
      const reverse = !!b.reverse;
      const key = collKey(bp, lang, cond, first, reverse);
      const qty = Math.max(1, Math.min(999, parseInt(b.qty, 10) || 1));
      // 0 è un prezzo valido (carta trovata in una busta): "nessun prezzo" è solo null o vuoto.
      const paid = b.paidCents != null && b.paidCents !== '' && Number(b.paidCents) >= 0 ? Math.round(Number(b.paidCents)) : null;
      const prev = coll.find((c) => c.key === key);
      if (prev) {
        const total = Math.min(999, prev.qty + qty);
        if (paid != null) prev.paidCents = prev.paidCents != null ? Math.round((prev.paidCents * prev.qty + paid * qty) / (prev.qty + qty)) : paid;
        prev.qty = total;
        merged++;
        continue;
      }
      if (coll.length >= plan.maxColl) { limited++; continue; }
      if (min > 0 && !parseGradeLabel(cond)) {
        const cents = await this.knownCents(bp, lang, cond, first, reverse);
        if (cents != null && cents < min) { if (skippedNames.length < 5) skippedNames.push(String(b.name || '').slice(0, 60)); skipped++; continue; }
      }
      coll.unshift({
        key, bp, lang, cond, qty, paidCents: paid ?? 0, // senza prezzo = trovata (0 €)
        ...(first ? { first: true } : {}), ...(reverse ? { reverse: true } : {}),
        name: String(b.name || '').slice(0, 120),
        image: /^https:\/\//.test(b.image || '') ? String(b.image).slice(0, 300) : null,
        expansionId: parseInt(b.expansionId, 10) || null,
        expName: String(b.expName || '').slice(0, 80),
        cmId: parseInt(b.cmId, 10) || null,
        ts: Date.now(),
      });
      added++;
    }
    await this.ctx.storage.put('coll', coll);
    return { added, merged, limited, limit: plan.maxColl, skipped, skippedNames, min };
  }

  // ---------- Collezione ----------

  async collectionUpsert(b) {
    const bp = parseInt(b && b.bp, 10);
    if (!Number.isInteger(bp) || bp <= 0) return { error: 'Carta mancante' };
    const lang = normLang(b.lang) || '';
    const cond = CONDITIONS.includes(b.cond) || parseGradeLabel(b.cond) ? b.cond : ''; // condizione o voto ('PSA 10')
    const first = !!b.first;
    const reverse = !!b.reverse;
    const key = collKey(bp, lang, cond, first, reverse);
    const coll = await this.get('coll', []);
    const i = coll.findIndex((c) => c.key === key);
    const prev = i >= 0 ? coll[i] : null;
    let qty = Math.max(0, Math.min(999, parseInt(b.qty, 10) || 0));
    if (b.add && prev) qty += prev.qty;
    if (!qty) {
      if (i >= 0) coll.splice(i, 1);
    } else {
      if (!prev && b.checkMin) {
        const min = Number((await this.settings()).collMinCents) || 0;
        const cents = min > 0 && !parseGradeLabel(cond) ? await this.knownCents(bp, lang, cond, first, reverse) : null;
        if (cents != null && cents < min) return { skipped: true, min, cents };
      }
      if (!prev) {
        const plan = await this.plan();
        if (coll.length >= plan.maxColl) return { error: `Il piano ${plan.label} include ${plan.maxColl} carte diverse nella collezione.`, upgrade: true, status: 403 };
      }
      const paid = b.paidCents != null && b.paidCents !== '' && Number.isFinite(Number(b.paidCents)) && Number(b.paidCents) >= 0 ? Math.round(Number(b.paidCents)) : null;
      // Prezzo pagato: media ponderata quando si aggiungono copie con un prezzo nuovo.
      // Senza prezzo pagato la carta conta come trovata (0 €).
      const paidCents = paid == null ? (prev && prev.paidCents != null ? prev.paidCents : 0)
        : b.add && prev && prev.paidCents != null ? Math.round((prev.paidCents * prev.qty + paid * (qty - prev.qty)) / qty) : paid;
      const item = {
        key, bp, lang, cond, qty, paidCents, ...(first ? { first: true } : {}), ...(reverse ? { reverse: true } : {}),
        ...((b.cmPrice === undefined ? prev && prev.cmPrice : b.cmPrice) ? { cmPrice: true } : {}),
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
    // Carta appena aggiunta senza prezzo: leggiamo subito i suoi annunci (una richiesta) invece di aspettare il giro orario.
    // Carta appena aggiunta senza prezzo: la lettura parte subito ma senza far aspettare la risposta
    // (se CardTrader chiede di rallentare potrebbe volerci qualche secondo): il prezzo arriva da solo.
    // In "background": se non ci sono letture libere non insiste (niente 429 aggiungendo molte carte di fila);
    // la carta senza prezzo viene letta dal giro appena le carte degli alert sono aggiornate.
    if (qty && !(await this.get('collPrices', {}))[key]) this.productsForCard(bp, 10 * 60_000, true).then(() => this.collectionPrices(true)).catch(() => null);
    await this.collectionPrices(true);
    await this.ensureAlarm();
    return { ok: true };
  }

  /** Aggiorna i prezzi della collezione con gli annunci già letti e salva un punto al giorno del valore. */
  async collectionPrices(force = false) {
    const coll = await this.get('coll', []);
    if (!coll.length) return;
    const prices = await this.get('collPrices', {});
    // I venditori esclusi dall'utente non contano neanche per il valore della collezione.
    const blocked = new Set((await this.get('sellers', { fav: [], block: [] })).block);
    const ratios = await this.marketRatios().catch(() => null);
    const reliable = (await this.settings()).collReliable !== false;
    const histTodo = [];
    let changed = false;
    for (const c of coll) {
      const hit = this.bpCache.get(c.bp);
      if (!hit) continue;
      // Gradate e 1ª edizione hanno bisogno degli annunci completi (voto e edizione sono nel commento):
      // con la versione leggera salvata su disco si aspetta la prossima lettura vera.
      if (hit.slim && (c.first || c.reverse || parseGradeLabel(c.cond))) continue;
      const old = prices[c.key];
      if (!force && old && old.ts >= hit.ts && old.v === PRICE_V) continue;
      const era = c.expansionId && vintageEra(Number(c.expansionId)) ? 'vintage' : 'modern';
      const pr = priceFor(hit.data[c.bp] || hit.data[String(c.bp)], c.lang, c.cond, { blocked, first: !!c.first, reverse: !!c.reverse, ratios, era, reliable });
      prices[c.key] = pr ? { ...pr, ts: hit.ts, v: PRICE_V } : { cents: null, ts: hit.ts, v: PRICE_V };
      // Prezzo precedente (per "cosa è cambiato"): si tiene quello di prima dell'ultimo cambio, per 24 ore.
      if (old && old.cents != null && pr) {
        const keys = ['cents', 'typCents', 'zeroCents', 'zeroTypCents'];
        const differs = keys.some((k) => (old[k] ?? null) !== (pr[k] ?? null));
        if (differs) { prices[c.key].prev = Object.fromEntries(keys.map((k) => [k, old[k] ?? null])); prices[c.key].changedAt = Date.now(); }
        else if (old.prev && Date.now() - (old.changedAt || 0) < 24 * 3600_000) { prices[c.key].prev = old.prev; prices[c.key].changedAt = old.changedAt; }
      }
      if (pr) histTodo.push(c.key);
      changed = true;
    }
    // Storico del valore di ogni copia: un prezzo crollato rispetto agli ultimi 30 giorni si considera anomalo.
    if (histTodo.length) {
      const day = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < histTodo.length; i += 100) {
        const keys = histTodo.slice(i, i + 100);
        const got = await this.ctx.storage.get(keys.map((k) => `cvh:${k}`));
        const put = {};
        for (const k of keys) {
          const prev = got.get(`cvh:${k}`) || [];
          const { pr, hist } = checkAgainstHistory(prices[k], prev, day);
          prices[k] = pr;
          if (hist !== prev) put[`cvh:${k}`] = hist;
        }
        if (Object.keys(put).length) await this.ctx.storage.put(put);
      }
    }
    // Gradate senza nessun annuncio su CardTrader: stima dalla tendenza Cardmarket della carta.
    // Senza annunci su CardTrader (gradate, o carte già lette e senza annunci): si parte dalla tendenza Cardmarket.
    const noListings = (c) => prices[c.key] && prices[c.key].cents == null && prices[c.key].v === PRICE_V;
    const noPrice = coll.filter((c) => (parseGradeLabel(c.cond) || noListings(c)) && !(prices[c.key] && prices[c.key].cents != null));
    let collChanged = false;
    for (const c of noPrice) {
      if (c.cmId || !c.expansionId) continue;
      // Carte aggiunte da scansione o import: l'id Cardmarket si prende dal catalogo dell'espansione.
      const saved = await this.get(`bp4:${c.expansionId}`, null);
      const b = saved && saved.list && saved.list.find((x) => x.id === c.bp);
      if (b && b.cm) { c.cmId = b.cm; collChanged = true; }
    }
    if (collChanged) await this.ctx.storage.put('coll', coll);
    for (let k = noPrice.length - 1; k >= 0; k--) if (!noPrice[k].cmId) noPrice.splice(k, 1);
    if (noPrice.length) {
      const cmG = await this.cmLookup(noPrice.map((c) => c.cmId));
      for (const c of noPrice) {
        const e = cmG.get(c.cmId);
        if (!e || !e.trend) continue;
        const base = Math.round(e.trend * 100);
        const grade = parseGradeLabel(c.cond);
        const cents = grade ? gradedFromBase(base, grade) : base;
        prices[c.key] = { cents, typCents: cents, approx: true, estimated: true, fromCm: true, rawCents: base, listings: 0, graded: grade ? c.cond : null, zeroCents: null, zeroTypCents: null, zeroApprox: null, ts: Date.now(), v: PRICE_V };
        changed = true;
      }
    }
    if (!changed) return;
    await this.ctx.storage.put('collPrices', prices);
    const typical = !!(await this.settings()).collTypical;
    const cm = await this.cmLookup(coll.map((c) => c.cmId).filter(Boolean));
    const base = (zeroOnly) => coll.map((c) => {
      const e = c.cmId && cm.get(c.cmId);
      const cmC = e && e.trend ? Math.round(e.trend * 100) : null;
      let price = prices[c.key] && prices[c.key].cents != null ? pickPrice(prices[c.key], zeroOnly, typical) : null;
      if (c.cmPrice && cmCappable(c)) price = useCmPrice(price, cmC);
      return { ...c, price, cmCents: cmC };
    });
    const minCents = Number((await this.settings()).collMinCents) || 0;
    const live = (arr) => (minCents > 0 ? arr.filter((it) => !(it.price && it.price.cents != null && it.price.cents < minCents)) : arr);
    const items = base(false);
    const sum = summarize(live(items));
    const sumZero = summarize(live(base(true)));
    const hist = await this.get('collHist', []);
    const d = new Date().toISOString().slice(0, 10);
    const point = { d, value: sum.value, valueZero: sumZero.value, cm: sum.cm, qty: sum.qty };
    if (hist.length && hist[hist.length - 1].d === d) hist[hist.length - 1] = point; else hist.push(point);
    await this.ctx.storage.put('collHist', hist.slice(-400));
  }

  async collectionView() {
    const zeroOnly = !!(await this.settings()).collZero;
    const typical = !!(await this.settings()).collTypical;
    const coll = await this.get('coll', []);
    // Carte salvate senza prezzo pagato: da ora contano come trovate (0 €).
    if (coll.some((c) => c.paidCents == null)) {
      for (const c of coll) if (c.paidCents == null) c.paidCents = 0;
      await this.ctx.storage.put('coll', coll);
    }
    // Prezzi salvati prima delle opzioni Zero/tipico: rileggiamo subito gli annunci di quelle carte
    // (al massimo 10 per apertura, il resto al giro orario) e ricalcoliamo.
    let refreshing = 0;
    {
      const old = await this.get('collPrices', {});
      // Da rileggere: prezzi senza "tipico" (con Zero/tipico attivi) e, sempre, gradate e 1ª edizione calcolate con una versione vecchia.
      const stale = coll.filter((c) => ((zeroOnly || typical) && (!old[c.key] || (!(old[c.key].cents == null && old[c.key].v === PRICE_V) && !('typCents' in old[c.key]))))
        || ((c.first || c.reverse || parseGradeLabel(c.cond) || (old[c.key] && old[c.key].approx)) && (!old[c.key] || old[c.key].v !== PRICE_V))).slice(0, 5);
      refreshing = stale.length;
      if (stale.length && !this.collRefreshing) {
        // In sottofondo: la risposta arriva subito e la pagina si aggiorna da sola quando i prezzi sono pronti.
        this.collRefreshing = true;
        this.ctx.waitUntil((async () => {
          try {
            for (const c of stale) {
              // In "background": usa solo letture libere, così gli alert hanno sempre la precedenza.
              await this.productsForCard(c.bp, 60 * 60_000, true, { full: true }).catch(() => null);
              await this.collectionPrices(true).catch(() => null);
            }
          } finally {
            this.collRefreshing = false;
          }
        })());
      }
    }
    const prices = await this.get('collPrices', {});
    const cm = await this.cmLookup(coll.map((c) => c.cmId).filter(Boolean));
    const plan = await this.plan();
    const items = coll.map((c) => {
      const p = prices[c.key];
      const e = c.cmId && cm.get(c.cmId);
      const cmC = e && e.trend ? Math.round(e.trend * 100) : null;
      let price = p && p.cents != null ? pickPrice(p, zeroOnly, typical) : null;
      if (c.cmPrice && cmCappable(c)) price = useCmPrice(price, cmC);
      // Variazione recente del valore di questa copia (con le stesse impostazioni Zero/tipico), ultime 24 ore.
      let delta = null;
      if (price && p.prev && Date.now() - (p.changedAt || 0) < 24 * 3600_000) {
        const before = pickPrice({ ...p, ...p.prev }, zeroOnly, typical);
        if (before && before.cents != null && before.cents !== price.cents) delta = { cents: price.cents - before.cents, at: p.changedAt };
      }
      return { ...c, price, noListings: !!(p && p.cents == null && p.ts), delta, cmCents: cmC };
    });
    // Variazione a 7 giorni dallo storico prezzi della carta (prezzo più basso in assoluto).
    for (const it of items) {
      const h = await this.get(`h:${it.bp}`, []);
      const old = h.length > 1 ? h[Math.max(0, h.length - 8)] : null;
      const last = h[h.length - 1];
      it.change7 = old && last && old.min ? last.min / old.min - 1 : null;
      it.spark30 = h.slice(-30).map((x) => x.min || null);
    }
    // Soglia "valore minimo in collezione": le copie sotto soglia restano ma si nascondono e non contano nel valore.
    const minCents = Number((await this.settings()).collMinCents) || 0;
    if (minCents > 0) for (const it of items) if (it.price && it.price.cents != null && it.price.cents < minCents) it.belowMin = true;
    const visible = items.filter((it) => !it.belowMin);
    const hist = (await this.get('collHist', [])).slice(-plan.historyDays).map((h) => (zeroOnly ? { ...h, value: h.valueZero ?? null } : h));
    const reliable = (await this.settings()).collReliable !== false;
    return { items, summary: summarize(visible), hidden: items.length - visible.length, minCents, history: hist, limit: plan.maxColl, unlimited: plan.unlimited, zeroOnly, typical, reliable, refreshing };
  }

  async reportError(where, err) {
    try {
      const acc = await this.get('account', null);
      const message = String((err && (err.stack || err.message)) || err).split('\n').slice(0, 3).join(' · ');
      const reg = this.env.REGISTRY.get(this.env.REGISTRY.idFromName('registry'));
      const r = await reg.fetch('https://reg/error', { method: 'POST', body: JSON.stringify({ where, message, user: acc ? acc.userId : null }) }).then((x) => x.json());
      if (r.notify) await this.catalog().fetch('https://do.internal/api/_ownerNotice', { method: 'POST', body: JSON.stringify({ text: `${where}: ${message.slice(0, 160)}` }) });
    } catch {
      // il registro errori non deve mai bloccare lo scan
    }
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
      regions: (status && status.regions) || null,
      regionError: (status && status.regionError) || null,
      deals: await this.dealsInfo(m, status),
    };
  }

  /** Stato del giro degli affari del giorno, per Opzioni. */
  async dealsInfo(ixmeta, status) {
    const idx = await this.get('ddIdx', {});
    const st = await this.get('ddState', { i: 0, ts: 0 });
    const sv = await this.get('svIdx', {});
    const total = ixmeta && ixmeta.have ? ixmeta.have.length : null;
    return {
      fresh: Object.values(idx).filter((t) => Date.now() - t < DEALS_MAX_AGE_MS).length,
      everRead: Object.keys(idx).length,
      total,
      probed: Object.keys(sv).length,
      lastTs: st.ts || null,
      last: st.last || null,
      error: (status && status.dealsError) || null,
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
      // Per capire se il giro degli alert è lento: letture fatte nell'ultima ora e come è andato l'ultimo giro.
      reads: {
        hour: [...((this.readLog && this.readLog.values()) || [])].reduce((t, l) => t + l.filter((x) => Date.now() - x < 3600_000).length, 0),
        last: (status && status.lastRefresh) || null,
      },
      // Perché una notifica push non arriva: dispositivi iscritti ed esito dell'ultimo invio.
      push: { subs: (await this.get('subs', [])).length, last: await this.get('pushLast', null) },
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
    // Tempo massimo per risposta: una richiesta appesa non deve bloccare la coda (e quindi lo scan).
    const res = await fetch((this.env.CARDTRADER_API || API) + path, {
      headers: { Authorization: `Bearer ${await this.token()}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(25_000),
    });
    if (res.status === 429) {
      const retry = parseInt(res.headers.get('retry-after'), 10);
      // 429 di fila: la pausa raddoppia (30s, 1 min, poi massimo 2) finché CardTrader non risponde di nuovo.
      // Più lunga di così fermava gli alert per molti minuti dopo qualche apertura di troppo dall'app.
      if (Date.now() - (this.lastStrikeAt || 0) > 10 * 60_000) this.strikes = 0;
      this.lastStrikeAt = Date.now();
      this.strikes = (this.strikes || 0) + 1;
      if (path.startsWith('/marketplace')) {
        this.mktGap = Math.min(MKT_GAP_MAX, Math.round(this.mktGap * 1.5));
        this.okStreak = 0;
        this.tokens = 0;
        this.recent429 = [...this.recent429, { ts: Date.now(), path: path.split('&')[0] }].slice(-10);
        await this.ctx.storage.put('mktGap', this.mktGap);
      }
      const backoff = Math.min(MIN_BACKOFF_MS * 2 ** (this.strikes - 1), 2 * 60_000);
      const pause = Math.max(backoff, Number.isFinite(retry) ? retry * 1000 : 0);
      this.blockedUntil = Date.now() + pause;
      const err = new Error(`CardTrader sta limitando le richieste: riprovo tra ${Math.round(pause / 1000)}s`);
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
    if (!res.ok) {
      // Messaggi per l'utente, senza codici tecnici (il codice resta in err.status per il registro).
      const err = new Error(res.status === 401 || res.status === 403 ? 'CardTrader non accetta più il tuo token: esci e rientra con un token nuovo.'
        : res.status === 404 ? 'CardTrader non trova questa carta o espansione: potrebbe essere stata rimossa.'
        : res.status >= 500 ? 'CardTrader non risponde in questo momento: riprovo da solo tra poco.'
        : 'CardTrader ha rifiutato la richiesta: riprova tra poco.');
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // ---------- HTTP ----------

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // Se il Worker è più nuovo di questo server dati (deploy appena fatto), ci riavviamo per caricare
    // il codice nuovo: la richiesta risponde 503 e il Worker la ripete subito.
    const wb = buildNumber(req.headers.get('x-build'));
    if (wb && wb > buildNumber(BUILD)) {
      setTimeout(() => this.ctx.abort('nuova versione'), 50);
      return new Response(JSON.stringify({ error: 'Aggiornamento in corso: riprova tra qualche secondo.' }), { status: 503, headers: { 'content-type': 'application/json', 'x-stale': '1' } });
    }

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
      if (!(await this.isCatalog())) return json({ error: 'Pagina non trovata: ricarica l’app.' }, 404);
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

    if (path === '/api/_identify' && method === 'POST') {
      return json(await this.identify(await req.json()));
    }

    if (path === '/api/_scanquota' && method === 'POST') {
      // Scansioni del mese: { check: true } controlla e conta una scansione.
      const plan = await this.plan();
      const month = new Date().toISOString().slice(0, 7);
      const q = await this.get('scanQuota', { month, used: 0 });
      if (q.month !== month) Object.assign(q, { month, used: 0 });
      if ((await req.json().catch(() => ({}))).refund) {
        // Scansione non riuscita: non conta.
        q.used = Math.max(0, q.used - 1);
        await this.ctx.storage.put('scanQuota', q);
        return json({ ok: true, used: q.used, limit: plan.maxScans });
      }
      if (q.used >= plan.maxScans) return json({ ok: false, used: q.used, limit: plan.maxScans, plan: plan.label });
      q.used++;
      await this.ctx.storage.put('scanQuota', q);
      return json({ ok: true, used: q.used, limit: plan.maxScans });
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
        n429: this.recent429.filter((x) => Date.now() - x.ts < 3600_000).length,
        gapMs: this.mktGap,
        lastMarketOk: status.lastMarketOk || null,
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
    if (xdo && !['/api/search', '/api/index/refresh', '/api/deals', '/api/collection/match'].includes(path) && !(await this.ctx.storage.get('doName'))) await this.ctx.storage.put('doName', xdo);
    const mine = !xdo || xdo === (await this.get('doName', CATALOG));
    const planHeader = mine ? req.headers.get('x-plan') : null;
    if (planHeader && planHeader !== (await this.get('plan', null))) {
      await this.ctx.storage.put('plan', planHeader);
      this.planCache = null;
    }

    if (path === '/api/latest' && method === 'GET') {
      const alerts = await this.get('alerts', []);
      // L'ultima cosa da notificare: un avviso, un problema dello scan o il riepilogo del mattino.
      const batch = await this.get('lastBatch', null);
      const group = batch && Date.now() - batch.ts < 120_000 && alerts[0] && alerts[0].ts <= batch.ts ? { kind: 'group', id: `group-${batch.ts}`, ts: batch.ts + 1, n: batch.n, top: batch.top } : null;
      const items = [group || alerts[0], await this.get('notice', null), await this.get('summaryNotice', null), await this.get('orderNotice', null), await this.get('ownerNotice', null), await this.get('testAlert', null)].filter(Boolean);
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
      const [rules, alertsAll, status, subs] = await Promise.all([
        this.get('rules', []),
        this.get('alerts', []),
        this.status(),
        this.get('subs', []),
      ]);
      const alerts = alertsAll.filter((a) => !a.test); // le notifiche di prova non si mostrano
      const rulesAll = await this.get('rules', []);
      return json({
        rules,
        checks: (await this.loadReadLog(), this.ruleChecks(rules)),
        alerts: alerts.slice(0, 60),
        status,
        pushDevices: subs.length,
        outOfPlan: ((inPlan) => rules.filter((r) => r.enabled && !inPlan.has(r.id)).map((r) => r.id))(rulesInPlan(rules, await this.plan())),
        account: { name: decodeURIComponent(req.headers.get('x-user-name') || '') || ((await this.get('account', null)) || {}).name || '', plan: await this.plan() },
        bought: await this.get('bought', []),
        sellers: await this.get('sellers', { fav: [], block: [] }),
        settings: await this.settings(),
        system: await this.systemInfo(status),
        vapidPublic: (await this.vapid()).publicKey,
        conditions: CONDITIONS,
        wish: await Promise.all((await this.get('wish', [])).map(async (w) => {
          const h = await this.get(`h:${w.id}`, []);
          // Lingua del desiderio: quella scelta quando l'hai aggiunto, altrimenti quella del tuo alert sulla stessa carta.
          if (!w.lang) { const r = rulesAll.find((x) => Number(x.blueprintId) === Number(w.id) && x.language); if (r) w = { ...w, lang: normLang(String(r.language).split(',')[0]) || '' }; }
          // "Da" = prezzo più basso di adesso dagli annunci in memoria; lo storico (minimo del giorno) solo se non ci sono.
          const hit = this.bpCache.get(w.id);
          const now = hit && Date.now() - hit.ts < 3 * 3600_000 ? currentLow(hit.data[w.id] || hit.data[String(w.id)], w.lang) : null;
          // Con una lingua lo storico (tutte le lingue) non vale: si mostra solo il prezzo attuale in quella lingua.
          const read = !!(hit && Date.now() - hit.ts < 3 * 3600_000);
          return { ...w, read, last: now || (w.lang ? null : h[h.length - 1] || null), prev: w.lang ? null : h[h.length - 8] || h[0] || null };
        })),
      });
    }

    if (path === '/api/_regions') return json(await this.get('expRegion', {}));
    if (path === '/api/_ratios') return json(await this.get('ratios', {}));
    if (path === '/api/ratios' && method === 'GET') { this.ratioCache = null; return json(await this.marketRatios()); }
    // Espansioni senza regione (senza annunci o con errore): il proprietario può indicarla a mano.
    if (path === '/api/regions/problems' && method === 'GET') {
      return json(await this.openRegionProblems());
    }
    if (path === '/api/regions/set' && method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const id = parseInt(b.id, 10);
      if (!Number.isInteger(id) || !['INT', 'JAP', 'CN', 'KR', 'Asia'].includes(b.region)) return json({ error: 'Regione non valida' }, 400);
      await this.saveRegion(id, b.region);
      const problems = await this.get('regionProblems', {});
      delete problems[id];
      await this.ctx.storage.put('regionProblems', problems);
      await this.refreshRegionCounts(await this.status());
      return json({ ok: true });
    }
    if (path === '/api/_region' && method === 'POST') {
      const b = await req.json().catch(() => ({}));
      if (Number.isInteger(b.id) && ['INT', 'JAP', 'CN', 'KR', 'Asia'].includes(b.region)) await this.saveRegion(b.id, b.region);
      return json({ ok: true });
    }

    if (path === '/api/expansions' && method === 'GET') {
      try {
        const [list, map] = await Promise.all([this.pokemonExpansions(), this.regions()]);
        return json(list.map((e) => ({ ...e, region: map[e.id] || REGION_FIXED[e.id] || regionFromName(e.name), vintage: vintageEra(e.id), released: RELEASED[e.id] || null })));
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }

    if (path === '/api/cards' && method === 'GET') {
      const id = parseInt(url.searchParams.get('expansion_id'), 10);
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'Espansione non indicata: ricarica l’app e riprova.' }, 400);
      try {
        this.bumpExpansion(id, 1);
        return json(await this.cardsFor(id));
      } catch (e) {
        // CardTrader chiede una pausa: se abbiamo già le carte di questo set (anche non freschissime) mostriamo quelle.
        const stale = this.cardCache.get(id);
        if (stale && stale.data) return json({ ...stale.data, stale: true });
        return json({ error: String(e.message || e) }, e.rateLimited || /riprovo tra/.test(String(e.message)) ? 429 : 502);
      }
    }

    if (path === '/api/settings' && method === 'POST') {
      const next = cleanSettings(await req.json(), await this.settings());
      await this.ctx.storage.put('settings', next);
      if (!next.paused) await this.ensureAlarm();
      return json(next);
    }

    if (path === '/api/export/full' && method === 'GET') {
      // Tutti i dati dell'utente (diritto alla portabilità). Il token CardTrader non viene mai incluso.
      const keys = ['rules', 'wish', 'coll', 'collPrices', 'collHist', 'alerts', 'bought', 'sellers'];
      const out = { app: 'snipe', version: 2, exportedAt: new Date().toISOString(), settings: await this.settings() };
      for (const k of keys) out[k] = await this.get(k, k === 'sellers' ? { fav: [], block: [] } : k === 'collPrices' ? {} : []);
      const acc = await this.get('account', null);
      out.account = acc ? { userId: acc.userId, name: acc.name, since: acc.since } : null;
      return json(out);
    }

    if (path === '/api/_ownerNotice' && method === 'POST') {
      // Errore del servizio da segnalare al proprietario (solo il server dati 'main').
      const b = await req.json();
      await this.ctx.storage.put('ownerNotice', { id: `err:${Date.now()}`, ts: Date.now(), kind: 'system', name: 'errore del servizio', text: String(b.text || '').slice(0, 300) });
      await this.notify(true);
      return json({ ok: true });
    }

    if (path === '/api/_wipe' && method === 'POST') {
      // Cancellazione account: elimina tutti i dati di questo server dati.
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.tokenCache = undefined;
      this.planCache = null;
      this.statusMem = null;
      this.bpCache.clear();
      this.productCache.clear();
      return json({ ok: true });
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
      const parsed = splitQuery(url.searchParams.get('q') || '');
      if (parsed.words.join('').length < 3 && !parsed.nums.length) return json({ error: parsed.rarity.length ? 'Aggiungi il nome della carta alla rarità (es. "Charizard sar")' : 'Scrivi almeno 3 lettere' }, 400);
      try {
        await this.startIndexIfNeeded();
        return json(await this.searchIndex(parsed.words, parsed));
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }

    if (path === '/api/explain' && method === 'GET') {
      let rule = (await this.get('rules', [])).find((r) => r.id === url.searchParams.get('rule_id'));
      const reliable = (await this.settings()).collReliable !== false;
      if (!rule) return json({ error: 'Questo alert non esiste più: ricarica l’app.' }, 404);
      try {
        let cmTrend = null;
        if (rule.cmDiscount && rule.cmId) {
          const e = (await this.cmLookup([rule.cmId])).get(rule.cmId);
          if (!e) return json({ rows: [], total: 0, note: 'Per questa carta non c’è un prezzo Cardmarket: l’alert non può scattare.' });
          cmTrend = e.trend;
          rule = { ...rule, maxPriceCents: maxCentsBelow(e.trend, rule.cmDiscount) };
        }
        // Diagnostica: cosa vedeva lo scan in background PRIMA di questa lettura, e cosa ricorda già.
        const expHit = this.productCache.get(rule.expansionId);
        const bpHit = rule.blueprintId && this.bpCache.get(rule.blueprintId);
        const scanTs = Math.max(expHit ? expHit.ts : 0, bpHit ? bpHit.ts : 0) || null;
        const seenMap = await this.get('seen', {});
        const seenCount = Object.keys(seenMap).filter((k) => k.startsWith(`${rule.id}:`) && !k.includes('#')).length;
        // Verifica veloce: se lo scan ha letto gli annunci da poco (meno di 5 minuti) si usano quelli, senza chiedere
        // di nuovo a CardTrader. Così passare da un alert all'altro è immediato e non consuma il limite di richieste.
        const recent = rule.blueprintId ? (bpHit && !bpHit.slim ? bpHit : null) : expHit;
        const useScan = !url.searchParams.get('fresh') && recent && Date.now() - recent.ts < 5 * 60_000;
        const data = useScan ? recent.data
          // "Leggi ora" (fresh): sempre una lettura nuova, senza la cache di un minuto.
          : await (rule.blueprintId ? this.productsForCard(rule.blueprintId, url.searchParams.get('fresh') ? 0 : 60_000) : this.productsFor(rule.expansionId, url.searchParams.get('fresh') ? 0 : 60_000))
            .catch((e) => { const old = rule.blueprintId ? bpHit : expHit; if (old) return old.data; throw e; }); // pausa di CardTrader: dati già letti
        const all = rule.blueprintId ? data[rule.blueprintId] || data[String(rule.blueprintId)] || [] : Object.values(data).flat();
        const rows = all
          .filter((p) => p && p.price)
          .sort((a, b) => a.price.cents - b.price.cents)
          .slice(0, 15)
          .map((p) => {
            const reasons = rejectReasons(p, rule);
            if (reliable && isRiskySeller(p)) reasons.push('venditore con troppi annullamenti');
            if (!reasons.length && rule.maxPriceCents && p.price.cents > rule.maxPriceCents) reasons.push('sopra il prezzo impostato');
            return {
              cents: p.price.cents,
              currency: p.price.currency || 'EUR',
              condition: (p.properties_hash && p.properties_hash.condition) || null,
              language: listingLang(p),
              zero: isZero(p),
              seller: p.user && p.user.username,
              risky: !reliable && isRiskySeller(p), // con il filtro attivo il motivo è già tra gli scarti
              limit: sellLimitOf(p),
              url: `https://www.cardtrader.com/cards/${p.blueprint_id}`,
              seenAt: seenMap[`${rule.id}:${p.id}:${p.price.cents}`] || null, // quando l'app l'ha già segnalato (stesso annuncio e stesso prezzo)
              reasons,
            };
          });
        const status = await this.status();
        return json({ rows, total: all.length, cmTrend, fromScan: !!useScan, readAt: useScan ? recent.ts : Date.now(), diag: { scanTs, seenCount, enabled: !!rule.enabled, lastScan: status.lastScan || null, lastError: status.lastError || null } });
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
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'Carta non indicata: ricarica l’app e riprova.' }, 400);
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
      await this.collectionPrices(true).catch(() => null);
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

    if (path === '/api/orders' && method === 'GET') {
      // I tuoi ordini CardTrader come compratore (sola lettura, non si salva niente): fino a 100, i più recenti per primi.
      try {
        const orders = [];
        for (let page = 1; page <= 5; page++) {
          const raw = await this.ct(`/orders?${new URLSearchParams({ order_as: 'buyer', limit: '20', page: String(page), sort: 'date.desc' })}`);
          const list = Array.isArray(raw) ? raw : (raw && (raw.array || raw.orders || raw.data)) || [];
          orders.push(...list.filter(Boolean));
          if (list.length < 20) break;
        }
        return json({
          orders: orders.map((o) => {
            const items = Array.isArray(o.order_items) ? o.order_items : [];
            const ship = o.order_shipping_method || null;
            return {
              id: o.id, code: o.code || null, state: o.state || null, zero: !!o.via_cardtrader_zero,
              paidAt: o.paid_at || null, sentAt: o.sent_at || null, seller: (o.seller && o.seller.username) || null,
              tracking: trackingCodeOf(o), trackingUrl: trackingUrlOf(o),
              shipping: ship ? { name: ship.name || null, cents: ship.buyer_price ? ship.buyer_price.cents : null, days: ship.max_estimate_shipping_days || null } : null,
              totalCents: o.buyer_total ? o.buyer_total.cents : null, currency: (o.buyer_total && o.buyer_total.currency) || 'EUR',
              size: o.size || items.length,
              items: items.slice(0, 40).map((it) => {
                const pr = it.properties || {};
                return {
                  iid: Number(it.id), name: it.name || it.name_en || 'Carta', expansion: expansionNameOf(it), qty: it.quantity || 1, cents: it.buyer_price ? it.buyer_price.cents : null,
                  condition: pr.condition || null, lang: pr.pokemon_language || null, reverse: pr.pokemon_reverse === true, first: pr.first_edition === true, graded: !!it.graded,
                };
              }),
            };
          }),
        });
      } catch (e) {
        return json({ error: String(e.message || e) }, e.rateLimited ? 429 : 502);
      }
    }

    if (path === '/api/orders/details' && method === 'GET') {
      // Dettagli di un ordine per la scheda Ordini: miniature, prezzo attuale delle carte e se sono già in collezione.
      const oid = parseInt(url.searchParams.get('id'), 10);
      if (!Number.isInteger(oid) || oid <= 0) return json({ error: 'Ordine non indicato.' }, 400);
      try {
        const o = await this.ct(`/orders/${oid}`);
        let items = Array.isArray(o.order_items) ? o.order_items : [];
        // Se il dettaglio porta meno righe di quante ne conta l'ordine, si riprova dall'elenco (filtrato su questo ordine).
        const qtyOf = (arr) => arr.reduce((t, it) => t + (it.quantity || 1), 0);
        if (qtyOf(items) < (o.size || 0)) {
          try {
            const raw = await this.ct(`/orders?${new URLSearchParams({ order_as: 'buyer', from_id: String(oid), to_id: String(oid), limit: '20' })}`);
            const again = (Array.isArray(raw) ? raw : (raw && (raw.array || raw.orders || raw.data)) || []).find((x) => x && x.id === oid);
            if (again && Array.isArray(again.order_items) && again.order_items.length > items.length) items = again.order_items;
          } catch { /* resta il dettaglio che c'è */ }
        }
        const exps = await this.pokemonExpansions();
        const byName = new Map(exps.map((e) => [String(e.name || '').trim().toLowerCase(), e]));
        const bps = new Map();
        const coll = await this.get('coll', []);
        const owned = new Set(coll.map((c) => `${c.bp}|${c.lang || ''}`));
        const imported = new Set(await this.get('ordImp', []));
        const blocked = new Set((await this.get('sellers', { fav: [], block: [] })).block);
        const collPr = await this.get('collPrices', {});
        const missing = [];
        const out = [];
        for (const it of items.slice(0, 80)) {
          const pr = it.properties || {};
          const bp = Number(it.blueprint_id);
          const lang = normLang(pr.pokemon_language) || '';
          const expName = expansionNameOf(it);
          const exp = byName.get(String(expName || '').trim().toLowerCase());
          if (exp && !bps.has(exp.id)) bps.set(exp.id, await this.blueprintsFor(exp.id).catch(() => []));
          const found = exp ? (bps.get(exp.id) || []).find((x) => x.id === bp) : null;
          // Prezzo attuale più basso per la stessa lingua e condizione, dagli annunci già letti di recente.
          let nowCents = null;
          // Carta già in collezione con un prezzo esatto: si usa quello, senza rileggere gli annunci.
          const cp = collPr[collKey(bp, lang, CONDITIONS.includes(pr.condition) ? pr.condition : '', pr.first_edition === true, pr.pokemon_reverse === true)];
          const fromColl = cp && cp.cents != null && !cp.estimated && !cp.approx && !it.graded;
          if (fromColl) nowCents = cp.cents;
          const hit = this.bpCache.get(bp);
          const plain = pr.first_edition !== true && pr.pokemon_reverse !== true && !it.graded;
          if (fromColl) { /* già pronto */ } else if (!it.graded && hit && (plain || !hit.slim) && Date.now() - hit.ts < 3600_000) {
            const p = priceFor(hit.data[bp] || hit.data[String(bp)], lang, CONDITIONS.includes(pr.condition) ? pr.condition : '', { blocked, first: pr.first_edition === true, reverse: pr.pokemon_reverse === true, reliable: true });
            if (p && p.cents != null) nowCents = p.cents;
          } else if (!it.graded && !missing.includes(bp)) missing.push(bp);
          out.push({
            iid: Number(it.id), bp, name: it.name || it.name_en || 'Carta', expansion: expName, qty: it.quantity || 1,
            paidCents: it.buyer_price ? it.buyer_price.cents : null, nowCents,
            image: found ? imageUrl(found.image_url) : null, number: pr.collector_number || null,
            condition: pr.condition || null, lang, reverse: pr.pokemon_reverse === true, first: pr.first_edition === true, graded: !!it.graded,
            inColl: owned.has(`${bp}|${lang}`), imported: imported.has(Number(it.id)),
          });
        }
        // Gli annunci delle carte che mancano si leggono in background (poche per volta, dopo gli alert): la scheda li richiede di nuovo.
        const todo = missing.slice(0, 8);
        if (todo.length) {
          this.ctx.waitUntil((async () => {
            for (const bp of todo) {
              try { await this.productsForCard(bp, 3600_000, true); } catch (e) { if (e.budget || e.rateLimited) break; }
            }
          })());
        }
        return json({ id: oid, items: out, pending: missing.length, size: o.size || null, listed: qtyOf(items) });
      } catch (e) {
        return json({ error: String(e.message || e) }, e.rateLimited ? 429 : 502);
      }
    }

    if (path === '/api/orders/importable' && method === 'GET') {
      // Carte dei tuoi ordini CardTrader (sola lettura) che si possono aggiungere alla collezione.
      try {
        return json(await this.importableFromOrders());
      } catch (e) {
        return json({ error: String(e.message || e) }, e.rateLimited ? 429 : 502);
      }
    }

    if (path === '/api/orders/import' && method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const want = new Set((Array.isArray(b.iids) ? b.iids : []).map(Number).filter(Number.isInteger).slice(0, 500));
      if (!want.size) return json({ error: 'Nessuna carta scelta.' }, 400);
      try {
        const { items } = await this.importableFromOrders(true);
        const chosen = items.filter((it) => want.has(it.iid));
        const exps = await this.pokemonExpansions();
        const byName = new Map(exps.map((e) => [String(e.name || '').trim().toLowerCase(), e]));
        const bpCache = new Map();
        const list = [];
        for (const it of chosen) {
          const exp = byName.get(String(it.expansion || '').trim().toLowerCase());
          let found = null;
          if (exp) {
            if (!bpCache.has(exp.id)) bpCache.set(exp.id, await this.blueprintsFor(exp.id).catch(() => []));
            found = bpCache.get(exp.id).find((x) => x.id === it.bp) || null;
          }
          list.push({
            bp: it.bp, lang: it.lang, cond: it.condition, qty: it.qty, paidCents: it.cents, first: it.first, reverse: it.reverse,
            name: found ? `${found.name}${found.version ? ` (${found.version})` : ''}` : it.name,
            image: found ? imageUrl(found.image_url) : null,
            expansionId: exp ? exp.id : null, expName: it.expansion || (exp && exp.name) || '', cmId: it.cmId,
          });
        }
        const res = await this.collectionImport(list);
        const done = await this.get('ordImp', []);
        await this.ctx.storage.put('ordImp', [...new Set([...done, ...chosen.map((it) => it.iid)])].slice(-5000));
        await this.collectionPrices(true).catch(() => null);
        return json({ ...res, imported: chosen.length });
      } catch (e) {
        return json({ error: String(e.message || e) }, e.rateLimited ? 429 : 502);
      }
    }

    if (path === '/api/sellercheck' && method === 'GET') {
      // Un venditore è affidabile? Si guardano i suoi dati negli annunci letti di recente (CardTrader non permette di chiederli da soli).
      const name = (url.searchParams.get('username') || '').trim().toLowerCase();
      if (!name) return json({ error: 'Scrivi il nome del venditore.' }, 400);
      let user = null;
      let listings = 0;
      let informative = 0; // annunci con i campi di affidabilità (le letture salvate prima non li avevano)
      let cancels = false;
      let limit = null;
      for (const cache of [this.bpCache, this.productCache]) {
        for (const { data } of cache.values()) {
          for (const list of Object.values(data || {})) {
            if (!Array.isArray(list)) continue;
            for (const p of list) {
              if (!p || !p.user || String(p.user.username || '').toLowerCase() !== name) continue;
              listings++;
              if (!user) user = p.user;
              if (!('too_many_request_for_cancel_as_seller' in p.user) && !('max_sellable_in24h_quantity' in p.user)) continue;
              informative++;
              if (p.user.too_many_request_for_cancel_as_seller === true) cancels = true;
              const l = p.user.max_sellable_in24h_quantity;
              if (l != null && l !== '') limit = limit == null ? l : Math.min(limit, l);
            }
          }
        }
      }
      if (!user) return json({ found: false });
      return json({ found: true, username: user.username, country: user.country_code || null, listings, stale: informative === 0, cancels, limit, risky: cancels });
    }

    if (path === '/api/collection' && method === 'GET') {
      return json(await this.collectionView());
    }

    if (path === '/api/collection/match' && method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const parsed = mapRows(parseCsv(String(b.csv || '').slice(0, 2_000_000)));
      if (parsed.error) return json({ error: parsed.error }, 400);
      if (!parsed.items.length) return json({ error: 'Nel file non ci sono carte.' }, 400);
      if (parsed.items.length > 1000) return json({ error: 'Al massimo 1000 righe per file: dividilo in più file.' }, 400);
      return json({ rows: await this.matchImport(parsed.items) });
    }

    if (path === '/api/collection/import' && method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const res = await this.collectionImport(Array.isArray(b.items) ? b.items : []);
      await this.collectionPrices(true).catch(() => null);
      return json(res);
    }

    if (path === '/api/collection/remove' && method === 'POST') {
      // { keys: [...] }: toglie più carte in un colpo solo (una sola scrittura, un solo ricalcolo)
      const b = await req.json().catch(() => ({}));
      const keys = new Set((Array.isArray(b.keys) ? b.keys : []).map(String).slice(0, 5000));
      const coll = await this.get('coll', []);
      const left = coll.filter((c) => !keys.has(c.key));
      const removed = coll.length - left.length;
      if (removed) {
        await this.ctx.storage.put('coll', left);
        const prices = await this.get('collPrices', {});
        for (const k of keys) delete prices[k];
        await this.ctx.storage.put('collPrices', prices);
        await this.collectionPrices(true).catch(() => null);
      }
      return json({ ...(await this.collectionView()), removed });
    }

    if (path === '/api/collection' && method === 'POST') {
      // { bp, name, image, expansionId, expName, cmId, lang, cond, qty (0 = togli), paidCents, add (true = somma alla quantità) }
      const b = await req.json();
      const res = await this.collectionUpsert(b);
      if (res.error) return json({ error: res.error, upgrade: res.upgrade }, res.status || 400);
      if (res.skipped) return json({ skipped: true, min: res.min, cents: res.cents });
      return json(await this.collectionView());
    }

    if (path === '/api/wish' && method === 'GET') {
      return json(await this.get('wish', []));
    }

    if (path === '/api/wish' && method === 'POST') {
      const b = await req.json();
      const id = parseInt(b && b.id, 10);
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'Carta non indicata: ricarica l’app e riprova.' }, 400);
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
          lang: normLang(b.lang) || '', // lingua seguita (vuota = tutte)
          ts: Date.now(),
        }, ...wish].slice(0, (await this.plan()).maxWish);
      }
      await this.ctx.storage.put('wish', wish);
      return json(wish);
    }

    if (path === '/api/listings' && method === 'GET') {
      const id = parseInt(url.searchParams.get('blueprint_id'), 10);
      const expId = parseInt(url.searchParams.get('expansion_id'), 10);
      if (!Number.isInteger(id) || id <= 0) return json({ error: 'Carta non indicata: ricarica l’app e riprova.' }, 400);
      try {
        // Aprire una carta legge tutti i suoi annunci (una richiesta), se non sono già freschi.
        let data;
        try {
          data = await this.productsForCard(id, 2 * 60_000);
        } catch (e) {
          if (!(Number.isInteger(expId) && expId > 0)) throw e;
          data = await this.productsFor(expId);
        }
        if (url.searchParams.get('summary')) {
          // Riepilogo per carte aperte fuori da una ricerca: prezzi più bassi per lingua e condizione, lingue presenti.
          const all = (data[id] || data[String(id)] || []).filter(isListable).sort(byPrice);
          const langs = {};
          const lc = {};
          for (const p of all) {
            const code = normLang(listingLang(p)) || 'sconosciuta';
            const cell = (lc[`${code}|${condRank(p.properties_hash && p.properties_hash.condition)}`] ||= [null, null]);
            if (cell[0] == null) cell[0] = p.price.cents;
            if (cell[1] == null && isZero(p)) cell[1] = p.price.cents;
            langs[code] = (langs[code] || 0) + 1;
          }
          const zero = all.find(isZero);
          // Prezzi Cardmarket della carta (se si conosce il suo id), per le carte aperte da collezione o desideri.
          const cmId = parseInt(url.searchParams.get('cm_id'), 10);
          const cm = Number.isInteger(cmId) && cmId > 0 ? (await this.cmLookup([cmId]).catch(() => new Map())).get(cmId) || null : null;
          return json({ lowest: all[0] ? all[0].price.cents : null, lowestZero: zero ? zero.price.cents : null, currency: (all[0] && all[0].price.currency) || 'EUR', langs, lc, cm });
        }
        const wanted = normLang(url.searchParams.get('lang'));
        const blockedSet = new Set((await this.get('sellers', { fav: [], block: [] })).block);
        const gradedView = !!url.searchParams.get('graded'); // solo le gradate (di norma l'elenco le esclude)
        const reverseView = !!url.searchParams.get('reverse'); // solo le reverse holo, di qualunque condizione
        const list = (data[id] || data[String(id)] || [])
          .filter((p) => (gradedView ? p && isGraded(p) && !p.on_vacation && p.quantity > 0 && p.price && p.price.cents > 0 : isListable(p) && (!reverseView || isReverse(p))))
          .filter((p) => !wanted || normLang(listingLang(p)) === wanted)
          .filter((p) => {
            const minRank = gradedView || reverseView ? NaN : parseInt(url.searchParams.get('minrank'), 10);
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
              grade: gradedView ? (gradeOf(p) ? `${gradeOf(p).co} ${gradeOf(p).g}` : 'Gradata') : null,
              language: listingLang(p),
              zero: isZero(p),
              seller: p.user && p.user.username,
              risky: isRiskySeller(p),
              reverse: isReverse(p),
              limit: sellLimitOf(p),
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
      if (!rule) return json({ error: 'Alert non valido: controlla i campi e riprova.' }, 400);
      const plan = await this.plan();
      if (!plan.priority) rule.priority = false;
      const i = rules.findIndex((r) => r.id === rule.id);
      // Stelle: ogni carta con la stella si rilegge spesso e usa una parte delle richieste a CardTrader, quindi il numero ha un tetto.
      if (rule.priority && !(i >= 0 && rules[i].priority) && rules.filter((r) => r.priority).length >= plan.maxPriority) {
        return json({ error: `Il piano ${plan.label} permette ${plan.maxPriority} alert con la stella: toglila a un altro alert per darla a questo.`, upgrade: plan.id === 'pro' }, 403);
      }
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
      // Prezzi della carta letti subito: il primo controllo non aspetta il suo turno nel giro.
      if (rule.blueprintId && rule.enabled) this.productsForCard(rule.blueprintId, 60_000).catch(() => null);
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
      if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint)) return json({ error: 'Notifiche non attivabili su questo dispositivo: riprova dalle Opzioni.' }, 400);
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
        expansion: 'HoloSnipe',
        cents: 0,
        refCents: 0,
        currency: 'EUR',
        discount: 0,
        url: '/',
        test: true,
      };
      // Non entra nell'elenco degli avvisi: serve solo al service worker per mostrare la notifica.
      await this.ctx.storage.put('testAlert', alert);
      const old = await this.get('alerts', []);
      if (old.some((a) => a.test)) await this.ctx.storage.put('alerts', old.filter((a) => !a.test));
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

    // Elimina un avviso, oppure tutti quelli già visti ({ seen: true }). I comprati restano: servono al conteggio del risparmio.
    if (path === '/api/alerts/delete' && method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const alerts = await this.get('alerts', []);
      const keep = alerts.filter((a) => (b.seen ? a.mark !== 'seen' : a.id !== b.id));
      await this.ctx.storage.put('alerts', keep);
      return json({ ok: true, removed: alerts.length - keep.length });
    }

    return json({ error: 'Pagina non trovata: ricarica l’app.' }, 404);
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
      cmId: Number.isInteger(cmId) && cmId > 0 ? cmId : null,
      // Alert "calo di prezzo": scatta se il prezzo più basso scende di dropPct% rispetto a 7 giorni prima.
      dropPct: drop ? clamp(dropPct, 5, 80, 15) : null,
      // Alert "torna disponibile": scatta quando la carta passa da nessun annuncio adatto ad almeno uno.
      stock,
      zero: b.zero === 'only' || b.zero === 'exclude' ? b.zero : '',
      minDiscount: clamp(Number(b.minDiscount), 5, 90, 30),
      minPriceCents: Math.round(clamp(Number(b.minPrice), 0, 100000, 5) * 100),
      language: /^[a-z]{2}(,[a-z]{2}){0,4}$/.test(language) ? language : '',
      minCondition: CONDITIONS.includes(b.minCondition) ? b.minCondition : 'Slightly Played',
      priority: b.priority === true,
      enabled: b.enabled !== false,
    };
  }

  // ---------- Rapporti di mercato (per stimare le copie senza un annuncio uguale) ----------

  /**
   * Ogni 3 ore confronta le varianti delle carte già lette (per espansione e per carta) e aggiorna i rapporti:
   * condizione, lingua, 1ª edizione e voti. Nessuna lettura in più da CardTrader: usa solo gli annunci in memoria.
   */
  async ratioStep(force = false) {
    const last = await this.get('ratioAt', 0);
    if (!force && Date.now() - last < 3 * 3600_000) return;
    await this.ctx.storage.put('ratioAt', Date.now()); // prima del lavoro: se fallisce non si ripete a ogni giro
    const keys = await this.get('rtKeys', []);
    const store = {};
    if (keys.length) {
      const got = await this.ctx.storage.get(keys.map((k) => `rt:${k}`));
      for (const [k, v] of got) store[k.slice(3)] = v || {};
    }
    const touched = new Set();
    const eraOf = (expId) => (expId ? (vintageEra(Number(expId)) ? 'vintage' : 'modern') : null);
    const feed = (bp, list, expId) => {
      if (!list || !list.length) return;
      const era = eraOf(expId || (list[0] && (list[0].expansion_id || (list[0].expansion && list[0].expansion.id))));
      for (const k of addSamples(store, String(bp), era, samplesFromCard(list))) touched.add(k);
    };
    for (const [expId, hit] of this.productCache) for (const [bp, list] of Object.entries(hit.data || {})) feed(bp, list, expId);
    for (const [bp, hit] of this.bpCache) if (!hit.slim) for (const list of Object.values(hit.data || {})) feed(bp, list, null);
    if (touched.size) {
      const put = {};
      for (const k of touched) put[`rt:${k}`] = store[k];
      const entries = Object.entries(put);
      for (let i = 0; i < entries.length; i += 100) await this.ctx.storage.put(Object.fromEntries(entries.slice(i, i + 100)));
      await this.ctx.storage.put('rtKeys', Object.keys(store));
      await this.ctx.storage.put('ratios', summarizeRatios(store));
      this.ratioCache = null;
    }
    await this.ctx.storage.put('ratioAt', Date.now());
  }

  /** Rapporti da usare: i propri uniti a quelli del catalogo condiviso (per ogni rapporto vince quello con più carte). */
  async marketRatios() {
    if (this.ratioCache && Date.now() - this.ratioCache.ts < 3600_000) return this.ratioCache.r;
    let r = await this.get('ratios', {});
    if (!(await this.isCatalog())) {
      const cat = await this.catalog().fetch('https://do.internal/api/_ratios').then((x) => x.json()).catch(() => ({}));
      r = mergeRatios(r, cat);
    }
    this.ratioCache = { ts: Date.now(), r };
    return r;
  }

  /** Regioni delle espansioni (INT/JAP/CN/KR/Asia) imparate dagli annunci: le tiene il catalogo condiviso. */
  async saveRegion(id, region) {
    if (!(await this.isCatalog())) {
      await this.catalog().fetch('https://do.internal/api/_region', { method: 'POST', body: JSON.stringify({ id, region }) });
      return;
    }
    const map = await this.get('expRegion', {});
    if (map[id] === region) return;
    map[id] = region;
    await this.ctx.storage.put('expRegion', map);
  }

  async regions() {
    if (await this.isCatalog()) return this.get('expRegion', {});
    if (this.regionCache && Date.now() - this.regionCache.ts < 3600_000) return this.regionCache.map;
    const map = await this.catalog().fetch('https://do.internal/api/_regions').then((r) => r.json()).catch(() => ({}));
    this.regionCache = { ts: Date.now(), map };
    return map;
  }

  async pokemonExpansions() {
    const cached = await this.get('expansions', null);
    const savedGame = await this.get('gameId', null);
    if (cached && savedGame && Date.now() - cached.ts < 24 * 3600_000) return cached.list;
    const games = await this.ct('/games');
    const list = Array.isArray(games) ? games : games.array || [];
    const game = list.find((g) => /pok[eé]mon/i.test(`${g.name} ${g.display_name}`));
    if (!game) throw new Error('CardTrader non risponde come previsto: riprovo tra poco.');
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
      // Per chi apre una schermata vanno bene i dati già letti; per lo scan no: deve sapere che la lettura
      // non è avvenuta, altrimenti la conta come fatta e non rilegge mai quella carta.
      if (hit && !background) return hit.data;
      throw e;
    }
  }

  /** Tutti gli annunci di una carta: la lettura per espansione restituisce solo i più economici di ogni carta. */
  async productsForCard(blueprintId, maxAgeMs = 5 * 60_000, background = false, opts = {}) {
    const hit = this.bpCache.get(blueprintId);
    if (hit && !(hit.slim && opts.full) && Date.now() - hit.ts < maxAgeMs) return hit.data;
    try {
      const data = await this.ct(`/marketplace/products?blueprint_id=${blueprintId}`, background);
      this.bpCache.set(blueprintId, { ts: Date.now(), data });
      await this.persistCard(blueprintId, data);
      await this.recordHistory(blueprintId, data[blueprintId] || data[String(blueprintId)]);
      return data;
    } catch (e) {
      // Per chi apre una schermata vanno bene i dati già letti; per lo scan no: deve sapere che la lettura
      // non è avvenuta, altrimenti la conta come fatta e non rilegge mai quella carta.
      if (hit && !background) return hit.data;
      throw e;
    }
  }

  /**
   * Gli annunci delle carte con un alert si salvano anche su disco (versione leggera), così dopo un
   * riavvio del server (es. un aggiornamento) lo scan riparte con i prezzi già letti invece che da zero.
   * Si scrive solo quando gli annunci più economici cambiano: le scritture restano poche.
   */
  async persistCard(blueprintId, data) {
    if (!this.ruleCards || !this.ruleCards.has(Number(blueprintId))) return;
    const slim = slimProducts(data[blueprintId] || data[String(blueprintId)]);
    const sig = slimSig(slim);
    this.cardSigs = this.cardSigs || new Map();
    if (this.cardSigs.get(blueprintId) === sig) return;
    this.cardSigs.set(blueprintId, sig);
    await this.ctx.storage.put(`pc:${blueprintId}`, { ts: Date.now(), data: { [blueprintId]: slim } });
  }

  /** Al primo giro dopo un riavvio: ricarica dal disco gli annunci salvati delle carte con un alert. */
  async warmCards(ids) {
    if (this.warmed) return;
    this.warmed = true;
    const missing = ids.filter((id) => !this.bpCache.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const got = await this.ctx.storage.get(missing.slice(i, i + 100).map((id) => `pc:${id}`));
      for (const [k, v] of got) {
        const id = Number(k.slice(3));
        if (v && v.data && !this.bpCache.has(id)) {
          this.bpCache.set(id, { ts: v.ts, data: v.data, slim: true }); // versione leggera: senza gradate né commenti
          this.cardSigs = this.cardSigs || new Map();
          this.cardSigs.set(id, slimSig(Object.values(v.data)[0] || []));
        }
      }
    }
  }

  /** Carte di un'espansione con immagine e prezzo più basso (in totale e con CardTrader Zero). */
  /** Carte (blueprint) di un'espansione, con una copia salvata per un giorno. */
  async blueprintsFor(expansionId) {
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
    return blueprints;
  }

  async cardsFor(expansionId) {
    const hit = this.cardCache.get(expansionId);
    const prodHit = this.productCache.get(expansionId);
    if (hit && prodHit && hit.ts >= prodHit.ts) return hit.data; // calcolate sugli annunci più recenti

    const singleIds = await this.singleCategoryIds();
    const blueprints = await this.blueprintsFor(expansionId);
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
    const region = regionFromLangs(langCount);
    if (region) this.saveRegion(expansionId, region).catch(() => null);
    const data = { expansionId, cards, languages, region };
    this.cardCache.set(expansionId, { ts: Date.now(), data });
    return data;
  }

  // ---------- Affari del giorno (solo nel catalogo condiviso) ----------

  /** Ogni 10 minuti si rilegge un'espansione (10 recenti + fino a 10 più ricercate): ognuna circa ogni 3 ore. */
  async dealsDue() {
    if (!(await this.isCatalog())) return false;
    const st = await this.get('ddState', { i: 0, ts: 0 });
    return Date.now() - st.ts > DEALS_EVERY_MS;
  }

  /** Espansioni con carte singole. */
  async usableExpansions() {
    const meta = await this.get('ixmeta', null);
    const have = new Set(meta ? meta.have : []);
    return (await this.pokemonExpansions()).filter((e) => !have.size || have.has(e.id));
  }

  /** Le espansioni più recenti: sempre nel giro, perché i prezzi appena usciti si muovono in fretta. */
  async recentExpansions() {
    return (await this.usableExpansions()).sort((a, b) => b.id - a.id).slice(0, DEALS_SETS);
  }

  /** Valore di un'espansione: somma delle 5 carte con la tendenza Cardmarket più alta (in euro). Si calcola una volta. */
  async probeSetValue(expId) {
    const blueprints = await this.blueprintsFor(expId);
    const cm = await this.cmLookup(blueprints.map((b) => b.cm).filter(Boolean));
    const top = blueprints.map((b) => (b.cm && cm.get(b.cm) && cm.get(b.cm).trend) || 0).sort((x, y) => y - x).slice(0, 5);
    const val = Math.round(top.reduce((t, x) => t + x, 0));
    await this.setSetValue(expId, val);
    return val;
  }

  /** Valori delle espansioni (id -> euro) e ultime letture (id -> ora): piccoli elenchi, comodi per scegliere e per lo stato in Opzioni. */
  async setSetValue(expId, val) {
    const idx = await this.get('svIdx', {});
    idx[expId] = val;
    await this.ctx.storage.put('svIdx', idx);
  }

  /**
   * Giro su tutte le altre espansioni, per valore: prima quelle mai lette, dalle più preziose; poi si rileggono
   * quelle dove l'attesa pesa di più (valore × ore dall'ultima lettura). Senza ancora un valore si va dalle più nuove.
   */
  async nextRotationSet(recent) {
    const taken = new Set(recent.map((e) => e.id));
    const rest = (await this.usableExpansions()).filter((e) => !taken.has(e.id));
    if (!rest.length) return null;
    const ts = new Map(Object.entries(await this.get('ddIdx', {})).map(([k, v]) => [Number(k), v]));
    const vals = new Map(Object.entries(await this.get('svIdx', {})).map(([k, v]) => [Number(k), v]));
    const unread = rest.filter((e) => !ts.has(e.id));
    const unreadKnown = unread.filter((e) => vals.has(e.id)).sort((a, b) => vals.get(b.id) - vals.get(a.id));
    if (unreadKnown.length) return unreadKnown[0];
    const unreadUnknown = unread.filter((e) => !vals.has(e.id)).sort((a, b) => b.id - a.id);
    if (unreadUnknown.length) return unreadUnknown[0];
    const hours = (e) => Math.min(72, (Date.now() - ts.get(e.id)) / 3600_000);
    return rest.sort((a, b) => ((vals.get(b.id) || 0) + 1) * hours(b) - ((vals.get(a.id) || 0) + 1) * hours(a))[0];
  }

  /** Un'espansione ancora senza valore, per calcolarlo (una al giro: costa al massimo la lettura delle sue carte). */
  async nextUnprobed(recent) {
    const have = new Set(Object.keys(await this.get('svIdx', {})).map(Number));
    return (await this.usableExpansions()).filter((e) => !have.has(e.id)).sort((a, b) => b.id - a.id)[0] || null;
  }

  async dealsStep() {
    if (!(await this.dealsDue())) return;
    const st = await this.get('ddState', { i: 0, ts: 0 });
    await this.ctx.storage.put('ddState', { ...st, ts: Date.now() }); // si aspetta comunque il prossimo turno, anche se questo non riesce
    const recent = await this.recentExpansions();
    if (!recent.length) return;
    // Un giro sì e uno no: una espansione recente, oppure la prossima della rotazione su tutte le altre.
    // Tre giri su quattro vanno alla rotazione su tutte le espansioni (per valore), uno a una delle più recenti.
    const exp = st.i % 4 === 0 ? recent[(st.i >> 2) % recent.length] : (await this.nextRotationSet(recent)) || recent[(st.i >> 2) % recent.length];
    // Intanto si calcola il valore di un'espansione che non ce l'ha ancora: serve a scegliere cosa leggere per prima.
    const probe = await this.nextUnprobed(recent).catch(() => null);
    if (probe) {
      await this.probeSetValue(probe.id).catch(async (e) => {
        // Un errore vero (non il limite di richieste) non deve bloccare le altre: si segna con valore 0 e si va avanti.
        if (!e.rateLimited && !e.budget) await this.setSetValue(probe.id, 0);
      });
    }
    // Una sola lettura ogni minuto: aspetta il suo gettone come una richiesta dell'utente (al massimo qualche secondo).
    // In "background" restava quasi sempre a secco, perché gli alert usano tutti i gettoni liberi. Se CardTrader chiede
    // di rallentare si salta questo turno senza segnalare un errore.
    try {
      await this.productsFor(exp.id, 0, false);
    } catch (e) {
      if (e.budget || e.rateLimited) return;
      throw e;
    }
    const { cards } = await this.cardsFor(exp.id);
    const products = await this.productsFor(exp.id);
    await this.ctx.storage.put(`dd:${exp.id}`, { ts: Date.now(), exp: { id: exp.id, name: exp.name }, items: dealsFromProducts(cards, products), itemsZero: zeroDealsFromProducts(cards, products) });
    const idx = await this.get('ddIdx', {});
    idx[exp.id] = Date.now();
    await this.ctx.storage.put({ ddIdx: idx, ddState: { i: st.i + 1, ts: Date.now(), last: exp.name } });
    // Ogni tanto si buttano le letture più vecchie di tre giorni.
    if (st.i % 40 === 0) {
      const old = Object.keys(idx).filter((k) => Date.now() - idx[k] > 3 * 86400_000);
      if (old.length) {
        for (const k of old) delete idx[k];
        await this.ctx.storage.put('ddIdx', idx);
        await this.ctx.storage.delete(old.map((k) => `dd:${k}`));
      }
    }
  }

  /**
   * Avviso quando cambia lo stato di un ordine CardTrader (nuovo ordine, spedito, arrivato…). Ogni 15 minuti una sola
   * richiesta; la prima volta si memorizza lo stato di adesso senza avvisare. Si legge solo, non si salva altro che gli stati.
   */
  async ordersStep(status) {
    if (await this.get('suspended', false)) return;
    const settings = await this.settings();
    if (settings.orderAlerts === false) return;
    if (!(await this.get('subs', [])).length) return; // senza notifiche attive non serve guardare
    if (!(await this.token())) return;
    if (Date.now() - (await this.get('ordersAt', 0)) < 15 * 60_000) return;
    await this.ctx.storage.put('ordersAt', Date.now());
    let raw;
    try {
      raw = await this.ct(`/orders?${new URLSearchParams({ order_as: 'buyer', limit: '20', sort: 'date.desc' })}`, true);
    } catch (e) {
      if (e.budget || e.rateLimited) return;
      throw e;
    }
    const list = (Array.isArray(raw) ? raw : (raw && (raw.array || raw.orders || raw.data)) || []).filter((o) => o && o.id != null);
    status.ordersError = null;
    const prev = await this.get('ordState', null);
    await this.ctx.storage.put('ordState', nextOrderStates(prev, list));
    if (prev === null) return; // primo giro: solo la fotografia di adesso
    const LABEL = { pending: 'in attesa', hub_pending: 'in attesa del magazzino', paid: 'pagato', sent: 'spedito', arrived: 'arrivato', done: 'concluso', request_for_cancel: 'annullamento richiesto', canceled: 'annullato', lost: 'smarrito' };
    const changed = orderChanges(prev, list);
    if (!changed.length) return;
    const lines = changed.slice(0, 3).map((o) => {
      const st = LABEL[o.state] || o.state || 'aggiornato';
      const track = o.state === 'sent' && trackingCodeOf(o) ? ` (tracciamento ${trackingCodeOf(o)})` : '';
      const n = Array.isArray(o.order_items) ? o.order_items.reduce((t, it) => t + (it.quantity || 1), 0) : 0;
      return `Ordine ${o.code || o.id}${n ? ` · ${n} ${n === 1 ? 'carta' : 'carte'}` : ''}: ${prev[o.id] === undefined ? 'nuovo, ' : ''}${st}${track}`;
    });
    await this.ctx.storage.put('orderNotice', { id: `order:${Date.now()}`, ts: Date.now(), kind: 'system', name: changed.length === 1 ? 'il tuo ordine è cambiato' : 'i tuoi ordini sono cambiati', text: lines.join('\n') + (changed.length > 3 ? `\n…e altri ${changed.length - 3}` : '') });
    await this.notify();
  }

  /**
   * Giro lento: ogni minuto riconosce la regione di un'espansione che non l'ha ancora.
   * La lettura aspetta il suo turno come una richiesta dell'utente (lasciando sempre un gettone libero):
   * in background, subito dopo lo scan, i gettoni non bastavano mai e il giro non avanzava.
   */
  async regionStep(status) {
    if (!(await this.isCatalog())) return;
    const since = Date.now() - (await this.get('regionAt', 0));
    if (since < 60_000) return;
    // Una al minuto se ci sono letture libere; con molti alert le letture libere sono rare,
    // quindi al massimo ogni 5 minuti se ne fa comunque una (aspetta il suo turno come le altre).
    this.refill();
    if (this.tokens < 2 && since < 5 * 60_000) return;
    const [all, map, meta] = await Promise.all([this.pokemonExpansions(), this.get('expRegion', {}), this.get('ixmeta', null)]);
    // Solo le espansioni con carte singole (le stesse dell'indice): le altre sono solo prodotti sigillati.
    const withCards = meta && Array.isArray(meta.have) && meta.have.length ? new Set(meta.have.map(Number)) : null;
    const exps = withCards ? all.filter((e) => withCards.has(Number(e.id))) : all;
    const tried = await this.get('regionTried', {});
    const stats = await this.get('regionStats', { ok: 0, none: 0, err: 0 });
    const week = 7 * 86400_000;
    const todo = exps.filter((e) => !map[e.id] && !REGION_FIXED[e.id] && !regionFromName(e.name) && !(tried[e.id] && Date.now() - tried[e.id] < week));
    status.regions = { done: exps.length - todo.length, total: exps.length, ...stats };
    await this.refreshRegionCounts(status);
    const e = todo[0];
    if (!e) return;
    try {
      const data = await this.productsFor(e.id, 6 * 3600_000);
      const langCount = {};
      for (const list of Object.values(data || {})) {
        for (const p of list || []) {
          const l = listingLang(p);
          if (l) langCount[normLang(l)] = (langCount[normLang(l)] || 0) + 1;
        }
      }
      const region = regionFromLangs(langCount);
      const problems = await this.get('regionProblems', {});
      if (region) { await this.saveRegion(e.id, region); stats.ok++; delete problems[e.id]; }
      else {
        stats.none++;
        const n = Object.values(langCount).reduce((a, b) => a + b, 0);
        problems[e.id] = { name: e.name, code: e.code, kind: 'none', note: n ? `${n} annunci, lingue miste` : 'nessun annuncio in vendita', ts: Date.now() };
      }
      await this.ctx.storage.put('regionProblems', problems);
      tried[e.id] = Date.now();
    } catch (err) {
      // Limiti di CardTrader (429) o letture finite: non è un errore dell'espansione, si riprova al prossimo giro.
      if (err.rateLimited || err.budget) { await this.ctx.storage.put('regionAt', Date.now()); return; }
      stats.err++;
      tried[e.id] = Date.now() - 6 * 86400_000; // errore vero: si riprova tra un giorno, intanto si passa alla prossima
      status.regionError = `${e.name}: ${String(err.message || err).slice(0, 80)}`;
      const problems = await this.get('regionProblems', {});
      problems[e.id] = { name: e.name, code: e.code, kind: 'err', note: String(err.message || err).slice(0, 120), ts: Date.now() };
      await this.ctx.storage.put('regionProblems', problems);
    }
    await this.ctx.storage.put({ regionTried: tried, regionStats: stats, regionAt: Date.now() });
    status.regions = { done: status.regions.done + 1, total: exps.length, ...stats };
    await this.refreshRegionCounts(status);
  }

  /** Giallo e rosso contano le espansioni ancora da sistemare, non tutte quelle mai andate storte. */
  async refreshRegionCounts(status) {
    if (!status.regions) return;
    const open = await this.openRegionProblems();
    status.regions.none = open.filter((p) => p.kind !== 'err').length;
    status.regions.err = open.filter((p) => p.kind === 'err').length;
    if (!status.regions.err) status.regionError = null;
  }

  /** Espansioni ancora senza regione dopo il giro (senza annunci o con errore), escluse quelle già sistemate. */
  async openRegionProblems() {
    const [saved, tried, map, exps] = await Promise.all([this.get('regionProblems', {}), this.get('regionTried', {}), this.get('expRegion', {}), this.pokemonExpansions().catch(() => [])]);
    const byId = new Map(exps.map((e) => [e.id, e]));
    const out = {};
    for (const [id, p] of Object.entries(saved)) if (!map[id] && !REGION_FIXED[id]) out[id] = p;
    // Anche quelle provate prima che l'elenco esistesse: provate, ma ancora senza regione.
    for (const id of Object.keys(tried)) {
      const e = byId.get(Number(id));
      if (!e || map[id] || REGION_FIXED[id] || out[id] || regionFromName(e.name)) continue;
      out[id] = { name: e.name, code: e.code, kind: 'none', note: 'non riconosciuta al primo giro (pochi annunci o un errore)' };
    }
    return Object.entries(out).map(([id, p]) => ({ id: Number(id), ...p })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async dealsList() {
    // Anche le letture già salvate: lingue degli affari, niente sconti implausibili né confronti con prezzi assurdi.
    const okDeal = (it) => (!it.language || DEAL_LANGS.has(it.language)) && !(it.discount > DAY_RULE.maxDiscount / 100) && !bogusRef(it.refCents, it.trendCents);
    const got = await this.ctx.storage.list({ prefix: 'dd:' });
    const items = [];
    const itemsZero = [];
    const sets = [];
    let ts = 0;
    for (const v of got.values()) {
      if (Date.now() - (v.ts || 0) > DEALS_MAX_AGE_MS) continue; // lettura troppo vecchia: gli affari potrebbero essere già venduti
      sets.push(v.exp.name);
      ts = Math.max(ts, v.ts);
      // Anche le letture già salvate: solo le lingue degli affari (le altre non interessano).
      for (const it of v.items) if (okDeal(it)) items.push({ ...it, expansionId: v.exp.id, expName: v.exp.name, ts: v.ts });
      for (const it of v.itemsZero || []) if (okDeal(it)) itemsZero.push({ ...it, expansionId: v.exp.id, expName: v.exp.name, ts: v.ts });
    }
    items.sort((a, b) => b.discount - a.discount);
    itemsZero.sort((a, b) => b.discount - a.discount);
    return { items: items.slice(0, 80), itemsZero: itemsZero.slice(0, 80), ts, sets, popular: [] };
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
      if (!res.ok) throw new Error('Il listino Cardmarket non è disponibile in questo momento.');
      const rows = parsePriceGuide(await res.text());
      if (rows.length < 1000) throw new Error('Il listino Cardmarket è arrivato incompleto: riprovo più tardi.');
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
  async searchIndex(terms, parsed = { words: terms, nums: [] }) {
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
          if ((parsed.nums.length ? matchesQuery(n, r[2], parsed) : matchesTerms(n, terms)) && matchesRarity(r[2], parsed.rarity)) hits.push({ rank: terms.length ? relevance(n, terms) : 0, id: r[0], name: r[1], version: r[2] || null, image: unpackImg(r[0], r[4]) });
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
    try {
      await this.alarmWork();
    } finally {
      // Qualunque cosa succeda nel giro, il prossimo controllo resta in calendario.
      if (!(await this.ctx.storage.getAlarm()) && !(await this.get('suspended', false))) await this.ctx.storage.setAlarm(Date.now() + 60_000);
    }
  }

  async alarmWork() {
    if (await this.get('suspended', false)) return; // account sospeso dalla pagina admin
    const t0 = Date.now(); // il prossimo giro si conta dall'inizio di questo: gli altri lavori (affari, regioni…) non lo allungano
    const status = await this.status();
    const day = new Date().toISOString().slice(0, 10);
    if (status.day !== day) Object.assign(status, { day, dayAlarms: 0, dayWrites: 0 });
    status.dayAlarms = (status.dayAlarms || 0) + 1;
    try {
      await this.scanOnce(status);
      status.lastError = null;
    } catch (e) {
      status.lastError = String(e.message || e);
      // Errori nostri (non di CardTrader né dei limiti): li segnaliamo al proprietario.
      if (!e.rateLimited && !e.budget && !/^CardTrader|Token CardTrader/.test(status.lastError)) await this.reportError('Scan', e);
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
      status.dealsError = null;
    } catch (e) {
      status.dealsError = String(e.message || e);
    }
    try {
      await this.ordersStep(status);
    } catch (e) {
      status.ordersError = String(e.message || e);
    }
    try {
      await this.regionStep(status);
    } catch (e) {
      status.regionError = String(e.message || e);
    }
    try {
      await this.ratioStep();
    } catch (e) {
      status.ratioError = String(e.message || e);
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
    await this.saveReadLog().catch(() => null);

    const settings = await this.settings();
    const scanning = !settings.paused && (await this.get('rules', [])).some((r) => r.enabled);
    const busy = (await this.indexPending()) || (await this.cmDue());
    const hasColl = (await this.get('coll', [])).length > 0;
    if (scanning || busy || hasColl || (await this.isCatalog())) {
      // La frequenza scelta in Impostazioni, ma mai più veloce di quella del piano.
      // Il catalogo senza altro da fare si sveglia solo per gli affari del giorno (ogni 10 minuti).
      const every = scanning ? Math.max(settings.scanEverySec, (await this.plan()).scanSec) * 1000 : busy ? SCAN_EVERY_MS : hasColl ? 5 * 60_000 : (await this.isCatalog()) ? DEALS_EVERY_MS : 10 * 60_000;
      await this.ctx.storage.setAlarm(Math.max(scanning ? Math.max(t0 + every, Date.now() + 2000) : Date.now() + every, this.blockedUntil));
    }
  }

  /**
   * Aggiorna al massimo MARKET_PER_SCAN letture dal marketplace per giro, scegliendo le più vecchie:
   * le espansioni delle regole e, per gli alert su una carta, tutti gli annunci di quella carta
   * (la lettura per espansione dà solo i più economici di ogni carta). Così le richieste restano
   * costanti anche con molti alert, e ogni fonte si aggiorna a turno.
   */
  /** Letture dell'ultima ora per carta o set: servono a mostrare su ogni alert che il controllo è regolare. */
  noteRead(key, ts = Date.now()) {
    this.readLog = this.readLog || new Map();
    this.readDirty = true;
    const list = (this.readLog.get(key) || []).filter((t) => ts - t < 3600_000);
    list.push(ts);
    this.readLog.set(key, list);
    this.lastRead = this.lastRead || new Map();
    this.lastRead.set(key, ts);
  }

  /**
   * Le letture dell'ultima ora si salvano su disco (al massimo una volta al minuto), così dopo un
   * aggiornamento dell'app le barrette e "controllato X fa" non ripartono da zero.
   */
  async loadReadLog() {
    if (this.readLoaded) return;
    this.readLoaded = true;
    const saved = await this.get('readLog', null);
    if (!saved) return;
    const now = Date.now();
    this.readLog = this.readLog || new Map();
    this.lastRead = this.lastRead || new Map();
    for (const [k, list] of Object.entries(saved.log || {})) {
      const keep = list.filter((t) => now - t < 3600_000);
      const cur = this.readLog.get(k) || [];
      this.readLog.set(k, [...new Set([...keep, ...cur])].sort((a, b) => a - b));
    }
    for (const [k, t] of Object.entries(saved.last || {})) if (!this.lastRead.has(k) || this.lastRead.get(k) < t) this.lastRead.set(k, t);
  }

  async saveReadLog(force = false) {
    if (!this.readDirty || (!force && Date.now() - (this.readSavedAt || 0) < 60_000)) return;
    this.readDirty = false;
    this.readSavedAt = Date.now();
    const now = Date.now();
    const log = {};
    for (const [k, list] of this.readLog || []) { const keep = list.filter((t) => now - t < 3600_000); if (keep.length) log[k] = keep; }
    const last = {};
    for (const [k, t] of this.lastRead || []) if (now - t < 24 * 3600_000) last[k] = t;
    await this.ctx.storage.put('readLog', { log, last });
  }

  /** Stato del controllo di ogni alert: ultima lettura, letture dell'ultima ora, annunci e più economico valido. */
  ruleChecks(rules) {
    const out = {};
    const now = Date.now();
    for (const r of rules) {
      const key = r.blueprintId ? `b:${r.blueprintId}` : `e:${r.expansionId}`;
      const reads = ((this.readLog && this.readLog.get(key)) || []).filter((t) => now - t < 3600_000);
      // Lettura aperta dall'utente (Verifica, alert appena creato): conta anche quella.
      const hit = r.blueprintId ? this.bpCache.get(r.blueprintId) : this.productCache.get(r.expansionId);
      const last = Math.max((this.lastRead && this.lastRead.get(key)) || 0, hit && this.startedAt && hit.ts > this.startedAt ? hit.ts : 0);
      if (last && !reads.includes(last) && now - last < 3600_000) reads.push(last);
      const info = (this.ruleInfo && this.ruleInfo.get(r.id)) || null;
      out[r.id] = { ts: last || null, reads: reads.sort((a, b) => a - b), restarted: this.startedAt, ...(info || {}) };
    }
    return out;
  }

  async refreshSources(rules, status) {
    await this.loadReadLog();
    this.ruleCards = new Set(rules.filter((r) => r.blueprintId).map((r) => Number(r.blueprintId)));
    // Dopo un riavvio si ricaricano dal disco gli annunci delle carte degli alert e della collezione:
    // così i prezzi della collezione si ricalcolano subito, senza aspettare una nuova lettura.
    const collBps = (await this.get('coll', [])).map((c) => Number(c.bp));
    await this.warmCards([...new Set([...this.ruleCards, ...collBps])]);
    const sources = new Map();
    const add = (k, src) => {
      const prev = sources.get(k);
      sources.set(k, { ...src, prio: Math.max(src.prio, prev ? prev.prio : 0) });
    };
    // Gli alert su una carta leggono solo quella carta; l'espansione intera serve solo agli alert su un set.
    // Gli alert contano il doppio di desideri e collezione, quelli con la stella sei volte.
    for (const r of rules) {
      const prio = r.priority ? 6 : 2;
      if (r.blueprintId) add(`b:${r.blueprintId}`, { kind: 'b', id: r.blueprintId, prio });
      else add(`e:${r.expansionId}`, { kind: 'e', id: r.expansionId, prio });
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
    // Gli alert hanno la precedenza: desideri e collezione prendono una lettura solo quando
    // le carte degli alert sono già fresche (lette negli ultimi 3 minuti). Così anche importare
    // centinaia di carte in collezione non rallenta gli alert.
    const all = [...sources.values()];
    const now = Date.now();
    const fresh = (src) => src && now - age(src) < 3 * 60_000;
    // Letture possibili in questo giro: i gettoni disponibili oltre quelli che lo scan lascia sempre all'utente.
    // La corsia veloce (alert con la stella, a rotazione, i più vecchi per primi) ne prende una parte e il resto
    // va agli altri alert: se la corsia veloce li prendesse tutti, gli alert senza stella non verrebbero mai riletti.
    this.refill();
    // Un gettone resta libero per la lettura degli affari del giorno (che passa dopo gli alert).
    const avail = Math.max(0, Math.floor(this.tokens) - MKT_RESERVE - 1);
    // Con pochi gettoni (limite stretto di CardTrader) si alterna: un giro tocca a una carta con la stella, il giro dopo agli altri.
    const fastCap = avail > MARKET_PER_SCAN ? Math.max(1, Math.min(Math.round(avail * FAST_SHARE), avail - MARKET_PER_SCAN)) : (this.fastTurn = !this.fastTurn) ? 1 : 0;
    const fast = all.filter((x) => x.prio >= 6 && now - age(x) > FAST_MIN_AGE_MS).sort((a, b) => age(a) - age(b)).slice(0, fastCap);
    const isFast = new Set(fast);
    // Agli altri tutto ciò che resta, almeno MARKET_PER_SCAN e al massimo MARKET_MAX_SCAN letture.
    const normalN = Math.max(MARKET_PER_SCAN, Math.min(MARKET_MAX_SCAN, avail - fast.length));
    const ruleDue = pickDue(all.filter((x) => x.prio >= 2 && !isFast.has(x)), age, now, normalN);
    const otherDue = pickDue(all.filter((x) => x.prio < 2), age, now, normalN);
    // Agli alert vanno quasi tutte le letture, ma una per giro resta a collezione e desideri: con tanti alert
    // sempre "da rileggere" non toccavano mai posto, i prezzi della collezione restavano fermi e non si vedevano più le variazioni.
    const staleRules = ruleDue.filter((x) => !fresh(x));
    const toRules = staleRules.slice(0, normalN - (otherDue.length && normalN >= 2 ? 1 : 0));
    const toOthers = otherDue.slice(0, normalN - toRules.length);
    const normal = [...toRules, ...toOthers, ...ruleDue.filter(fresh)].slice(0, normalN);
    const due = [...fast, ...normal];
    let n = 0;
    let error = null;
    for (const src of due) {
      try {
        if (src.kind === 'b') await this.productsForCard(src.id, 0, true);
        else await this.productsFor(src.id, 0, true);
        this.noteRead(`${src.kind}:${src.id}`);
        n++;
      } catch (e) {
        error = e; // i dati già letti restano validi: le regole si valutano comunque
        if (e.rateLimited || e.budget) break;
      }
    }
    if (status) status.lastRefresh = { ts: Date.now(), want: due.length, read: n, error: error ? (error.budget ? 'letture finite per questo giro' : String(error.message || error).slice(0, 80)) : null };
    // Giro completo: da quanto tempo non si rilegge la carta (o il set) di alert più "vecchia".
    if (status) {
      // Solo letture vere dall'avvio del server: i prezzi ricaricati dal disco dopo un aggiornamento hanno l'ora vecchia.
      const ruleSrc = [...sources.values()].filter((src) => src.prio >= 2);
      const ages = ruleSrc.map((src) => (this.lastRead && this.lastRead.get(`${src.kind}:${src.id}`)) || 0);
      status.cycle = ruleSrc.length && ages.every((t) => t) ? { ms: Date.now() - Math.min(...ages), n: ruleSrc.length, ts: Date.now() } : null;
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
    const money = (c) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(c / 100);
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
    if (!(await this.token())) throw new Error('Manca il collegamento a CardTrader: esci e rientra con il tuo token.');
    if ((await this.settings()).paused) return;
    const all = await this.get('rules', []);
    const plan = await this.plan();
    const inPlan = rulesInPlan(all, plan);
    // Il piano decide quanti alert si controllano; senza stella prioritaria nei piani che non la includono.
    const rules = all.filter((r) => inPlan.has(r.id)).map((r) => (plan.priority ? r : { ...r, priority: false }));
    const baselined = new Set(await this.get('baselined', []));
    const seen = await this.get('seen', {});
    const seenBefore = Object.keys(seen).length;
    let seenDirty = false; // cambiato anche solo un'ora (promemoria): va salvato, altrimenti al giro dopo lo stesso avviso riparte
    // Una volta sola, dopo la correzione del salvataggio dei promemoria: gli avvisi che li ricevevano a ogni giro ripartono
    // da adesso (altrimenti ne arriverebbe ancora uno ciascuno).
    if (!(await this.get('remindFix', false))) {
      const nowT = Date.now();
      for (const k of Object.keys(seen)) if (!k.includes('#') && nowT - seen[k] >= 24 * 3600_000) { seen[k] = nowT; seenDirty = true; }
      await this.ctx.storage.put('remindFix', true);
    }
    let reminderAlerts = null;
    const remindersOff = (await this.settings()).reminders === false;
    const baselinedBefore = baselined.size;
    const fresh = [];
    const requests = await this.refreshSources(rules, status);
    await this.collectionPrices();
    const blocked = new Set((await this.get('sellers', { fav: [], block: [] })).block);
    const risky = (await this.settings()).collReliable !== false; // venditori segnalati da CardTrader: niente alert

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
      // Prezzi troppo vecchi (es. ricaricati dal disco dopo un aggiornamento): si aspetta una lettura nuova,
      // altrimenti un annuncio già venduto potrebbe far scattare l'alert.
      const srcHit = rule.blueprintId ? this.bpCache.get(rule.blueprintId) : this.productCache.get(rule.expansionId);
      const staleData = !!(srcHit && Date.now() - srcHit.ts > 15 * 60_000); // niente avvisi da dati vecchi, ma il prezzo più basso si mostra comunque
      if (blocked.size || risky) data = withoutSellers(data, blocked, risky);
      {
        const all = rule.blueprintId ? data[rule.blueprintId] || data[String(rule.blueprintId)] || [] : Object.values(data).flat();
        const valid = all.filter((p) => p && p.price && !rejectReasons(p, evalRule).length);
        this.ruleInfo = this.ruleInfo || new Map();
        this.ruleInfo.set(rule.id, { listings: all.length, valid: valid.length, bestCents: valid.length ? Math.min(...valid.map((p) => p.price.cents)) : null, currency: (all[0] && all[0].price && all[0].price.currency) || 'EUR' , infoTs: srcHit ? srcHit.ts : null });
      }
      if (staleData) continue;
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
        deals = cheapestPerCard(deals); // un solo annuncio per carta: il più economico
      }
      // Gli alert su una carta valutano subito anche gli annunci già in vendita. Solo le vecchie regole
      // su un'intera espansione, che potrebbero produrre decine di alert, alla prima scansione
      // memorizzano soltanto ciò che c'è.
      const firstRun = !baselined.has(rule.id) && !rule.blueprintId;

      // Prima di avvisare: se i prezzi hanno più di un minuto, si rilegge la carta e si tengono solo
      // gli annunci ancora in vendita allo stesso prezzo. Succede di rado (solo quando c'è un affare).
      const unseen = deals.filter((d) => alertDue(seen, `${rule.id}:${d.product.id}:${d.cents}`));
      if (unseen.length && rule.blueprintId && srcHit && Date.now() - srcHit.ts > 60_000) {
        const fresh = await this.productsForCard(rule.blueprintId, 0).catch(() => null);
        const still = fresh && (fresh[rule.blueprintId] || fresh[String(rule.blueprintId)]);
        if (Array.isArray(still)) {
          const live = new Map(still.filter((p) => p && p.price && p.quantity > 0).map((p) => [p.id, p.price.cents]));
          deals = deals.filter((d) => live.get(d.product.id) === d.cents);
        }
      }

      for (const d of deals) {
        const sid = `${rule.id}:${d.product.id}:${d.cents}`; // per regola: due alert sulla stessa carta non si oscurano
        const due = alertDue(seen, sid);
        if (!due) continue;
        if (due === 'reminder') {
          // Promemoria solo se non l'hai già comprato (avviso segnato "comprato").
          // Solo se l'avviso è ancora lì e non l'hai toccato: se l'hai nascosto (eliminato), segnato come visto o comprato, niente promemoria.
          reminderAlerts ||= await this.get('alerts', []);
          const before = reminderAlerts.find((x) => x.id === sid);
          if (remindersOff || !before || before.mark) { seen[sid] = Date.now(); seenDirty = true; continue; }
        } else {
          seen[`${sid}#first`] = Date.now();
        }
        seen[sid] = Date.now();
        seenDirty = true;
        if (firstRun) continue; // alla prima scansione registriamo solo ciò che c'è già
        const p = d.product;
        let cmCents = cmRef ? Math.round(cmRef * 100) : null;
        if (!cmCents && rule.cmId) {
          const e = (await this.cmLookup([rule.cmId]).catch(() => new Map())).get(rule.cmId);
          if (e && e.trend) cmCents = Math.round(e.trend * 100);
        }
        fresh.push({
          cmCents,
          id: sid,
          ts: Date.now(),
          ...(due === 'reminder' ? { reminder: true } : {}),
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
    if (seenDirty || Object.keys(seen).length !== seenBefore || entries.length !== seenBefore || baselined.size !== baselinedBefore) {
      await this.ctx.storage.put({ seen: Object.fromEntries(entries), baselined: [...baselined] });
    }

    status.requests = (status.requests || 0) + requests;
    status.scans = (status.scans || 0) + 1;

    if (fresh.length) {
      if ((await this.plan()).shipping) await this.addShipping(fresh);
      const alerts = await this.get('alerts', []);
      await this.ctx.storage.put('alerts', [...fresh.sort((a, b) => b.discount - a.discount), ...replaceAlerts(alerts, fresh)].slice(0, MAX_ALERTS));
      // Più avvisi nello stesso giro: una notifica sola con l'elenco dei migliori.
      if (fresh.length > 1) {
        await this.ctx.storage.put('lastBatch', {
          ts: Date.now(), n: fresh.length,
          top: fresh.slice(0, 3).map((a) => ({ name: a.name, cents: a.cents, currency: a.currency, discount: a.discount, refKind: a.refKind })),
        });
      }
      await this.notify();
    }
  }

  async notify(force = false) {
    if (!force && isQuiet(await this.settings())) { await this.ctx.storage.put('pushLast', { ts: Date.now(), why: 'quiet' }); return 0; } // orari silenziosi: l'avviso resta nell'elenco
    const subs = await this.get('subs', []);
    if (!subs.length) { await this.ctx.storage.put('pushLast', { ts: Date.now(), why: 'nosubs' }); return 0; }
    const keys = await this.vapid();
    const alive = [];
    let sent = 0;
    const codes = [];
    for (const endpoint of subs) {
      try {
        const status = await sendPush(keys, endpoint);
        codes.push(status);
        if (status === 404 || status === 410) continue; // iscrizione scaduta
        alive.push(endpoint);
        if (status >= 200 && status < 300) sent++;
      } catch {
        codes.push(0);
        alive.push(endpoint);
      }
    }
    await this.ctx.storage.put('pushLast', { ts: Date.now(), sent, codes: codes.slice(0, 5) });
    if (alive.length !== subs.length) await this.ctx.storage.put('subs', alive);
    return sent;
  }
}
