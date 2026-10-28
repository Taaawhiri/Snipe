// Valutazione del prezzo di una carta di un alert. Il voto lo calcola il codice dai dati (storico, annunci, Cardmarket);
// il commento in parole lo scrive Claude partendo da quei numeri, senza inventarne altri.
import { isListable, listingLang, normLang, condRank } from './deals.js';
import { isRiskySeller, isZero } from './deals.js';

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

/** Posizione di `cents` tra i prezzi storici: 0 = il più basso mai visto, 1 = il più alto. null con meno di 5 giorni di storico. */
export function percentileIn(hist, cents, days) {
  const cut = days ? hist.slice(-days) : hist;
  const mins = cut.map((p) => p.min).filter((v) => v > 0);
  if (mins.length < 5 || !(cents > 0)) return null;
  return mins.filter((v) => v < cents).length / mins.length;
}

/**
 * Storico adatto alla ricerca: senza lingua è quello di tutte le lingue; con una o più lingue (es. "ja") si usano solo i giorni
 * in cui è stato salvato il prezzo di quella lingua (i giorni vecchi, salvati senza lingua, si scartano: sarebbero confronti sbagliati).
 */
export function histForLangs(hist, langs) {
  const h = (hist || []).filter((p) => p && p.min > 0);
  if (!langs || !langs.length) return h;
  const out = [];
  for (const p of h) {
    if (!p.l) continue;
    const es = langs.map((x) => p.l[x]).filter(Boolean);
    if (!es.length) continue;
    out.push({ d: p.d, min: Math.min(...es.map((e) => e[0])), n: es.reduce((t, e) => t + e[1], 0) });
  }
  return out;
}

/**
 * Prezzo consigliato per l'alert: abbastanza basso da essere un buon affare, abbastanza alto da scattare davvero.
 * Con almeno 5 giorni di storico è il 20° percentile dei prezzi più bassi (limitato dalla tendenza Cardmarket −10%);
 * senza storico si parte da Cardmarket −15% o dal prezzo tipico −10%. Mai sopra il prezzo di adesso né sotto il minimo storico −3%.
 */
export function suggestPrice({ hist = [], lowCents, typicalCents, cmCents }) {
  const mins = (hist || []).slice(-90).map((p) => p.min).filter((v) => v > 0).sort((a, b) => a - b);
  let c = null;
  let why = '';
  if (mins.length >= 5) {
    c = mins[Math.floor(mins.length * 0.2)];
    why = `il prezzo che negli ultimi ${mins.length} giorni è stato battuto solo 1 giorno su 5`;
    if (cmCents && c > cmCents * 0.9) { c = Math.round(cmCents * 0.9); why = 'circa il 10% sotto la tendenza Cardmarket'; }
    c = Math.max(c, Math.round(mins[0] * 0.97));
  } else if (cmCents) { c = Math.round(cmCents * 0.85); why = 'circa il 15% sotto la tendenza Cardmarket (storico ancora breve)'; }
  else if (typicalCents) { c = Math.round(typicalCents * 0.9); why = 'circa il 10% sotto il prezzo tipico (storico ancora breve)'; }
  if (!(c > 0)) return null;
  if (lowCents && c >= lowCents) return { cents: lowCents, why: 'è già vicino al tuo obiettivo: puoi comprare adesso', now: true };
  const step = c >= 1000 ? 50 : 10; // arrotonda a 0,50 € sopra i 10 €, a 0,10 € sotto
  return { cents: Math.max(step, Math.round(c / step) * step), why, now: false };
}

/**
 * Fatti sul prezzo: annunci ancora acquistabili che rispettano lingua e condizione dell'alert, storico giornaliero
 * (hist: [{d, min, n}]), tendenza Cardmarket (cmCents) e soglia dell'alert (limitCents).
 */
