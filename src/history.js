// Storico giornaliero dei prezzi di una carta: per ogni giorno il prezzo più basso visto, in totale e con Zero.
import { isListable, isZero } from './deals.js';

export const HISTORY_DAYS = 120;

export function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Aggiunge (o aggiorna) il punto di oggi. Restituisce un nuovo array, al massimo HISTORY_DAYS giorni. */
export function addPoint(hist, products, ts = Date.now()) {
  const ok = (products || []).filter(isListable);
  if (!ok.length) return hist || [];
  const min = Math.min(...ok.map((p) => p.price.cents));
  const zs = ok.filter(isZero).map((p) => p.price.cents);
  const zero = zs.length ? Math.min(...zs) : null;
  const d = dayKey(ts);
  const out = [...(hist || [])];
  const last = out[out.length - 1];
  if (last && last.d === d) {
    out[out.length - 1] = {
      d,
      min: Math.min(last.min, min),
      zero: last.zero == null ? zero : zero == null ? last.zero : Math.min(last.zero, zero),
      n: Math.max(last.n || 0, ok.length),
    };
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
