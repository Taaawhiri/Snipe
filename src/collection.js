// Collezione: prezzo attuale di ogni carta posseduta (logica pura, testabile).
import { condRank, gradeOf, isListable, isZero, listingLang, normLang, parseGradeLabel } from './deals.js';

export const COLL_LANGS = ['en', 'it', 'jp', 'fr', 'de', 'es', 'pt', 'ko', 'zh'];

export function collKey(bp, lang, cond) {
  return `${bp}|${lang || ''}|${cond || ''}`;
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
export function priceFor(list, lang, cond, opts = {}) {
  const blocked = opts.blocked || new Set();
  // Copia gradata ("PSA 10"): si confronta solo con annunci della stessa società e dello stesso voto.
  const grade = parseGradeLabel(cond);
  const usable = (p) => p && !p.on_vacation && p.quantity > 0 && p.price && p.price.cents > 0 && !(p.user && blocked.has(p.user.username));
  const ok = (list || []).filter((p) => {
    if (!usable(p)) return false;
    if (!grade) return isListable(p);
    const g = gradeOf(p);
    return g && g.co === grade.co && g.g === grade.g;
  }).sort((a, b) => a.price.cents - b.price.cents);
  if (!ok.length) return null;
  const want = normLang(lang);
  const min = condRank(cond);
  const fits = (p) => (!want || normLang(listingLang(p)) === want) && (grade || min < 0 || condRank(p.properties_hash && p.properties_hash.condition) >= min);
  const pickSet = (arr) => {
    const m = arr.filter(fits);
    const base = m.length ? m : arr; // nessun annuncio nella lingua/condizione: tutti, segnato come approssimato
    if (!base.length) return null;
    return { low: base[0].price.cents, typ: median(base.slice(0, TYPICAL_N).map((p) => p.price.cents)), approx: !m.length, n: Math.min(TYPICAL_N, base.length) };
  };
  const all = pickSet(ok);
  const zero = pickSet(ok.filter(isZero));
  return {
    cents: all.low,
    typCents: all.typ,
    approx: all.approx,
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
    if (p.zeroCents == null) return null;
    return { ...p, cents: typical && p.zeroTypCents != null ? p.zeroTypCents : p.zeroCents, approx: p.zeroApprox };
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
