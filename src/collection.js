// Collezione: prezzo attuale di ogni carta posseduta (logica pura, testabile).
import { condRank, gradeOf, isListable, isRiskySeller, isZero, listingLang, normLang, parseGradeLabel } from './deals.js';
import { estimateFrom, isFirstEd, isReverse } from './ratios.js';

export const COLL_LANGS = ['en', 'it', 'jp', 'fr', 'de', 'es', 'pt', 'ko', 'zh'];

export function collKey(bp, lang, cond, first = false, reverse = false) {
  return `${bp}|${lang || ''}|${cond || ''}${first ? '|1st' : ''}${reverse ? '|rev' : ''}`;
}

export { isFirstEd, isReverse } from './ratios.js';

/** Stima di una gradata da un prezzo di base (copia non gradata o tendenza Cardmarket). */
export function gradedFromBase(base, grade) {
  const g = Number(grade.g);
  const f = GRADER_FACTOR[grade.co] || 0.75;
  let cents = Math.round(base * Math.max(1, (GRADE_MULT[grade.g] || 1) * f));
  // Una slab vale almeno la carta più una parte del costo di gradazione (più alta per i voti alti).
  const share = g >= 10 ? 1.6 : g >= 9.5 ? 1.3 : g >= 9 ? 1 : g >= 8.5 ? 0.8 : g >= 8 ? 0.7 : g >= 7.5 ? 0.6 : g >= 7 ? 0.5 : 0;
  if (share) cents = Math.max(cents, base + Math.round(GRADING_COST_CENTS * share * f));
  return cents;
}

/**
 * Valore di una copia: il prezzo più basso tra gli annunci nella stessa lingua e in condizione
 * uguale o migliore. Se non ce ne sono, il più basso in assoluto, segnato come approssimato.
 */
const TYPICAL_N = 5;
const OUTLIER_RATIO = 0.6; // il prezzo "tipico" è la mediana dei 5 annunci adatti più economici

function median(nums) {
  const m = nums.length >> 1;
  return nums.length % 2 ? nums[m] : Math.round((nums[m - 1] + nums[m]) / 2);
}

/**
 * opts.blocked: venditori esclusi dall'utente (Set di username), ignorati anche qui.
 * Restituisce per tutti i venditori e per i soli Zero sia il più basso sia il tipico.
 */
// Stima di una gradata senza annunci con lo stesso voto: prezzo della copia non gradata × moltiplicatore del voto.
// Valori prudenti e medi: il premio reale cambia molto da carta a carta.
const GRADE_MULT = { '10': 2.5, '9.5': 1.8, '9': 1.4, '8.5': 1.2, '8': 1.1, '7.5': 1, '7': 1, '6.5': 1, '6': 1, '5.5': 1, '5': 1 };
const GRADER_FACTOR = { PSA: 1, BGS: 1, CGC: 0.85, SGC: 0.85 }; // le altre società: 0.75
const GRADING_COST_CENTS = 2500; // costo indicativo di una gradazione: una 9 o 10 vale almeno la carta più questo

