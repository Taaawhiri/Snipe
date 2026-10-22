// Rapporti di mercato ricavati dagli annunci di CardTrader (logica pura, testabile).
// Confrontando le varianti della STESSA carta in vendita (lingua, condizione, edizione, voto) si ricava
// quanto vale tipicamente una variante rispetto a un'altra: es. "SP = 0,78 × NM", "JP = 1,2 × EN" nelle vintage.
// Servono a stimare il valore di una copia quando su CardTrader non c'è un annuncio con la stessa combinazione.
import { condRank, gradeOf, isRiskySeller, listingLang, normLang } from './deals.js';

export const MIN_N = 20; // un rapporto si usa solo se si basa su almeno 20 carte diverse
export const MAX_SAMPLES = 400; // campioni tenuti per rapporto (le carte lette più di recente)
const NM = 'Near Mint';
const LOWER = ['Slightly Played', 'Moderately Played', 'Played', 'Heavily Played', 'Poor'];

/** 1ª edizione: proprietà CardTrader o scritto nel commento del venditore. */
export function isFirstEd(p) {
  const h = (p && p.properties_hash) || {};
  if (h.first_edition === true || h.first_edition === 'true') return true;
  return /\b(1st|first)\s*ed(ition|\.)?\b|prima edizione|1a edizione|1ª edizione/i.test(String((p && p.description) || ''));
}

/**
 * Reverse holo: CardTrader la segna con una proprietà dell'annuncio (l'icona che si vede sul sito); in mancanza,
 * si cerca nel commento del venditore. Se la proprietà c'è ed è falsa, il commento non conta.
 */
export function isReverse(p) {
  const h = (p && p.properties_hash) || {};
  const k = Object.keys(h).find((x) => /reverse/i.test(x));
  if (k) return h[k] === true || h[k] === 'true';
  return /\breverse(\s*holo)?\b/i.test(String((p && p.description) || ''));
}

/** Variante di un annuncio: lingua, condizione (o voto se gradata) ed edizione. null se non classificabile. */
export function variantOf(p) {
  if (!p || !p.properties_hash) return null;
  const lang = normLang(listingLang(p)) || '';
  if (!lang) return null;
  const first = isFirstEd(p);
  const gr = gradeOf(p);
  if (gr) return { lang, grade: `${gr.co} ${gr.g}`, first };
  if (p.graded) return null; // gradata senza voto nel commento: non si sa quale
  let cond = p.properties_hash.condition;
  if (condRank(cond) < 0) return null;
  if (cond === 'Mint') cond = NM; // Mint e Near Mint si trattano insieme
  return { lang, cond, first };
}
const vkey = (lang, q, first) => `${lang}|${q}|${first ? 1 : 0}`;

/** Annuncio più economico per ogni variante della carta. */
export function lowestByVariant(list, blocked = new Set()) {
  const m = new Map();
  for (const p of list || []) {
    if (!p || p.on_vacation || !(p.quantity > 0) || !p.price || !(p.price.cents > 0)) continue;
    if (p.user && blocked.has(p.user.username)) continue;
    const v = variantOf(p);
    if (!v) continue;
    const k = vkey(v.lang, v.grade || v.cond, v.first);
    const prev = m.get(k);
    if (!prev || p.price.cents < prev.cents) m.set(k, { v, cents: p.price.cents });
  }
  return m;
}

/**
 * Campioni di una carta: [chiave, rapporto]. Ogni rapporto confronta due varianti che differiscono per una sola cosa.
 *   cond:<C>     condizione C rispetto a Near Mint (stessa lingua, edizione normale)
 *   lang:<L>     lingua L rispetto all'inglese (Near Mint, edizione normale)
 *   first        1ª edizione rispetto alla normale (Near Mint, stessa lingua)
 *   grade:<CO G> gradata rispetto alla Near Mint non gradata (stessa lingua, edizione normale)
 */
export function samplesFromCard(list) {
  const m = lowestByVariant((list || []).filter((p) => !isRiskySeller(p) && !isReverse(p))); // le reverse hanno un prezzo a sé // i rapporti non si basano sui venditori a rischio
  const get = (lang, q, first = false) => { const x = m.get(vkey(lang, q, first)); return x ? x.cents : null; };
  const out = [];
  const push = (key, a, b) => {
    if (a == null || b == null) return;
    const r = a / b;
    if (r > 0.02 && r < 50) out.push([key, r]); // scarta coppie assurde (annunci sbagliati)
  };
  const langs = new Set([...m.values()].map((x) => x.v.lang));
  for (const L of langs) {
    const nm = get(L, NM);
    if (nm == null) continue;
    for (const C of LOWER) push(`cond:${C}`, get(L, C), nm);
    push('first', get(L, NM, true), nm);
    for (const x of m.values()) if (x.v.lang === L && x.v.grade && !x.v.first) push(`grade:${x.v.grade}`, x.cents, nm);
    if (L !== 'en') push(`lang:${L}`, nm, get('en', NM));
  }
  return out;
}

