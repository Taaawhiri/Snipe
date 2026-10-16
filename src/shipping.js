// Stima della spedizione dai metodi del venditore (GET /shipping_methods?username=...).
// CardTrader restituisce le opzioni verso il paese dell'account del token, con costi a fasce di peso.

const CARD_GRAMS = 20; // una carta in busta: si guarda la fascia di peso più bassa che la contiene

function cents(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Math.round(v);
  if (typeof v === 'object' && Number.isFinite(v.cents)) return v.cents;
  return null;
}

/** Il metodo più economico per una carta: { cents, name, tracked, days } oppure null. */
export function cheapestShipping(methods, grams = CARD_GRAMS) {
  const list = Array.isArray(methods) ? methods : (methods && methods.array) || [];
  let best = null;
  for (const m of list) {
    const bands = Array.isArray(m.shipping_method_costs) ? m.shipping_method_costs : [];
    const band = bands
      .filter((b) => (b.from_grams ?? 0) <= grams && (b.to_grams == null || b.to_grams >= grams))
      .map((b) => cents(b.price))
      .filter((c) => c != null);
    if (!band.length) continue;
    const c = Math.min(...band);
    if (!best || c < best.cents) {
      best = {
        cents: c,
        name: String(m.name || '').slice(0, 60),
        tracked: !!m.tracked,
        days: m.min_estimate_shipping_days != null ? [m.min_estimate_shipping_days, m.max_estimate_shipping_days] : null,
      };
    }
  }
  return best;
}
