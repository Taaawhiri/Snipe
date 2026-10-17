// Collezione: prezzo attuale di ogni carta posseduta (logica pura, testabile).
import { condRank, gradeOf, isListable, isZero, listingLang, normLang, parseGradeLabel } from './deals.js';

export const COLL_LANGS = ['en', 'it', 'jp', 'fr', 'de', 'es', 'pt', 'ko', 'zh'];

export function collKey(bp, lang, cond, first = false) {
  return `${bp}|${lang || ''}|${cond || ''}${first ? '|1st' : ''}`;
}

/** Annuncio di una 1ª edizione: proprietà CardTrader o scritto nel commento del venditore. */
export function isFirstEd(p) {
  const h = (p && p.properties_hash) || {};
  if (h.first_edition === true || h.first_edition === 'true') return true;
  return /\b(1st|first)\s*ed(ition|\.)?\b|prima edizione|1a edizione|1ª edizione/i.test(String((p && p.description) || ''));
}

/** Stima di una gradata da un prezzo di base (copia non gradata o tendenza Cardmarket). */
export function gradedFromBase(base, grade) {
  const g = Number(grade.g);
  const k = (GRADE_MULT[grade.g] || 1) * (GRADER_FACTOR[grade.co] || 0.75);
  let cents = Math.round(base * Math.max(k, g >= 8 ? 1 : k));
  if (g >= 9) cents = Math.max(cents, base + Math.round(GRADING_COST_CENTS * (g >= 10 ? 1.6 : g >= 9.5 ? 1.3 : 1) * (GRADER_FACTOR[grade.co] || 0.75)));
  return cents;
}

/**
 * Valore di una copia: il prezzo più basso tra gli annunci nella stessa lingua e in condizione
 * uguale o migliore. Se non ce ne sono, il più basso in assoluto, segnato come approssimato.
 */
const TYPICAL_N = 5; // il prezzo "tipico" è la mediana dei 5 annunci adatti più economici

function median(nums) {
  const m = nums.length >> 1;
  return nums.length % 2 ? nums[m] : Math.round((nums[m - 1] + nums[m]) / 2);
}

/**
 * opts.blocked: venditori esclusi dall'utente (Set di username), ignorati anche qui.
 * Restituisce per tutti i venditori e per i soli Zero sia il più basso sia il tipico.
 */
// Stima di una gradata senza annunci con lo stesso voto: prezzo della copia non gradata × moltiplicatore del voto.
// Valori prudenti e medi: il premio reale cambia molto da carta a carta.
const GRADE_MULT = { '10': 2.5, '9.5': 1.8, '9': 1.4, '8.5': 1.2, '8': 1.1, '7.5': 1, '7': 1, '6.5': 1, '6': 1, '5.5': 1, '5': 1 };
const GRADER_FACTOR = { PSA: 1, BGS: 1, CGC: 0.85, SGC: 0.85 }; // le altre società: 0.75
const GRADING_COST_CENTS = 2500; // costo indicativo di una gradazione: una 9 o 10 vale almeno la carta più questo

export function estimateGraded(list, lang, grade, opts = {}) {
  const g = Number(grade.g);
  // Sotto 8 la slab vale circa come una copia non gradata nella condizione corrispondente.
  const rawCond = g >= 8 ? 'Near Mint' : g >= 7 ? 'Slightly Played' : g >= 5 ? 'Moderately Played' : 'Played';
  const raw = priceFor(list, lang, rawCond, opts);
  let base = raw ? raw.typCents || raw.cents : null;
  if (base == null) {
    // Nessuna copia non gradata: si parte dalle gradate con altri voti, riportate a "non gradata" col loro moltiplicatore.
    const want = normLang(lang);
    const others = (list || []).filter((p) => p && !p.on_vacation && p.quantity > 0 && p.price && p.price.cents > 0 && gradeOf(p))
      .map((p) => ({ p, gr: gradeOf(p) })).filter(({ gr }) => GRADE_MULT[gr.g]);
    const sameLang = others.filter(({ p }) => !want || normLang(listingLang(p)) === want);
    const pool = sameLang.length ? sameLang : others;
    if (!pool.length) return null;
    const bases = pool.map(({ p, gr }) => p.price.cents / Math.max(1, GRADE_MULT[gr.g] * (GRADER_FACTOR[gr.co] || 0.75))).sort((a, b) => a - b);
    base = Math.round(median(bases.slice(0, TYPICAL_N)));
  }
  const cents = gradedFromBase(base, grade);
  return { cents, typCents: cents, approx: true, estimated: true, fromGraded: !raw, rawCents: base, listings: 0, graded: `${grade.co} ${grade.g}`, zeroCents: null, zeroTypCents: null, zeroApprox: null };
}