export function appraisalFacts({ products, hist = [], rule = {}, cmCents = null, limitCents = null, reliable = true }) {
  const lang = rule.language ? rule.language.split(',').map(normLang) : [];
  const minC = rule.minCondition ? condRank(rule.minCondition) : -1;
  const ok = (products || []).filter((p) => p && p.price && p.price.cents > 0 && isListable(p) && !(reliable && isRiskySeller(p))
    && (!lang.length || lang.includes(normLang(listingLang(p)))) && (minC < 0 || condRank(p.properties_hash && p.properties_hash.condition) >= minC))
    ;
  const okP = ok.slice().sort((a, b) => a.price.cents - b.price.cents);
  const cheapest = okP[0];
  const zeroCents = okP.filter(isZero).map((p) => p.price.cents);
  const ok2 = okP.map((p) => p.price.cents);
  if (!ok2.length) return { listings: 0 };
  const low = ok2[0];
  const typ = median(ok2.slice(0, 5));
  // Lo storico è delle copie Near Mint o migliori: il confronto si fa con il più basso NM+ di adesso, non con quello di una copia più rovinata.
  const nmLow = okP.filter((p) => condRank(p.properties_hash && p.properties_hash.condition) >= condRank('Near Mint')).map((p) => p.price.cents)[0] ?? null;
  const h = histForLangs(hist, lang);
  const back = (n) => { const t = h.length > n ? h[h.length - 1 - n] : null; return t ? t.min : null; };
  const chg = (v) => (v && nmLow ? nmLow / v - 1 : null);
  const nRecent = h.slice(-7).map((p) => p.n).filter(Boolean);
  const nBefore = h.slice(-21, -7).map((p) => p.n).filter(Boolean);
  const avg = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : null);
  const mins90 = h.slice(-90).map((p) => p.min);
  return {
    listings: ok2.length,
    lowCents: low,
    lowIsZero: !!(cheapest && isZero(cheapest)),
    zeroLowCents: zeroCents.length ? zeroCents[0] : null,
    typicalCents: typ,
    secondCents: ok2[1] ?? null,
    outlierLow: ok2.length >= 4 && low < 0.6 * typ, // il più basso è molto sotto gli altri: da controllare (errore, copia rovinata)
    histDays: h.length,
    pct30: nmLow ? percentileIn(h, nmLow, 30) : null,
    pct90: nmLow ? percentileIn(h, nmLow, 90) : null,
    min90: mins90.length ? Math.min(...mins90) : null,
    max90: mins90.length ? Math.max(...mins90) : null,
    change7: chg(back(7)),
    change30: chg(back(30)),
    supplyNow: avg(nRecent) != null ? Math.round(avg(nRecent)) : null,
    supplyBefore: avg(nBefore) != null ? Math.round(avg(nBefore)) : null,
    cmCents: cmCents || null,
    vsCm: cmCents ? low / cmCents - 1 : null,
    limitCents: limitCents || null,
    vsLimit: limitCents ? low / limitCents - 1 : null,
    histNote: lang.length ? 'solo copie Near Mint o migliori, nella lingua scelta' : 'solo copie Near Mint o migliori, tutte le lingue',
    suggest: suggestPrice({ hist: h, lowCents: low, typicalCents: typ, cmCents }),
  };
}

export const APPRAISER_WEB_PER_DAY = 10; // pareri con ricerca web al giorno per utente (costano di più)
export const APPRAISER_LIMIT_PER_DAY = 40; // pareri dell'esperto al giorno per utente: tiene il costo sotto controllo

export const VERDICTS = {
  deal: 'Occasione', good: 'Buon prezzo', fair: 'Nella media', high: 'Caro', few: 'Dati scarsi', none: 'Nessun annuncio',
};

/** Voto: media di due segnali (posizione nello storico e rapporto con Cardmarket); con un solo segnale conta quello. */
export function verdictOf(f) {
  if (!f || !f.listings) return 'none';
  const sigs = [];
  const p = f.pct90 ?? f.pct30;
  if (p != null) sigs.push(p);
  if (f.vsCm != null) sigs.push(Math.max(0, Math.min(1, (f.vsCm + 0.3) / 0.6))); // −30% = 0 (ottimo), +30% = 1 (caro)
  if (!sigs.length) return 'few';
  const s = sigs.reduce((t, x) => t + x, 0) / sigs.length;
  return s < 0.2 ? 'deal' : s < 0.42 ? 'good' : s < 0.7 ? 'fair' : 'high';
}

export const APPRAISER_SYSTEM = `Sei un amico collezionista di carte Pokémon con vent'anni di esperienza: segui ogni giorno i mercati (CardTrader, Cardmarket, eBay, aste), conosci rarità, ristampe, condizioni, lingue e come si muovono i prezzi. Un amico ti chiede: "Secondo te, a questo prezzo la prendo?".
Ricevi dei dati già calcolati (prezzi in centesimi di euro). Usa SOLO quelli: non inventare prezzi, date, notizie, tornei o ristampe. Se un dato manca o lo storico è breve, dillo con naturalezza ("ho pochi giorni di storico").
Come scrivere: italiano parlato, caldo e diretto, dai del tu, come a voce. Massimo 3-4 frasi corte, niente elenchi, titoli o gergo ("scheda", "percentile", "scostamento"). Parti dal punto: la prenderesti o no, e perché. Usa al massimo 2-3 numeri, i più importanti, in euro (es. "170 €"). Poi dì una cosa che solo un esperto noterebbe (pochi annunci, uno troppo basso rispetto agli altri, lingua o condizione, trend, rischio di stare ad aspettare) e chiudi con un consiglio chiaro e pratico. Non insinuare mai che un venditore possa mentire sulla condizione o sulle foto, e non dire di controllare recensioni o foto del venditore: è un compito di CardTrader, che gestisce reclami e rimborsi (gli annunci CardTrader Zero sono in più spediti e verificati da CardTrader). Parla solo di prezzo, mercato e disponibilità. Non ripetere il voto dell'app, lo mostra già lei. Se nei dati c'è un prezzo alert consigliato, nel consiglio finale puoi dire a che prezzo conviene aspettare o impostare l'alert.`;

