// Collezione: prezzo attuale di ogni carta posseduta (logica pura, testabile).
import { condRank, isListable, isZero, listingLang, normLang } from './deals.js';

export const COLL_LANGS = ['en', 'it', 'jp', 'fr', 'de', 'es', 'pt', 'ko', 'zh'];

export function collKey(bp, lang, cond) {
  return `${bp}|${lang || ''}|${cond || ''}`;
}

/**
 * Valore di una copia: il prezzo più basso tra gli annunci nella stessa lingua e in condizione
 * uguale o migliore. Se non ce ne sono, il più basso in assoluto, segnato come approssimato.
 */
export function priceFor(list, lang, cond) {
  const ok = (list || []).filter(isListable).sort((a, b) => a.price.cents - b.price.cents);
  if (!ok.length) return null;
  const want = normLang(lang);
  const min = condRank(cond);
  const match = ok.find((p) => (!want || normLang(listingLang(p)) === want) && (min < 0 || condRank(p.properties_hash && p.properties_hash.condition) >= min));
  const pick = match || ok[0];
  return { cents: pick.price.cents, zero: isZero(pick), approx: !match, listings: ok.length };
}

/** Totali: valore, speso, quantità, copie senza prezzo. */
export function summarize(items) {
  let value = 0;
  let paid = 0;
  let qty = 0;
  let missing = 0;
  let cm = 0;
  let paidPriced = 0; // speso per le sole copie con un prezzo: base del guadagno teorico
  for (const it of items) {
    qty += it.qty;
    if (it.price) {
      value += it.price.cents * it.qty;
      if (it.paidCents) paidPriced += it.paidCents * it.qty;
    } else missing += it.qty;
    if (it.paidCents) paid += it.paidCents * it.qty;
    if (it.cmCents) cm += it.cmCents * it.qty;
  }
  return { value, paid, qty, distinct: items.length, missing, cm, paidPriced };
}
