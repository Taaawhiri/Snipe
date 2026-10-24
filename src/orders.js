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
