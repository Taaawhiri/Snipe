// Riconoscimento carta: dal risultato del modello (testo) ai candidati nell'indice (logica pura, testabile).
import { normText } from './search.js';

export const SCAN_PROMPT = `You identify Pokémon trading cards from a photo.
Look at the card and answer with ONLY a JSON object, no other text:
{"name": "...", "number": "...", "total": "...", "set_code": "...", "language": "...", "text_sample": "...", "variant": "...", "era": "...", "set_guess": "...", "slab_company": "...", "slab_grade": "...", "slab_set": "...", "confidence": 0.0}
- name: the Pokémon or trainer card name in ENGLISH (translate if the card is in another language), e.g. "Charizard ex". Use the official English card name, not a literal translation: trainers and items often have different names (Italian "Lucinda" is "Dawn", "Camilla" is "Cynthia", "Ruggero" is "Lance").
- number: the collector number printed at the bottom (the part before the slash), e.g. "137" or "TG05" or "SV001". Old Japanese cards (1996-2005) often have no collector number: their "No. 040" is the Pokédex number, not the collector number, so leave number empty.
- total: the part after the slash, e.g. "103"; empty if there is no slash. Collector numbers rarely exceed 3 digits: on small print (Chinese cards) do not merge digits, "200/207" is number "200", total "207".
- set_code: the small set code printed in the bottom-left corner next to the number, copied exactly (e.g. "M6a", "sv3", "PAL"); empty if you cannot read it clearly. Never guess.
- language: the language the card is PRINTED in, as a 2-letter code: en, ja, it, fr, de, es, pt, ko, zh.
- text_sample: copy EXACTLY, character by character, 5 to 15 characters of the card name or attack text as printed (keep Japanese/Korean/Chinese characters as they are, do not translate).
- variant: "1st edition", "reverse holo", "holo", or "" if not visible.
- era: "vintage" if the card has the old layout (1996-2007: WOTC, Neo, e-Card, EX, old Japanese cards with yellow border and no regulation mark or collector number), otherwise "modern".
- set_guess: the English name of the set if you recognise it from the artwork, layout or set symbol (e.g. "Neo Genesis", "Team Rocket", "Base Set"); empty if unsure.
- slab_company, slab_grade, slab_set: only if the card is sealed in a grading slab (PSA, BGS/Beckett, CGC, SGC, ACE, TAG, PCG). Read the slab LABEL: company, numeric grade (e.g. "10", "9.5", "7.5") and the set name as written on the label (e.g. "Darkness, and to Light"). The label also gives the card name, year and language ("Japanese"): trust it. Empty strings if there is no slab.
- confidence: 0 to 1, how sure you are about name and number together.
If no card is visible, answer {"name": "", "confidence": 0}.`;

const LANG_MAP = { ja: 'jp', jp: 'jp', japanese: 'jp', en: 'en', english: 'en', it: 'it', italian: 'it', fr: 'fr', french: 'fr', de: 'de', german: 'de', es: 'es', spanish: 'es', pt: 'pt', portuguese: 'pt', ko: 'ko', kr: 'ko', korean: 'ko', zh: 'zh', chinese: 'zh', 'zh-tw': 'zh' };

/**
 * Lingua dalla scrittura del testo copiato dalla carta: più affidabile della lingua dichiarata dal modello.
 * Kana = giapponese; hangul = coreano; ideogrammi senza kana = cinese. null se è alfabeto latino o vuoto.
 */
export function langFromScript(text) {
  const t = String(text || '');
  if (/[\u3040-\u30ff]/.test(t)) return 'jp';
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(t)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(t)) return 'zh';
  if (/[\u0e00-\u0e7f]/.test(t)) return 'th';
  return null;
}

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
  const sample = clean(o.text_sample || o.textSample).slice(0, 60);
  // La scrittura del testo copiato vince sulla lingua dichiarata (il modello piccolo tende a dire "en").
  const lang = langFromScript(sample) || langFromScript(o.name_original) || LANG_MAP[clean(o.language).toLowerCase()] || '';
  const conf = Number(o.confidence);
  // Etichetta della slab: società e voto normalizzati come in collezione ("CGC 7.5").
  const SLAB = { psa: 'PSA', bgs: 'BGS', beckett: 'BGS', cgc: 'CGC', sgc: 'SGC', ace: 'ACE', tag: 'TAG', pcg: 'PCG' };
  const slabCo = SLAB[clean(o.slab_company).toLowerCase().split(/\s+/)[0]] || '';
  const gm = /^(10|[1-9](?:[.,]5)?)$/.exec(clean(o.slab_grade).replace(/\s+/g, ''));
  const slab = slabCo && gm ? { co: slabCo, g: gm[1].replace(',', '.'), set: clean(o.slab_set).slice(0, 80) } : null;
  return {
    name: clean(o.name).slice(0, 80),
    number: number.slice(0, 12),
    total: total.slice(0, 12),
    setCode: clean(o.set_code || o.setCode).slice(0, 16),
    language: lang,
    textSample: sample,
    variant: clean(o.variant).slice(0, 30),
    slab,
    era: /vintage/i.test(clean(o.era)) ? 'vintage' : /modern/i.test(clean(o.era)) ? 'modern' : '',
    setGuess: clean(o.set_guess).slice(0, 80),
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : null,
  };
}

