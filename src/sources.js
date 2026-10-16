// Scelta delle letture dal marketplace a ogni giro di scan (logica pura, testabile).

/**
 * sources: [{ kind, id, prio, minAge? }], tsOf(src) = momento dell'ultima lettura (0 se mai letta).
 * Restituisce al massimo n fonti: le più vecchie, con le prioritarie che contano come più vecchie di prio volte.
 */
export function pickDue(sources, tsOf, now, n) {
  return sources
    .filter((src) => !src.minAge || now - tsOf(src) > src.minAge)
    .map((src) => ({ src, score: (now - tsOf(src)) * (src.prio || 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.src);
}

/** Dati da usare per una regola: quelli della carta se più recenti o freschi (< 3 min), altrimenti l'espansione. */
export function pickData(exp, bp, now) {
  if (bp && (!exp || bp.ts >= exp.ts || now - bp.ts < 3 * 60_000)) return bp.data;
  return exp ? exp.data : null;
}