export function estimateGraded(list, lang, grade, opts = {}) {
  const g = Number(grade.g);
  // Sotto 8 la slab vale circa come una copia non gradata nella condizione corrispondente.
  // Base: 7 e oltre partono dalla Near Mint, 5-6.5 dalla Slightly Played, sotto dalla Moderately Played.
  const rawCond = g >= 7 ? 'Near Mint' : g >= 5 ? 'Slightly Played' : 'Moderately Played';
  const rawAny = priceFor(list, lang, rawCond, opts);
  let base = null;
  let how = '';
  // 1) Copie non gradate nella stessa lingua e condizione.
  // Si parte dal prezzo più basso: il "tipico" su carte con pochi annunci è falsato da quelli molto cari.
  if (rawAny && !rawAny.approx) { base = rawAny.cents; how = `copia non gradata ${rawCond} più economica`; }
  // 2) Gradate con altri voti (prima nella stessa lingua), riportate a "non gradata" col loro moltiplicatore.
  if (base == null) {
    const want = normLang(lang);
    const others = (list || []).filter((p) => p && !p.on_vacation && p.quantity > 0 && p.price && p.price.cents > 0 && gradeOf(p))
      .map((p) => ({ p, gr: gradeOf(p) })).filter(({ gr }) => GRADE_MULT[gr.g]);
    const sameLang = others.filter(({ p }) => !want || normLang(listingLang(p)) === want);
    const pool = sameLang.length ? sameLang : others;
    if (pool.length) {
      const bases = pool.map(({ p, gr }) => p.price.cents / Math.max(1, GRADE_MULT[gr.g] * (GRADER_FACTOR[gr.co] || 0.75))).sort((x, y) => x - y);
      base = Math.round(bases[0]);
      how = `${pool.length} annunci gradati con altri voti`;
    }
  }
  // 3) Ultima risorsa: copie non gradate di altre lingue o condizioni.
  if (base == null && rawAny) { base = rawAny.cents; how = 'copie non gradate di altre lingue o condizioni'; }
  if (base == null) return null;
  const cents = gradedFromBase(base, grade);
  return { cents, typCents: cents, approx: true, estimated: true, rawCents: base, how, listings: 0, graded: `${grade.co} ${grade.g}`, zeroCents: null, zeroTypCents: null, zeroApprox: null };
}

