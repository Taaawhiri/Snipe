// Ordini CardTrader: quali sono cambiati rispetto all'ultima volta (logica pura, testabile).

/** Ordini nuovi o con uno stato diverso. prev: { idOrdine: stato } oppure null (prima volta: niente da segnalare). */
export function orderChanges(prev, list) {
  if (prev === null || prev === undefined) return [];
  return (list || []).filter((o) => o && o.id != null && prev[o.id] !== (o.state || ''));
}

/** Aggiorna la mappa degli stati con l'elenco letto, tenendo al massimo `max` ordini (i più recenti per id). */
export function nextOrderStates(prev, list, max = 300) {
  const cur = { ...(prev || {}) };
  for (const o of list || []) if (o && o.id != null) cur[o.id] = o.state || '';
  const ids = Object.keys(cur);
  if (ids.length > max) for (const k of ids.sort((a, b) => Number(a) - Number(b)).slice(0, ids.length - max)) delete cur[k];
  return cur;
}

/** Codice di tracciamento: i punti dove CardTrader può metterlo, in ordine. */
export function trackingCodeOf(o) {
  const m = o && o.order_shipping_method;
  return (o && (o.tracking_code || o.shipping_tracking_code)) || (m && (m.tracking_code || m.tracking_number)) || null;
}

/** Link per seguire il pacco: quello di CardTrader se c'è ({code} è il segnaposto), altrimenti quello del corriere noto dal nome. */
export function trackingUrlOf(o) {
  const code = trackingCodeOf(o);
  if (!code) return null;
  const m = o.order_shipping_method || {};
  if (m.tracking_link) return String(m.tracking_link).replace('{code}', encodeURIComponent(code));
  const name = String(m.name || '');
  const c = encodeURIComponent(code);
  if (/fedex/i.test(name)) return `https://www.fedex.com/fedextrack/?trknbr=${c}`;
  if (/dhl/i.test(name)) return `https://www.dhl.com/it-it/home/tracking.html?tracking-id=${c}`;
  if (/ups/i.test(name)) return `https://www.ups.com/track?tracknum=${c}`;
  return null;
}

/** Il nome dell'espansione di una riga d'ordine: a volte è un testo, a volte un oggetto. */
export function expansionNameOf(it) {
  const e = it && it.expansion;
  if (!e) return null;
  return typeof e === 'string' ? e : e.name_en || e.name || null;
}

/** Stati dopo i quali l'ordine è chiuso. Tutto il resto, anche uno stato mai visto, resta "in corso". */
export const CLOSED_STATES = ['done', 'canceled', 'cancelled', 'lost', 'refunded', 'expired'];
