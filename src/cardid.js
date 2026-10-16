// Riconoscimento carta: dal risultato del modello (testo) ai candidati nell'indice (logica pura, testabile).
import { normText } from './search.js';

export const SCAN_PROMPT = `You identify Pokémon trading cards from a photo.
Look at the card and answer with ONLY a JSON object, no other text:
{"name": "...", "number": "...", "total": "...", "set_code": "...", "language": "...", "variant": "...", "confidence": 0.0}
- name: the Pokémon or trainer card name in ENGLISH (translate if the card is in another language), e.g. "Charizard ex".
- number: the collector number printed at the bottom (the part before the slash), e.g. "137" or "TG05" or "SV001".
- total: the part after the slash, e.g. "103"; empty if there is no slash.
- set_code: the small set code printed near the number if visible (e.g. "sv3", "PAL", "SV11B"); empty if not visible.
- language: the language the card is PRINTED in, as a 2-letter code: en, ja, it, fr, de, es, pt, ko, zh.
- variant: "1st edition", "reverse holo", "holo", or "" if not visible.
- confidence: 0 to 1, how sure you are about name and number together.
If no card is visible, answer {"name": "", "confidence": 0}.`;

const LANG_MAP = { ja: 'jp', jp: 'jp', japanese: 'jp', en: 'en', english: 'en', it: 'it', italian: 'it', fr: 'fr', french: 'fr', de: 'de', german: 'de', es: 'es', spanish: 'es', pt: 'pt', portuguese: 'pt', ko: 'ko', kr: 'ko', korean: 'ko', zh: 'zh', chinese: 'zh', 'zh-tw': 'zh' };

/** Estrae il primo oggetto JSON dal testo del modello e lo normalizza. null se non c'è. */
export function parseScan(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let o;
  try {
    o = JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
  const clean = (v) => String(v == null ? '' : v).trim();
  let number = clean(o.number);
  let total = clean(o.total);
  const m = /^([A-Za-z]*\d+[A-Za-z]*)\s*\/\s*([A-Za-z]*\d+)$/.exec(number);
  if (m) { number = m[1]; total = total || m[2]; }
  const lang = LANG_MAP[clean(o.language).toLowerCase()] || '';
  const conf = Number(o.confidence);
  return {
    name: clean(o.name).slice(0, 80),
    number: number.slice(0, 12),
    total: total.slice(0, 12),
    setCode: clean(o.set_code || o.setCode).slice(0, 16),
    language: lang,
    variant: clean(o.variant).slice(0, 30),
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
  };
}

const stripZeros = (s) => String(s || '').replace(/^0+(?=\d)/, '').toLowerCase();

/**
 * Punteggio di una carta dell'indice rispetto a quanto letto sulla foto.
 * row = [id, name, version, ...]; version contiene di solito "Rarità | 137/103".
 */
export function scoreRow(row, scan, setCode = '') {
  const name = normText(row[1]);
  const version = String(row[2] || '');
  let score = 0;
  const want = normText(scan.name);
  if (want) {
    if (name === want) score += 6;
    else {
      const words = want.split(' ').filter((w) => w.length > 1);
      const hit = words.filter((w) => name.split(' ').includes(w)).length;
      if (words.length && hit === words.length) score += 4;
      else if (hit) score += 2 * (hit / words.length);
    }
  }
  if (scan.number) {
    const nums = [...version.matchAll(/([A-Za-z]*\d+[A-Za-z]*)\s*\/\s*([A-Za-z]*\d+)/g)];
    const single = /(?:^|[|\s#])([A-Za-z]{0,4}\d{1,4}[A-Za-z]?)\s*$/.exec(version);
    const n = stripZeros(scan.number);
    if (nums.some((x) => stripZeros(x[1]) === n)) {
      score += 5;
      if (scan.total && nums.some((x) => stripZeros(x[1]) === n && stripZeros(x[2]) === stripZeros(scan.total))) score += 3;
    } else if (single && stripZeros(single[1]) === n) score += 3;
  }
  if (scan.setCode && setCode && normText(scan.setCode) === normText(setCode)) score += 2;
  return score;
}
