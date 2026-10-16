// Affari del giorno: logica pura, testabile.

/**
 * Affari di un'espansione: carte singole in inglese, Near Mint o meglio, almeno il 25% sotto la tendenza
 * Cardmarket, con tendenza di almeno 10 € (sotto, gli scarti sono rumore).
 */
export function dealsFromCards(cards) {
  const out = [];
  for (const c of cards) {
    if (!c.single || !c.cm || !(c.cm.trend >= 10)) continue;
    let best = null;
    for (const [key, cell] of Object.entries(c.lc || {})) {
      const [lang, rank] = key.split('|');
      if (lang !== 'en' || Number(rank) < 5 || cell[0] == null) continue;
      if (best == null || cell[0] < best) best = cell[0];
    }
    if (best == null || best < 300) continue;
    const trend = Math.round(c.cm.trend * 100);
    const discount = 1 - best / trend;
    if (discount < 0.25) continue;
    out.push({ id: c.id, name: c.name + (c.version ? ` (${c.version})` : ''), image: c.image, cents: best, trendCents: trend, discount, currency: c.currency });
  }
  return out.sort((a, b) => b.discount - a.discount).slice(0, 20);
}
