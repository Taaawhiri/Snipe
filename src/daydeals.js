// Affari del giorno: logica pura, testabile.
import { findDeals } from './deals.js';

// Criteri: carte singole in inglese, Near Mint o meglio, almeno il 30% sotto il prezzo tipico su CardTrader
// (la mediana dei 5 annunci successivi, con almeno 3 annunci di confronto), da 5 € in su.
// Il confronto è con CardTrader stesso: rispetto a Cardmarket CardTrader è di solito più caro.
export const DAY_RULE = { minDiscount: 30, minPriceCents: 500, language: 'en', minCondition: 'Near Mint', zero: '' };

/** cards: le carte dell'espansione (per nome, immagine e Cardmarket); products: annunci per blueprint. */
export function dealsFromProducts(cards, products) {
  const byId = new Map(cards.filter((c) => c.single).map((c) => [String(c.id), c]));
  const singles = {};
  for (const [bp, list] of Object.entries(products || {})) if (byId.has(String(bp))) singles[bp] = list;
  const best = new Map();
  for (const d of findDeals(singles, DAY_RULE)) {
    const bp = String(d.product.blueprint_id);
    if (!best.has(bp) || d.discount > best.get(bp).discount) best.set(bp, d);
  }
  const out = [];
  for (const [bp, d] of best) {
    const c = byId.get(bp);
    out.push({
      id: c.id,
      name: c.name + (c.version ? ` (${c.version})` : ''),
      image: c.image,
      cents: d.cents,
      refCents: d.refCents,
      discount: d.discount,
      trendCents: c.cm && c.cm.trend ? Math.round(c.cm.trend * 100) : null,
      currency: d.product.price.currency || 'EUR',
      zero: !!(d.product.user && d.product.user.can_sell_via_hub),
    });
  }
  return out.sort((a, b) => b.discount - a.discount).slice(0, 20);
}