export function priceFor(list, lang, cond, opts = {}) {
  const blocked = opts.blocked || new Set();
  // Copia gradata ("PSA 10"): si confronta solo con annunci della stessa società e dello stesso voto.
  const grade = parseGradeLabel(cond);
  // Venditori poco affidabili (segnalati da CardTrader) esclusi dal valore, se l'opzione è attiva.
  const usable = (p) => p && !p.on_vacation && p.quantity > 0 && p.price && p.price.cents > 0 && !(p.user && blocked.has(p.user.username)) && !(opts.reliable && isRiskySeller(p));
  // Reverse holo: la copia si confronta con gli annunci reverse, quella normale con i non reverse (hanno prezzi diversi).
  // Se non ce ne sono della stessa variante si usano gli altri, segnato come approssimato.
  let revApprox = false;
  if (!grade && opts.reverse != null) {
    const same = (list || []).filter((p) => isReverse(p) === !!opts.reverse);
    if (same.some((p) => usable(p) && isListable(p))) list = same;
    else if ((list || []).some((p) => usable(p) && isListable(p))) revApprox = true;
  }
  let ok = (list || []).filter((p) => {
    if (!usable(p)) return false;
    if (!grade) return isListable(p);
    const g = gradeOf(p);
    return g && g.co === grade.co && g.g === grade.g;
  }).sort((a, b) => a.price.cents - b.price.cents);
  const want = normLang(lang);
  const min = condRank(cond);
  const fitsLC = (p) => (!want || normLang(listingLang(p)) === want) && (grade || min < 0 || condRank(p.properties_hash && p.properties_hash.condition) >= min);
  const label = grade ? `${grade.co} ${grade.g}` : null;
  // "Più basso affidabile": un annuncio molto sotto i successivi (meno del 60% della mediana dei 3 dopo) è un'anomalia
  // (errore, copia rovinata, svendita) e si scarta, al massimo 2 volte. Con meno di 3 annunci dopo non si può dire: si tiene.
  const stats = (arr) => {
    if (!arr.length) return null;
    let i = 0;
    const skipped = [];
    while (i < 2 && arr.length - i - 1 >= 3) {
      const ref = median(arr.slice(i + 1, i + 4).map((p) => p.price.cents));
      if (arr[i].price.cents >= OUTLIER_RATIO * ref) break;
      skipped.push(arr[i].price.cents);
      i++;
    }
    const rest = arr.slice(i);
    const ref = skipped.length ? median(rest.slice(0, 3).map((p) => p.price.cents)) : null;
    return { low: rest[0].price.cents, typ: median(arr.slice(0, TYPICAL_N).map((p) => p.price.cents)), skipped, ref };
  };

  // 1) Combinazione esatta (lingua, condizione o voto, edizione): il prezzo vero, il più basso.
  const exact = ok.filter((p) => fitsLC(p) && (opts.first == null || isFirstEd(p) === !!opts.first));
  if (exact.length) {
    const all = stats(exact);
    const zero = stats(exact.filter(isZero)); // nessuno Zero giusto: pickPrice usa il prezzo di tutti, segnato "non Zero"
    return {
      cents: all.low, typCents: all.typ, approx: revApprox, edApprox: false, revApprox, lowLang: want || '', listings: exact.length, graded: label,
      skipped: all.skipped.length ? all.skipped : undefined, skipRef: all.skipped.length ? all.ref : undefined,
      zeroSkipped: zero && zero.skipped.length ? zero.skipped : undefined, zeroSkipRef: zero && zero.skipped.length ? zero.ref : undefined,
      zeroCents: zero ? zero.low : null, zeroTypCents: zero ? zero.typ : null, zeroApprox: zero ? revApprox : null, zeroLowLang: zero ? want || '' : null,
    };
  }

  // 2) Combinazione assente: stima dall'annuncio più vicino con i rapporti di mercato ricavati da CardTrader.
  if (opts.ratios) {
    const est = estimateFrom(opts.reliable ? (list || []).filter((p) => !isRiskySeller(p)) : list, { lang: want || 'en', cond, grade: label, first: !!opts.first }, opts.ratios, opts.era || 'modern', blocked);
    if (est) {
      return {
        cents: est.cents, typCents: est.cents, zeroCents: est.cents, zeroTypCents: est.cents, zeroApprox: true,
        approx: true, estimated: true, est: { from: est.from, parts: est.parts }, listings: 0, graded: label,
      };
    }
  }

  // 3) Senza rapporti affidabili: i ripieghi di prima (altra edizione, altra lingua, stima fissa delle gradate).
  if (!ok.length) return grade ? estimateGraded(list, lang, grade, opts) : null;
  // Edizione: lingua e condizione contano di più (l'edizione spesso non è indicata nell'annuncio).
  // Tra gli annunci giusti per lingua e condizione si preferiscono quelli della stessa edizione; se non ce ne sono, si usano gli altri.
  let edApprox = false;
  if (opts.first != null) {
    const good = ok.filter(fitsLC);
    const sameEd = good.filter((p) => isFirstEd(p) === !!opts.first);
    if (sameEd.length) ok = ok.filter((p) => !fitsLC(p) || isFirstEd(p) === !!opts.first);
    else if (opts.first && good.length) edApprox = true;
  }
  const fits = fitsLC;
  const pickSet = (arr) => {
    const m = arr.filter(fits);
    const base = m.length ? m : arr; // nessun annuncio nella lingua/condizione: tutti, segnato come approssimato
    if (!base.length) return null;
    return { low: base[0].price.cents, typ: median(base.slice(0, TYPICAL_N).map((p) => p.price.cents)), approx: !m.length, n: Math.min(TYPICAL_N, base.length), lowLang: normLang(listingLang(base[0])) || '' };
  };
  const all = pickSet(ok);
  // Solo Zero: un annuncio Zero in un'altra lingua non vale più di uno giusto non Zero (es. 1ª ed. giapponese a 70 € vs inglese Zero).
  const z = pickSet(ok.filter(isZero));
  const zero = z && z.approx && !all.approx ? null : z;
  return {
    cents: all.low,
    typCents: all.typ,
    approx: all.approx || edApprox || revApprox,
    revApprox,
    lowLang: all.lowLang,
    zeroLowLang: zero ? zero.lowLang : null,
    edApprox,
    listings: ok.length,
    graded: grade ? `${grade.co} ${grade.g}` : null,
    zeroCents: zero ? zero.low : null,
    zeroTypCents: zero ? zero.typ : null,
    zeroApprox: zero ? zero.approx : null,
  };
}

