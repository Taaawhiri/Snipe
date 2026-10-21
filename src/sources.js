// Scelta delle letture dal marketplace a ogni giro di scan (logica pura, testabile).

/**
 * sources: [{ kind, id, prio, minAge? }], tsOf(src) = momento dell'ultima lettura (0 se mai letta).
 * Restituisce al massimo n fonti: le più vecchie, con le prioritarie che contano come più vecchie di prio volte.
 */
export function pickDue(sources, tsOf, now, n) {
  return sources
    .filter((src) => !src.minAge || now - tsOf(src) > src.minAge)
    // Età limitata a 2 ore: una fonte mai letta (età "infinita") non deve scavalcare per forza gli alert con la stella.
    .map((src) => ({ src, score: Math.min(now - tsOf(src), 2 * 3600_000) * (src.prio || 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.src);
}

/** Dati da usare per una regola: quelli della carta se più recenti o freschi (< 3 min), altrimenti l'espansione. */
export function pickData(exp, bp, now) {
  if (bp && (!exp || bp.ts >= exp.ts || now - bp.ts < 3 * 60_000)) return bp.data;
  return exp ? exp.data : null;
}

/**
 * Versione leggera degli annunci di una carta, da salvare su disco: i più economici acquistabili,
 * solo con i campi che servono agli alert (filtri, Zero, venditore, spedizione).
 */
export function slimProducts(list, max = 20) {
  return (list || [])
    .filter((p) => p && p.price && p.price.cents > 0 && p.quantity > 0 && !p.graded && !p.on_vacation && !/\b(psa|bgs|beckett|cgc|sgc|ace|tag|pcg)\s*[-:]?\s*\d/i.test(String(p.description || '')))
    .sort((a, b) => a.price.cents - b.price.cents)
    .slice(0, max)
    .map((p) => ({
      id: p.id,
      blueprint_id: p.blueprint_id,
      name_en: p.name_en,
      price: { cents: p.price.cents, currency: p.price.currency },
      quantity: p.quantity,
      properties_hash: p.properties_hash,
      user: p.user ? { username: p.user.username, country_code: p.user.country_code, can_sell_via_hub: p.user.can_sell_via_hub, too_many_request_for_cancel_as_seller: p.user.too_many_request_for_cancel_as_seller === true, max_sellable_in24h_quantity: p.user.max_sellable_in24h_quantity ?? null } : null,
      expansion: p.expansion ? { name_en: p.expansion.name_en } : null,
    }));
}

/** Firma degli annunci: se non cambia, non serve riscrivere su disco. */
export const slimSig = (slim) => slim.map((p) => `${p.id}:${p.price.cents}:${p.quantity}`).join('|');
