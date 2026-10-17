// Espansioni vintage: era WOTC (fino a metà 2003, comprese le prime giapponesi dal 1996) ed era EX (2003–2007).
// Si decide dalla data di uscita su CardTrader (src/expdates.js), non dal nome: niente set dimenticati o scambiati.
import { RELEASED } from './expdates.js';

// Giapponesi dell'inizio 2003 che aprono già l'era EX (serie ADV).
const ADV_JP = new Set([3411, 1991, 3679, 3680, 3681, 1992]);
// Inizio dell'era Diamante & Perla in Giappone, prima della fine dell'era EX in occidente.
const DP_EARLY = new Set([3420, 2007, 3426]);
// Raccolte che mescolano tutte le epoche.
const MIXED = new Set([4373]);

/** 'WOTC', 'EX' oppure null. */
export function vintageEra(id) {
  const d = RELEASED[id];
  if (!d || MIXED.has(id) || DP_EARLY.has(id)) return null;
  if (d < '2003-06-01' && !ADV_JP.has(id)) return 'WOTC';
  if (d <= '2007-02-28') return 'EX';
  return null;
}
