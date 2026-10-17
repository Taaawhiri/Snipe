// Funzioni pure per l'indice dei nomi delle carte (ricerca su tutte le espansioni).

const IMG_PREFIX = 'https://cardtrader.com/uploads/blueprints/image/';

/** Minuscolo, senza accenti né punteggiatura: "Pokémon's" diventa "pokemon s". */
export function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function queryTerms(q) {
  return normText(q).split(' ').filter(Boolean);
}

/** Tutti i termini devono comparire nel nome. */
export function matchesTerms(nameNorm, terms) {
  return terms.length > 0 && terms.every((t) => nameNorm.includes(t));
}

/** Più basso = più pertinente: nome identico, poi nome che inizia con la ricerca, poi il resto. */
export function relevance(nameNorm, terms) {
  const q = terms.join(' ');
  if (nameNorm === q) return 0;
  if (nameNorm.startsWith(q)) return 1;
  if (nameNorm.split(' ').some((w) => w.startsWith(terms[0]))) return 2;
  return 3;
}

/** Accorcia l'indirizzo dell'immagine: l'indice contiene migliaia di carte. */
export function packImg(id, url) {
  if (!url) return '';
  const pre = `${IMG_PREFIX}${id}/preview_${id}-`;
  return url.startsWith(pre) ? url.slice(pre.length) : url;
}

export function unpackImg(id, packed) {
  if (!packed) return null;
  return /^https?:/.test(packed) ? packed : `${IMG_PREFIX}${id}/preview_${id}-${packed}`;
}

const z = (s) => String(s || '').replace(/^0+(?=\d)/, '').toLowerCase();

/**
 * Ricerca con il numero della carta: "Charizard 198/195", "198/195" o "Pikachu 25".
 * Le parole cercano nel nome; "198/195" (o un numero da solo, se c'è anche un nome) cerca nel numero.
 */
export function splitQuery(q) {
  let s = String(q || '');
  const nums = [];
  s = s.replace(/#?\b([a-z]*\d+[a-z]*)\s*\/\s*([a-z]*\d+)\b/gi, (m, n, t) => { nums.push({ n: z(n), t: z(t) }); return ' '; });
  const words = queryTerms(s);
  // Un numero da solo vale come numero di carta solo se c'è anche un nome ("Pikachu 25"), altrimenti resta testo ("151").
  const named = words.filter((w) => !/^\d+$/.test(w));
  if (named.length) for (const w of words.filter((x) => /^\d+$/.test(x))) nums.push({ n: z(w), t: '' });
  return { words: named.length ? named : words, nums };
}

/** La carta (nome normalizzato + versione "Rarità | 198/195") rispetta la ricerca? */
export function matchesQuery(nameNorm, version, parsed) {
  if (parsed.words.length && !parsed.words.every((t) => nameNorm.includes(t))) return false;
  if (!parsed.nums.length) return parsed.words.length > 0;
  const found = [...String(version || '').matchAll(/([A-Za-z]*\d+[A-Za-z]*)\s*\/\s*([A-Za-z]*\d+)/g)].map((m) => ({ n: z(m[1]), t: z(m[2]) }));
  const single = /(?:^|[|\s#])([A-Za-z]{0,4}\d{1,4}[A-Za-z]?)\s*$/.exec(String(version || ''));
  if (single) found.push({ n: z(single[1]), t: '' });
  return parsed.nums.every((q) => found.some((f) => f.n === q.n && (!q.t || !f.t || f.t === q.t)));
}