/** Aggiunge i campioni di una carta (bp) al deposito { chiave|epoca: { bp: rapporto } }, tenendo i più recenti. */
export function addSamples(store, bp, era, samples) {
  const touched = new Set();
  for (const [key, r] of samples) {
    for (const k of [`${key}|${era}`, `${key}|all`]) {
      const box = store[k] || (store[k] = {});
      delete box[bp]; // reinserito in fondo: il più recente
      box[bp] = Math.round(r * 1000) / 1000;
      const ids = Object.keys(box);
      if (ids.length > MAX_SAMPLES) for (const id of ids.slice(0, ids.length - MAX_SAMPLES)) delete box[id];
      touched.add(k);
    }
  }
  return touched;
}

/** Riepilogo: per ogni rapporto la mediana dei campioni e quante carte ci sono dietro. */
export function summarizeRatios(store) {
  const out = {};
  for (const [k, box] of Object.entries(store)) {
    const v = Object.values(box).sort((a, b) => a - b);
    if (!v.length) continue;
    const m = v.length >> 1;
    out[k] = { r: Math.round((v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) * 1000) / 1000, n: v.length };
  }
  return out;
}

/** Unisce due riepiloghi tenendo, per ogni rapporto, quello con più carte. */
export function mergeRatios(a, b) {
  const out = { ...(a || {}) };
  for (const [k, x] of Object.entries(b || {})) if (!out[k] || x.n > out[k].n) out[k] = x;
  return out;
}

const LANG_NAMES = { en: 'inglese', jp: 'giapponese', it: 'italiano', fr: 'francese', de: 'tedesco', es: 'spagnolo', pt: 'portoghese', ko: 'coreano', zh: 'cinese' };
const COND_SHORT = { 'Near Mint': 'NM', 'Slightly Played': 'SP', 'Moderately Played': 'MP', Played: 'PL', 'Heavily Played': 'HP', Poor: 'PO' };

/**
 * Stima il valore della copia "target" partendo dall'annuncio più vicino che c'è, con i rapporti di mercato.
 * target: { lang, cond, grade ('PSA 10' o null), first }. era: 'vintage' | 'modern'.
 * Restituisce { cents, from, parts } oppure null se nessun annuncio si può convertire con rapporti affidabili.
 */
export function estimateFrom(list, target, ratios, era, blocked = new Set()) {
  if (!ratios) return null;
  const R = (key) => {
    for (const k of [`${key}|${era}`, `${key}|all`]) {
      const x = ratios[k];
      if (x && x.n >= MIN_N) return { r: x.r, n: x.n, scope: k.endsWith('|all') ? 'tutte le epoche' : era === 'vintage' ? 'vintage' : 'moderne' };
    }
    return null;
  };
  const one = { r: 1, n: 0 };
  const langF = (L) => (L === 'en' ? one : R(`lang:${L}`));
  const qualF = (x) => (x.grade ? R(`grade:${x.grade}`) : x.cond === NM ? one : R(`cond:${x.cond}`));
  const firstF = (f) => (f ? R('first') : one);
  const t = { lang: normLang(target.lang) || 'en', grade: target.grade || null, cond: target.grade ? null : (target.cond === 'Mint' ? NM : target.cond || NM), first: !!target.first };
  const tQual = t.grade || t.cond;

  let best = null;
  for (const { v, cents } of lowestByVariant(list, blocked).values()) {
    const vQual = v.grade || v.cond;
    // Una copia in condizione migliore della propria vale come la propria (stessa regola del prezzo esatto).
    const qualSame = vQual === tQual || (!t.grade && !v.grade && condRank(v.cond) >= condRank(t.cond));
    const parts = [];
    let k = 1;
    let ok = true;
    const step = (label, ft, fv) => {
      if (!ft || !fv) { ok = false; return; }
      const r = ft.r / fv.r;
      k *= r;
      parts.push({ label, r: Math.round(r * 100) / 100, n: Math.min(ft.n || Infinity, fv.n || Infinity), scope: (ft.n ? ft : fv).scope });
    };
    if (v.lang !== t.lang) step(`lingua: ${LANG_NAMES[v.lang] || v.lang} → ${LANG_NAMES[t.lang] || t.lang}`, langF(t.lang), langF(v.lang));
    if (!qualSame) step(`${v.grade ? v.grade : COND_SHORT[v.cond] || v.cond} → ${t.grade ? t.grade : COND_SHORT[t.cond] || t.cond}`, qualF(t), qualF(v));
    if (v.first !== t.first) step(`edizione: ${v.first ? '1ª' : 'normale'} → ${t.first ? '1ª' : 'normale'}`, firstF(t.first), firstF(v.first));
    if (!ok || !parts.length) continue; // parts vuoto = combinazione esatta, gestita dal prezzo normale
    const est = Math.round(cents * k);
    // Il più vicino (meno passaggi), a parità il più economico: stessa logica del "prezzo più basso".
    if (!best || parts.length < best.parts.length || (parts.length === best.parts.length && est < best.cents)) {
      best = { cents: est, from: { cents, lang: v.lang, q: v.grade || COND_SHORT[v.cond] || v.cond, first: v.first }, parts };
    }
  }
  return best;
}