export function priceFor(list, lang, cond, opts = {}) {
  const blocked = opts.blocked || new Set();
  // Copia gradata ("PSA 10"): si confronta solo con annunci della stessa società e dello stesso voto.
  const grade = parseGradeLabel(cond);
  const usable = (p) => p && !p.on_vacation && p.quantity > 0 && p.price && p.price.cents > 0 && !(p.user && blocked.has(p.user.username));
  let ok = (list || []).filter((p) => {
    if (!usable(p)) return false;
    if (!grade) return isListable(p);
    const g = gradeOf(p);
    return g && g.co === grade.co && g.g === grade.g;
  }).sort((a, b) => a.price.cents - b.price.cents);
  // 1ª edizione: si confronta con le 1ª edizione (e viceversa); se non ce ne sono, con tutte, segnato come approssimato.
  let edApprox = false;
  if (opts.first != null) {
    const same = ok.filter((p) => isFirstEd(p) === !!opts.first);
    if (same.length) ok = same; else if (opts.first) edApprox = true;
  }
  if (!ok.length) return grade ? estimateGraded(list, lang, grade, opts) : null;
  const want = normLang(lang);
  const min = condRank(cond);
  const fits = (p) => (!want || normLang(listingLang(p)) === want) && (grade || min < 0 || condRank(p.properties_hash && p.properties_hash.condition) >= min);
  const pickSet = (arr) => {
    const m = arr.filter(fits);
    const base = m.length ? m : arr; // nessun annuncio nella lingua/condizione: tutti, segnato come approssimato
    if (!base.length) return null;
    return { low: base[0].price.cents, typ: median(base.slice(0, TYPICAL_N).map((p) => p.price.cents)), approx: !m.length, n: Math.min(TYPICAL_N, base.length), lowLang: normLang(listingLang(base[0])) || '' };
  };
  const all = pickSet(ok);
  // Solo Zero: un annuncio Zero in un'altra lingua non vale più di uno giusto non Zero (es. 1ª ed. giapponese a 70 € vs inglese Zero).
  const z = pickSet(ok.filter(isZero));
  const zero = z && z.approx && !all.approx ? null : z;
  return {
    cents: all.low,
    typCents: all.typ,
    approx: all.approx || edApprox,
    lowLang: all.lowLang,
    zeroLowLang: zero ? zero.lowLang : null,
    edApprox,
    listings: ok.length,
    graded: grade ? `${grade.co} ${grade.g}` : null,
    zeroCents: zero ? zero.low : null,
    zeroTypCents: zero ? zero.typ : null,
    zeroApprox: zero ? zero.approx : null,
  };
}

/** Prezzo da usare: tutti gli annunci o solo Zero; il più basso o il tipico. */
export function pickPrice(p, zeroOnly, typical = false) {
  if (!p) return null;
  if (zeroOnly) {
    // Nessun annuncio Zero adatto: si usa il prezzo di tutti i venditori, segnato.
    if (p.zeroCents == null) return p.cents == null ? null : { ...p, cents: typical && p.typCents != null ? p.typCents : p.cents, notZero: true };
    return { ...p, cents: typical && p.zeroTypCents != null ? p.zeroTypCents : p.zeroCents, approx: p.zeroApprox, lowLang: p.zeroLowLang };
  }
  return typical && p.typCents != null ? { ...p, cents: p.typCents } : p;
}

/** Totali: valore, speso, quantità, copie senza prezzo. */
export function summarize(items) {
  let value = 0;
  let paid = 0;
  let qty = 0;
  let missing = 0;
  let cm = 0;
  let paidPriced = 0; // speso per le sole copie con un prezzo: base del guadagno teorico
  let valueKnown = 0; // valore delle copie con prezzo pagato indicato (anche 0, es. trovate in una busta)
  let known = 0;
  for (const it of items) {
    qty += it.qty;
    if (it.price) {
      value += it.price.cents * it.qty;
      if (it.paidCents != null) { paidPriced += it.paidCents * it.qty; valueKnown += it.price.cents * it.qty; known += it.qty; }
    } else missing += it.qty;
    if (it.paidCents != null) paid += it.paidCents * it.qty;
    if (it.cmCents) cm += it.cmCents * it.qty;
  }
  return { value, paid, qty, distinct: items.length, missing, cm, paidPriced, valueKnown, known };
}
