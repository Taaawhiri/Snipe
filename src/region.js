// Regione di un'espansione: International, giapponese, cinese, coreana o asiatica.
// Prima si guarda alle lingue degli annunci (affidabile), altrimenti al nome dell'espansione.

const WEST = new Set(['en', 'it', 'fr', 'de', 'es', 'pt', 'ru', 'nl', 'pl']);
const ASIA = { jp: 'JAP', ja: 'JAP', zh: 'CN', ko: 'KR', th: 'Asia', id: 'Asia' };

/** langCount: { codice: numero di annunci }. null se i dati non bastano. */
export function regionFromLangs(langCount) {
  const entries = Object.entries(langCount || {}).filter(([k, n]) => n > 0 && k !== 'sconosciuta');
  const total = entries.reduce((t, [, n]) => t + n, 0);
  if (total < 3) return null;
  const west = entries.filter(([k]) => WEST.has(k)).reduce((t, [, n]) => t + n, 0);
  if (west / total >= 0.5) return 'INT';
  const asia = {};
  for (const [k, n] of entries) if (ASIA[k]) asia[ASIA[k]] = (asia[ASIA[k]] || 0) + n;
  const [top, n] = Object.entries(asia).sort((a, b) => b[1] - a[1])[0] || [];
  if (!top) return null;
  return n / (total - west) >= 0.7 ? top : 'Asia';
}

export function regionFromName(name) {
  const n = String(name || '').toLowerCase();
  if (/\b(jp|japanese|japan)\b/.test(n)) return 'JAP';
  if (/chinese|simplified|traditional|gem pack|\b(zh|tc|sc)\b/.test(n)) return 'CN';
  if (/korean|\bkr\b/.test(n)) return 'KR';
  if (/\bthai\b|indonesian|asia/.test(n)) return 'Asia';
  return null;
}

/** Regioni indicate a mano dal proprietario per le espansioni che il giro non riconosce (id CardTrader). */
export const REGION_FIXED = {
  4868: 'CN', // Aura Seeker
  1982: 'JAP', // Awakening Legends Premium File 3
};
