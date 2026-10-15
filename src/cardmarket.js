// Listino prezzi Cardmarket (file pubblico giornaliero, nessuna API): lettura e ricerca.

export const CM_PRICE_URL = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json'; // 6 = Pokémon
export const SHARDS = 32;

export const shardOf = (id) => Number(id) % SHARDS;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Legge il file "price guide" senza costruire un oggetto enorme: scorre gli elementi uno a uno.
 * Ritorna righe compatte [idProduct, tendenza, media 30gg, più basso, media, tendenza foil], tutte in euro.
 */
export function parsePriceGuide(text) {
  const start = text.indexOf('"priceGuides"');
  if (start < 0) throw new Error('Formato del listino Cardmarket non riconosciuto');
  const rows = [];
  let pos = text.indexOf('{', text.indexOf('[', start));
  while (pos >= 0) {
    const end = text.indexOf('}', pos);
    if (end < 0) break;
    try {
      const o = JSON.parse(text.slice(pos, end + 1));
      if (o && Number.isInteger(o.idProduct)) rows.push([o.idProduct, num(o.trend), num(o.avg30), num(o.low), num(o.avg), num(o['trend-holo'])]);
    } catch {
      /* elemento illeggibile: lo saltiamo */
    }
    pos = text.indexOf('{', end);
  }
  return rows;
}

/** Divide le righe in 32 gruppi, così una ricerca legge pochi dati. */
export function toShards(rows) {
  const shards = Array.from({ length: SHARDS }, () => ({}));
  for (const [id, ...vals] of rows) shards[shardOf(id)][id] = vals;
  return shards;
}

/** Riga compatta -> oggetto con i nomi dei campi, o null se non c'è una tendenza. */
export function cmEntry(vals) {
  if (!vals || vals[0] == null) return null;
  return { trend: vals[0], avg30: vals[1], low: vals[2], avg: vals[3], trendFoil: vals[4] };
}

/** Prezzo massimo (in centesimi) per essere almeno `pct`% sotto la tendenza Cardmarket. */
export function maxCentsBelow(trend, pct) {
  if (!(trend > 0)) return null;
  return Math.floor(trend * 100 * (1 - pct / 100));
}
