// Affari del giorno: logica pura, testabile.
import { condRank, findDeals, isListable, isZero, listingLang, median, normLang } from './deals.js';

// Criteri: carte singole Near Mint o meglio, almeno il 25% sotto il prezzo tipico su CardTrader
// (la mediana dei 5 annunci successivi, con almeno 3 annunci di confronto), da 5 € in su.
// Ogni lingua si confronta solo con sé stessa: una giapponese non è un affare solo perché costa meno di un'inglese.
// Il confronto è con CardTrader stesso: rispetto a Cardmarket CardTrader è di solito più caro.
export const DAY_RULE = { minDiscount: 25, minPriceCents: 500, minCondition: 'Near Mint', zero: '' };

/** cards: le carte dell'espansione (per nome, immagine e Cardmarket); products: annunci per blueprint. */
export function dealsFromProducts(cards, products) {
  const byId = new Map(cards.filter((c) => c.single).map((c) => [String(c.id), c]));
  const singles = {};
  for (const [bp, list] of Object.entries(products || {})) if (byId.has(String(bp))) singles[bp] = list;
  const best = new Map();
  const langs = new Set();
  for (const list of Object.values(singles)) for (const p of list || []) langs.add(normLang(listingLang(p)));
  const deals = [...langs].filter(Boolean).flatMap((language) => findDeals(singles, { ...DAY_RULE, language }));
  for (const d of deals) {
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
      language: normLang(listingLang(d.product)) || null,
    });
  }
  return out.sort((a, b) => b.discount - a.discount).slice(0, 20);
}

/**
 * Affari solo CardTrader Zero: il primo annuncio Zero di ogni carta (per lingua, NM o meglio) confrontato
 * con il prezzo tipico di tutti gli annunci successivi nella stessa lingua, non solo Zero.
 */
export function zeroDealsFromProducts(cards, products) {
  const byId = new Map(cards.filter((c) => c.single).map((c) => [String(c.id), c]));
  const minRank = condRank(DAY_RULE.minCondition);
  const out = [];
  for (const [bp, list] of Object.entries(products || {})) {
    const c = byId.get(String(bp));
    if (!c || !Array.isArray(list)) continue;
    const ok = list.filter((p) => isListable(p) && condRank(p.properties_hash && p.properties_hash.condition) >= minRank);
    const byLang = new Map();
    for (const p of ok) {
      const l = normLang(listingLang(p)) || '?';
      if (!byLang.has(l)) byLang.set(l, []);
      byLang.get(l).push(p);
    }
    let best = null;
    for (const [lang, arr] of byLang) {
      arr.sort((a, b) => a.price.cents - b.price.cents);
      const i = arr.findIndex(isZero);
      if (i < 0) continue;
      const z = arr[i];
      const refs = arr.filter((p) => p !== z).slice(i, i + 5).map((p) => p.price.cents);
      if (refs.length < 3 || z.price.cents < DAY_RULE.minPriceCents) continue;
      const ref = median(refs);
      const discount = 1 - z.price.cents / ref;
      if (discount < DAY_RULE.minDiscount / 100) continue;
      if (!best || discount > best.discount) best = { z, ref, discount, lang };
    }
    if (!best) continue;
    out.push({
      id: c.id,
      name: c.name + (c.version ? ` (${c.version})` : ''),
      image: c.image,
      cents: best.z.price.cents,
      refCents: Math.round(best.ref),
      discount: best.discount,
      trendCents: c.cm && c.cm.trend ? Math.round(c.cm.trend * 100) : null,
      currency: best.z.price.currency || 'EUR',
      zero: true,
      language: best.lang === '?' ? null : best.lang,
    });
  }
  return out.sort((a, b) => b.discount - a.discount).slice(0, 20);
}
