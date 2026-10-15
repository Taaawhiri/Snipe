// Logica pura per riconoscere gli annunci con prezzo anomalo. Nessuna dipendenza da Cloudflare, quindi testabile.

export const CONDITIONS = [
  'Poor',
  'Heavily Played',
  'Played',
  'Moderately Played',
  'Slightly Played',
  'Near Mint',
  'Mint',
];

export function condRank(name) {
  const n = String(name || '').toLowerCase();
  return CONDITIONS.findIndex((c) => c.toLowerCase() === n);
}

export function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Il venditore accetta ordini via CardTrader Zero (campo user.can_sell_via_hub dell'API). */
export function isZero(p) {
  return !!(p && p.user && p.user.can_sell_via_hub);
}

/** Annuncio acquistabile: non graded, non in vacanza, disponibile e con un prezzo. */
export function isListable(p) {
  if (!p || p.graded || p.on_vacation) return false;
  if (!(p.quantity > 0)) return false;
  return !!(p.price && p.price.cents > 0);
}

function eligible(p, rule) {
  if (!isListable(p)) return false;
  if (rule.nameContains) {
    const hay = String(p.name_en || '').toLowerCase();
    if (!hay.includes(String(rule.nameContains).toLowerCase())) return false;
  }
  if (rule.zero === 'only' && !isZero(p)) return false;
  if (rule.zero === 'exclude' && isZero(p)) return false;
  const min = condRank(rule.minCondition);
  const r = condRank(p.properties_hash && p.properties_hash.condition);
  if (min >= 0 && r >= 0 && r < min) return false;
  return true;
}

/**
 * products: oggetto { [blueprintId]: Product[] } come restituito da /marketplace/products.
 *
 * Due modalità:
 * - rule.maxPriceCents: scatta per ogni annuncio con prezzo <= soglia (prezzo assoluto).
 * - altrimenti sconto percentuale: i 3 annunci più economici di ogni carta vengono
 *   confrontati con la mediana dei successivi (fino a 5).
 *
 * rule.blueprintId limita il controllo a una sola carta.
 */
export function findDeals(products, rule, opts = {}) {
  const { checkTop = 3, refCount = 5, minRefs = 3, minSavingCents = 100, maxPerCard = 5 } = opts;
  const minDiscount = (rule.minDiscount ?? 30) / 100;
  const minPrice = rule.minPriceCents ?? 0;
  const out = [];

  for (const [bp, list] of Object.entries(products || {})) {
    if (!Array.isArray(list)) continue;
    if (rule.blueprintId && String(bp) !== String(rule.blueprintId)) continue;
    const ok = list.filter((p) => eligible(p, rule)).sort((a, b) => a.price.cents - b.price.cents);

    if (rule.maxPriceCents > 0) {
      for (let i = 0; i < Math.min(maxPerCard, ok.length); i++) {
        const p = ok[i];
        if (p.price.cents > rule.maxPriceCents) break;
        const refs = ok.slice(i + 1, i + 1 + refCount).map((x) => x.price.cents);
        const ref = refs.length ? median(refs) : p.price.cents;
        out.push({ product: p, cents: p.price.cents, refCents: Math.round(ref), discount: Math.max(0, 1 - p.price.cents / ref) });
      }
      continue;
    }

    for (let i = 0; i < Math.min(checkTop, ok.length); i++) {
      const p = ok[i];
      const refs = ok.slice(i + 1, i + 1 + refCount).map((x) => x.price.cents);
      if (refs.length < minRefs) continue;
      const ref = median(refs);
      const discount = 1 - p.price.cents / ref;
      if (discount < minDiscount) continue;
      if (p.price.cents < minPrice) continue;
      if (ref - p.price.cents < minSavingCents) continue;
      out.push({ product: p, cents: p.price.cents, refCents: Math.round(ref), discount });
    }
  }
  return out;
}