export function appraisalPrompt(card, f, verdict) {
  const eur = (c) => (c == null ? null : Math.round(c) / 100);
  const pc = (v) => (v == null ? null : Math.round(v * 100));
  return `Carta: ${card.name}${card.expansion ? ` (${card.expansion})` : ''}. Lingua cercata: ${card.language || 'qualsiasi'}. Condizione minima: ${card.minCondition || 'qualsiasi'}.
Voto calcolato dall'app: ${VERDICTS[verdict]}.
Scheda: ${JSON.stringify({
    annunciAcquistabili: f.listings, prezzoPiuBassoEur: eur(f.lowCents), prezzoTipicoEur: eur(f.typicalCents), secondoPiuBassoEur: eur(f.secondCents),
    annuncioPiuBassoEZero_verificatoDaCardTrader: f.lowIsZero, prezzoPiuBassoZeroEur: eur(f.zeroLowCents),
    piuBassoMoltoSottoGliAltri_offertaIsolata: f.outlierLow, giorniDiStorico: f.histDays,
    posizioneNegliUltimi30Giorni_0min_100max: pc(f.pct30), posizioneNegliUltimi90Giorni_0min_100max: pc(f.pct90),
    minimo90gEur: eur(f.min90), massimo90gEur: eur(f.max90), variazione7gPercento: pc(f.change7), variazione30gPercento: pc(f.change30),
    annunciMediUltimi7g: f.supplyNow, annunciMediPrima: f.supplyBefore,
    tendenzaCardmarketEur: eur(f.cmCents), scostamentoDaCardmarketPercento: pc(f.vsCm),
    sogliaDellAlertEur: eur(f.limitCents), scostamentoDallaSogliaPercento: pc(f.vsLimit),
    prezzoAlertConsigliatoEur: f.suggest ? eur(f.suggest.cents) : null,
  })}`;
}

// Modelli Groq in ordine di preferenza (il primo che l'account può usare): l'elenco lo chiede Groq stesso, così un modello ritirato non rompe i pareri.
const GROQ_PREFS = [/llama-4-maverick/, /llama-3\.3-70b/, /gpt-oss-120b/, /llama-4-scout/, /gpt-oss-20b/, /llama-3\.1-8b/];
let groqPicked = null;

async function groqModel(env) {
  if (env.APPRAISAL_GROQ_MODEL) return env.APPRAISAL_GROQ_MODEL;
  if (groqPicked && Date.now() - groqPicked.ts < 6 * 3600_000) return groqPicked.id;
  const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${env.GROQ_API_KEY}` } });
  if (!res.ok) throw new Error(`Groq ${res.status} nel leggere l'elenco dei modelli: ${(await res.text().catch(() => '')).slice(0, 120)}`);
  const ids = ((await res.json()).data || []).map((m) => m.id).filter((id) => id && !/whisper|tts|guard|embed|orpheus/i.test(id));
  for (const re of GROQ_PREFS) {
    const hit = ids.find((id) => re.test(id));
    if (hit) { groqPicked = { id: hit, ts: Date.now() }; return hit; }
  }
  throw new Error(`nessun modello adatto tra quelli di Groq (${ids.slice(0, 8).join(', ') || 'elenco vuoto'}): imposta APPRAISAL_GROQ_MODEL`);
}

/** Commento da Groq (API compatibile OpenAI, molto economica). Il modello si sceglie da solo; APPRAISAL_GROQ_MODEL lo forza. */
async function askGroq(env, card, f, verdict) {
  const model = await groqModel(env);
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model,
      max_tokens: 1500, // i modelli che ragionano consumano token prima di rispondere
      temperature: 0.5,
      ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {}),
      messages: [{ role: 'system', content: APPRAISER_SYSTEM }, { role: 'user', content: appraisalPrompt(card, f, verdict) }],
    }),
  });
  if (!res.ok) {
    if (res.status === 404) groqPicked = null;
    throw new Error(`Groq ${res.status} (${model}): ${(await res.text().catch(() => '')).slice(0, 160)}`);
  }
  const j = await res.json();
  const raw = j && j.choices && j.choices[0] && j.choices[0].message && String(j.choices[0].message.content || '');
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!text) throw new Error(`Groq (${model}): risposta vuota`);
  return text.slice(0, 800);
}

/** Commento dell'esperto: solo Groq (Claude resta riservato al riconoscimento delle foto). null senza GROQ_API_KEY. */
export async function askAppraiser(env, card, f, verdict) {
  if (!env.GROQ_API_KEY) return null;
  return askGroq(env, card, f, verdict);
}