/** Lingua di un'espansione dal nome: "30th Celebration JP", "... Simplified Chinese", "... Korean". */
export function expLang(name) {
  const n = String(name || '').toLowerCase();
  if (/\b(jp|japanese|japan)\b/.test(n)) return 'jp';
  if (/chinese|\b(zh|tc|sc)\b/.test(n)) return 'zh';
  if (/korean|\bkr\b/.test(n)) return 'ko';
  if (/\bthai\b/.test(n)) return 'th';
  if (/indonesian/.test(n)) return 'id';
  return null;
}

const stripZeros = (s) => String(s || '').replace(/^0+(?=\d)/, '').toLowerCase();

/**
 * Punteggio di una carta dell'indice rispetto a quanto letto sulla foto.
 * row = [id, name, version, ...]; version contiene di solito "Rarità | 137/103".
 */
// δ (Delta Species) e "Star" ★ diventano parole, così "Meganium δ" non è un Meganium qualsiasi.
const cardName = (t) => normText(String(t || '').replace(/δ/g, ' delta ').replace(/delta species/gi, 'delta').replace(/[★☆]/g, ' star ')).replace(/\b(delta|star)( \1\b)+/g, '$1');

const REGION_LANG = { JAP: 'jp', CN: 'zh', KR: 'ko' };
const ASIAN = ['jp', 'zh', 'ko', 'th', 'id'];

export function scoreRow(row, scan, setCode = '', expName = '', region = '', opts = {}) {
  const name = cardName(row[1]);
  const version = String(row[2] || '');
  let score = 0;
  let nameOk = true;
  const want = cardName(scan.name);
  if (want) {
    nameOk = false;
    if (name === want) { score += 6; nameOk = true; }
    else {
      const words = want.split(' ').filter((w) => w.length > 1);
      const hit = words.filter((w) => name.split(' ').includes(w)).length;
      // "Umbreon V" non è "Umbreon": il suffisso (V, VMAX, ex, GX…) deve esserci anche nel nome della carta.
      const SUF = ['v', 'vmax', 'vstar', 'ex', 'gx', 'lv x', 'break', 'prime'];
      const suf = (t) => SUF.find((x) => new RegExp(`(^| )${x}$`).test(t)) || '';
      const sameSuffix = suf(want) === suf(name);
      if (words.length && hit === words.length && sameSuffix) { score += 4; nameOk = true; }
      else if (words.length && hit === words.length) score += 2;
      else if (hit) score += 2 * (hit / words.length);
    }
  }
  // Il numero conta meno se il nome letto non torna: in set diversi lo stesso numero è un'altra carta
  // (es. 119/098 Persian coreana contro Ariana 119/098 giapponese).
  const nk = nameOk ? 1 : 0.4;
  if (scan.number) {
    const nums = [...version.matchAll(/([A-Za-z]*\d+[A-Za-z]*)\s*\/\s*([A-Za-z]*\d+)/g)];
    const single = /(?:^|[|\s#])([A-Za-z]{0,4}\d{1,4}[A-Za-z]?)\s*$/.exec(version);
    let n = stripZeros(scan.number);
    // Numero letto con una cifra in più (es. "2007/07" per 200/207): proviamo le prime tre cifre.
    if (/^\d{4,}$/.test(n) && !nums.some((x) => stripZeros(x[1]) === n)) n = stripZeros(n.slice(0, 3));
    if (nums.some((x) => stripZeros(x[1]) === n)) {
      score += 5 * nk;
      if (scan.total && nums.some((x) => stripZeros(x[1]) === n && stripZeros(x[2]) === stripZeros(scan.total))) score += 3 * nk;
    } else if (single && stripZeros(single[1]) === n) score += 3 * nk;
  }
  if (scan.setCode && setCode && normText(scan.setCode) === normText(setCode)) score += 2;
  // Epoca (vintage/moderna) vista dal layout: le vecchie carte giapponesi non hanno numero, così si distinguono dalle ristampe.
  // Solo bonus: alcuni set di passaggio (es. δ giapponesi del 2007) non risultano "vintage" nel nostro elenco.
  if (scan.era && opts.era === scan.era) score += 3;
  // Set riconosciuto dal modello (meno sicuro dell'etichetta della slab).
  if (scan.setGuess && expName) {
    const gw = normText(scan.setGuess).split(' ').filter((w) => w.length > 2 && !['and', 'the', 'set'].includes(w));
    const ew = normText(expName).split(' ');
    if (gw.length && gw.filter((w) => ew.includes(w)).length / gw.length >= 0.6) score += 4;
  }
  // Set scritto sull'etichetta della slab: se le parole tornano col nome dell'espansione, è quasi certamente lei.
  if (scan.slab && scan.slab.set && expName) {
    const sw = normText(scan.slab.set).split(' ').filter((w) => w.length > 2 && !['and', 'the', 'pokemon', 'japanese'].includes(w));
    const ew = normText(expName).split(' ');
    const hit = sw.filter((w) => ew.includes(w)).length;
    if (sw.length && hit / sw.length >= 0.6) score += 6;
  }
  // Lingua dell'espansione (CardTrader separa le edizioni giapponesi, cinesi, coreane, thai).
  // La regione dell'espansione (stessa usata nel selettore) vale più del nome: i set giapponesi vintage non dicono "Japanese".
  const el = REGION_LANG[region] || expLang(`${expName} ${setCode}`) || (region === 'INT' ? 'int' : null);
  // Lingua sbagliata pesa più di un numero giusto: la stessa carta esiste in più edizioni con lo stesso numero.
  if (el === 'int') { if (scan.language) score += ASIAN.includes(scan.language) ? -5 : 1; }
  else if (scan.language && el) score += el === scan.language ? 3 : -5;
  else if (scan.language === 'en' && el && el !== 'en') score -= 3;
  return score;
}
