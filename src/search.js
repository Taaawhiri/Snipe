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
