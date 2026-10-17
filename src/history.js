// Storico giornaliero dei prezzi di una carta: per ogni giorno il prezzo più basso visto, in totale e con Zero.
import { condRank, isListable, isZero, listingLang, normLang } from './deals.js';

// Nello storico entrano solo copie Near Mint o migliori: una copia rovinata non è il prezzo della carta.
const NM = condRank('Near Mint');
const good = (p) => isListable(p) && condRank(p.properties_hash && p.properties_hash.condition) >= NM;

/** Prezzo più basso adesso (Near Mint o migliore, nella lingua indicata o in qualsiasi lingua), in totale e con Zero. null se non ci sono annunci. */
export function currentLow(products, lang = '') {
  const want = normLang(lang);
  const ok = (products || []).filter((p) => good(p) && (!want || normLang(listingLang(p)) === want));
  if (!ok.length) return null;
  const zs = ok.filter(isZero).map((p) => p.price.cents);
  return { min: Math.min(...ok.map((p) => p.price.cents)), zero: zs.length ? Math.min(...zs) : null, n: ok.length };
}

export const HISTORY_DAYS = 120;

export function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Aggiunge (o aggiorna) il punto di oggi. Restituisce un nuovo array, al massimo HISTORY_DAYS giorni. */
export function addPoint(hist, products, ts = Date.now()) {
  const ok = (products || []).filter(good);
  if (!ok.length) return hist || [];
  const min = Math.min(...ok.map((p) => p.price.cents));
  const zs = ok.filter(isZero).map((p) => p.price.cents);
  const zero = zs.length ? Math.min(...zs) : null;
  const d = dayKey(ts);
  const out = [...(hist || [])];
  const last = out[out.length - 1];
  if (last && last.d === d) {
    // Il punto di oggi segue l'ultima lettura: un annuncio economico già venduto non resta come "prezzo di oggi".
    out[out.length - 1] = { d, min, zero, n: ok.length };
  } else {
    out.push({ d, min, zero, n: ok.length });
  }
  return out.slice(-HISTORY_DAYS);
}

/** Prezzo più basso di circa 7 giorni fa (o il più vecchio disponibile, con almeno 3 giorni di storico). */
export function refWeekAgo(hist, now = Date.now()) {
  if (!Array.isArray(hist) || hist.length < 3) return null;
  const target = dayKey(now - 7 * 86400_000);
  const past = hist.filter((p) => p.d <= target);
  const pick = past.length ? past[past.length - 1] : hist[0];
  if (pick.d === dayKey(now)) return null;
  return pick.min;
}
