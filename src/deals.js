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

function eligible(p, rule) {
  if (!p || p.graded || p.on_vacation) return false;
  if (!(p.quantity > 0)) return false;
  if (!p.price || !(p.price.cents > 0)) return false;
  if (rule.nameContains) {
    const hay = String(p.name_en || '').toLowerCase();
    if (!hay.includes(String(rule.nameContains).toLowerCase())) return false;
  }
  const min = condRank(rule.minCondition);
  const r = condRank(p.properties_hash && p.properties_hash.condition);
  if (min >= 0 && r >= 0 && r < min) return false;
  return true;
}

/**
 * products: oggetto { [blueprintId]: Product[] } come restituito da /marketplace/products.
 * Per ogni carta confronta i 3 annunci più economici con la mediana dei successivi (fino a 5).
 */
export function findDeals(products, rule, opts = {}) {
  const { checkTop = 3, refCount = 5, minRefs = 3, minSavingCents = 100 } = opts;
  const minDiscount = (rule.minDiscount ?? 30) / 100;
  const minPrice = rule.minPriceCents ?? 0;
  const out = [];

  for (const list of Object.values(products || {})) {
    if (!Array.isArray(list)) continue;
    const ok = list.filter((p) => eligible(p, rule)).sort((a, b) => a.price.cents - b.price.cents);
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
