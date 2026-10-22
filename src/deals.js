// Logica pura per riconoscere gli annunci con prezzo anomalo. Nessuna dipendenza da Cloudflare, quindi testabile.

export const CONDITIONS = [
  'Poor',
  'Heavily Played',
  'Played',
  'Moderately Played',
  'Slightly Played',
  'Near Mint',
  'Mint',
];

export function condRank(name) {
  const n = String(name || '').toLowerCase();
  return CONDITIONS.findIndex((c) => c.toLowerCase() === n);
}

export function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Il venditore accetta ordini via CardTrader Zero (campo user.can_sell_via_hub dell'API). */
export function isZero(p) {
  return !!(p && p.user && p.user.can_sell_via_hub);
}

// Società di gradazione: su CardTrader il voto è quasi sempre scritto solo nel commento ("PSA 10", "BGS 9.5").
const GRADERS = { psa: 'PSA', bgs: 'BGS', beckett: 'BGS', cgc: 'CGC', sgc: 'SGC', ace: 'ACE', tag: 'TAG', pcg: 'PCG' };
const GRADE_RE = /\b(psa|bgs|beckett|cgc|sgc|ace|tag|pcg)\s*[-:]?\s*(10|[1-9](?:[.,]5)?)\b/i;

/** Società e voto di un annuncio gradato, letti dal commento. null se non indicati. */
export function gradeOf(p) {
  const m = GRADE_RE.exec(String((p && p.description) || ''));
  return m ? { co: GRADERS[m[1].toLowerCase()], g: m[2].replace(',', '.') } : null;
}

/** Gradata: segnata così da CardTrader oppure con il voto nel commento (molti venditori non la segnano). */
export function isGraded(p) {
  return !!(p && (p.graded || gradeOf(p)));
}

/** "PSA 10" → { co: 'PSA', g: '10' }; per le copie gradate in collezione la condizione è scritta così. */
export function parseGradeLabel(s) {
  const m = /^(PSA|BGS|CGC|SGC|ACE|TAG|PCG) (10|[1-9](?:\.5)?)$/.exec(String(s || ''));
  return m ? { co: m[1], g: m[2] } : null;
}

/** Annuncio acquistabile: non gradato, non in vacanza, disponibile e con un prezzo. */
export function isListable(p) {
  if (!p || isGraded(p) || p.on_vacation) return false;
  if (!(p.quantity > 0)) return false;
  return !!(p.price && p.price.cents > 0);
}

const LANGS = {
  ja: 'jp', jp: 'jp', japanese: 'jp', japan: 'jp',
  en: 'en', english: 'en',
  it: 'it', italian: 'it',
  fr: 'fr', french: 'fr',
  de: 'de', german: 'de',
  es: 'es', spanish: 'es',
  pt: 'pt', portuguese: 'pt',
  ko: 'ko', kr: 'ko', korean: 'ko',
  zh: 'zh', 'zh-cn': 'zh', 'zh-tw': 'zh', chinese: 'zh',
  ru: 'ru', russian: 'ru',
  th: 'th', thai: 'th',
};

/** Normalizza i codici lingua (CardTrader e il nostro menu non usano gli stessi per il giapponese). */
export function normLang(v) {
  const s = String(v || '').toLowerCase().trim();
  return LANGS[s] || s;
}

/** Lingua dell'annuncio, qualunque sia il nome del campo nelle proprietà del gioco. */
export function listingLang(p) {
  if (!p) return null;
  const h = p.properties_hash || {};
  const k = Object.keys(h).find((x) => /lang|idioma|sprache|langue/i.test(x));
  if (k && h[k]) return String(h[k]);
  // Se il campo ha un nome inatteso, cerchiamo un valore che sia un codice o un nome di lingua noto.
  for (const v of Object.values(h)) {
    if (typeof v === 'string' && Object.hasOwn(LANGS, v.toLowerCase().trim())) return v;
  }
  const top = p.language || p.lang;
  return top ? String(top) : null;
}

/** Motivi per cui un annuncio non rispetta i filtri della regola. Lista vuota = valido. */
export function rejectReasons(p, rule) {
  const out = [];
  if (!p) return ['annuncio mancante'];
  if (isGraded(p)) out.push('carta gradata');
  if (p.on_vacation) out.push('venditore in vacanza');
  if (!(p.quantity > 0)) out.push('non disponibile');
  if (!(p.price && p.price.cents > 0)) out.push('senza prezzo');
  if (rule.nameContains) {
    const hay = String(p.name_en || '').toLowerCase();
    if (!hay.includes(String(rule.nameContains).toLowerCase())) out.push('nome diverso');
  }
  const z = isZero(p);
  if (rule.zero === 'only' && !z) out.push('venditore senza CardTrader Zero');
  if (rule.zero === 'exclude' && z) out.push('venditore con CardTrader Zero (escluso)');
  const min = condRank(rule.minCondition);
  const cond = p.properties_hash && p.properties_hash.condition;
  const r = condRank(cond);
  if (min >= 0 && r >= 0 && r < min) out.push(`condizione ${cond} sotto il minimo`);
  const lang = listingLang(p);
  if (rule.language && lang && !String(rule.language).split(',').some((l) => normLang(lang) === normLang(l))) out.push(`lingua ${lang} diversa`);
  return out;
}

function eligible(p, rule) {
  return rejectReasons(p, rule).length === 0;
}

/**
 * products: oggetto { [blueprintId]: Product[] } come restituito da /marketplace/products.
 *
 * Due modalità:
 * - rule.maxPriceCents: scatta per ogni annuncio con prezzo <= soglia (prezzo assoluto).
 * - altrimenti sconto percentuale: i 3 annunci più economici di ogni carta vengono
 *   confrontati con la mediana dei successivi (fino a 5).
 *
 * rule.blueprintId limita il controllo a una sola carta.
 */
export function findDeals(products, rule, opts = {}) {
  const { checkTop = 3, refCount = 5, minRefs = 3, minSavingCents = 100, maxPerCard = 5 } = opts;
  const minDiscount = (rule.minDiscount ?? 30) / 100;
  const minPrice = rule.minPriceCents ?? 0;
  const out = [];

  for (const [bp, list] of Object.entries(products || {})) {
    if (!Array.isArray(list)) continue;
    if (rule.blueprintId && String(bp) !== String(rule.blueprintId)) continue;
    const ok = list.filter((p) => eligible(p, rule)).sort((a, b) => a.price.cents - b.price.cents);

    if (rule.maxPriceCents > 0) {
      for (let i = 0; i < Math.min(maxPerCard, ok.length); i++) {
        const p = ok[i];
        if (p.price.cents > rule.maxPriceCents) break;
        const refs = ok.slice(i + 1, i + 1 + refCount).map((x) => x.price.cents);
        const ref = refs.length ? median(refs) : p.price.cents;
        out.push({ product: p, cents: p.price.cents, refCents: Math.round(ref), discount: Math.max(0, 1 - p.price.cents / ref) });
      }
      continue;
    }

    for (let i = 0; i < Math.min(checkTop, ok.length); i++) {
      const p = ok[i];
      const refs = ok.slice(i + 1, i + 1 + refCount).map((x) => x.price.cents);
      if (refs.length < minRefs) continue;
      const ref = median(refs);
      const discount = 1 - p.price.cents / ref;
      if (discount < minDiscount) continue;
      if (p.price.cents < minPrice) continue;
      if (ref - p.price.cents < minSavingCents) continue;
      out.push({ product: p, cents: p.price.cents, refCents: Math.round(ref), discount });
    }
  }
  return out;
}

// Nomi che indicano prodotti sigillati o accessori, mai carte singole.
export const SEALED_NAME = /\b(booster|boosters|box|boxes|display|bundle|deck|decks|tin|tins|collection|collections|case|pack|packs|elite trainer|etb|trainer kit|kit|sleeve|sleeves|playmat|mat|binder|portfolio|album|folder|coin|blister|starter|figure|pin|pins|build\s*&\s*battle|prerelease|promo set|gift|calendar|poster|mug|dice|marker|counter|lot|bulk|jumbo|oversize)\b/i;

/**
 * Distingue le carte singole dai prodotti sigillati e dagli accessori.
 * Su CardTrader le singole Pokémon hanno nella versione rarità e numero ("Holo Rare | 137/103").
 */
export function isSingleCard(bp, singleCategoryIds) {
  if (SEALED_NAME.test(String(bp.name || ''))) return false;
  if (typeof bp.version === 'string' && bp.version.includes('|')) return true;
  if (singleCategoryIds) return singleCategoryIds.includes(bp.category_id);
  return true;
}

/**
 * Venditore poco affidabile secondo CardTrader: troppe richieste di annullamento come venditore.
 * (Il tetto di vendite giornaliero non conta: lo hanno anche venditori grandi e affidabili.)
 */
export function isRiskySeller(p) {
  const u = p && p.user;
  return !!u && u.too_many_request_for_cancel_as_seller === true;
}

/** Tetto di vendite in 24 ore indicato da CardTrader: solo un'informazione, non esclude l'annuncio. */
export function sellLimitOf(p) {
  const u = p && p.user;
  return u && u.max_sellable_in24h_quantity != null && u.max_sellable_in24h_quantity !== '' ? u.max_sellable_in24h_quantity : null;
}