/** Prezzo da usare: tutti gli annunci o solo Zero; il più basso o il tipico. */
export function pickPrice(p, zeroOnly, typical = false) {
  if (!p) return null;
  if (zeroOnly) {
    // Nessun annuncio Zero adatto: si usa il prezzo di tutti i venditori, segnato.
    if (p.zeroCents == null) return p.cents == null ? null : { ...p, cents: typical && p.typCents != null ? p.typCents : p.cents, notZero: true };
    return { ...p, cents: typical && p.zeroTypCents != null ? p.zeroTypCents : p.zeroCents, approx: p.zeroApprox, lowLang: p.zeroLowLang, skipped: typical ? undefined : p.zeroSkipped, skipRef: p.zeroSkipRef };
  }
  return typical && p.typCents != null ? { ...p, cents: p.typCents, skipped: undefined } : p;
}

/** Opzione "il minore tra CardTrader e Cardmarket": se la tendenza Cardmarket è più bassa, il valore della copia è quella. */
export function capToCm(price, cmCents) {
  if (!price || cmCents == null || !(cmCents > 0) || price.cents <= cmCents) return price;
  return { ...price, cents: cmCents, ctCents: price.cents, cmCapped: true };
}

/** Totali: valore, speso, quantità, copie senza prezzo. */
export function summarize(items) {
  let value = 0;
  let paid = 0;
  let qty = 0;
  let missing = 0;
  let cm = 0;
  let paidPriced = 0; // speso per le sole copie con un prezzo: base del guadagno teorico
  let valueKnown = 0; // valore delle copie con prezzo pagato indicato (anche 0, es. trovate in una busta)
  let known = 0;
  for (const it of items) {
    qty += it.qty;
    if (it.price) {
      value += it.price.cents * it.qty;
      if (it.paidCents != null) { paidPriced += it.paidCents * it.qty; valueKnown += it.price.cents * it.qty; known += it.qty; }
    } else missing += it.qty;
    if (it.paidCents != null) paid += it.paidCents * it.qty;
    if (it.cmCents) cm += it.cmCents * it.qty;
  }
  return { value, paid, qty, distinct: items.length, missing, cm, paidPriced, valueKnown, known };
}

/**
 * Controllo con lo storico della stessa copia (lingua, condizione, edizione): se oggi il prezzo più basso
 * crolla sotto la metà della mediana degli ultimi 30 giorni, è quasi sempre un annuncio anomalo e si usa la mediana.
 * Serve almeno 10 giorni di storico. Restituisce il prezzo (eventualmente corretto) e lo storico aggiornato.
 * hist: [[giorno 'YYYY-MM-DD', centesimi], ...]
 */
export const HIST_MIN_DAYS = 10;
export function checkAgainstHistory(pr, hist, day) {
  const h = Array.isArray(hist) ? hist : [];
  if (!pr || pr.cents == null || pr.estimated || pr.approx) return { pr, hist: h };
  const recent = h.slice(-30).map((x) => x[1]).filter((x) => x > 0).sort((a, b) => a - b);
  const med = recent.length >= HIST_MIN_DAYS ? median(recent) : null;
  let out = pr;
  if (med && pr.cents < 0.5 * med) {
    out = { ...pr, cents: med, histAnomaly: { low: pr.cents, med, days: recent.length } };
    if (pr.zeroCents != null && pr.zeroCents < 0.5 * med) out.zeroCents = med;
  }
  // Nello storico entra il valore normale del giorno (non quello anomalo), uno per giorno.
  let nh = h;
  if (!out.histAnomaly) {
    nh = h.length && h[h.length - 1][0] === day ? [...h.slice(0, -1), [day, pr.cents]] : [...h, [day, pr.cents]];
    nh = nh.slice(-40);
  }
  return { pr: out, hist: nh };
}
