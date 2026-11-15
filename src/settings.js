// Impostazioni condivise tra i dispositivi e logica degli orari silenziosi (pura, testabile).

// Costo indicativo di una gradazione per società, in euro (listini di fine 2026, tariffa standard convertita in euro):
// PSA Regular 79,99 $, BGS Standard 34,95 $, CGC Standard 55 $, SGC Standard 50 $ (da settembre 2026), ACE Standard 25 £,
// TAG (consegne limitate) 59 $, PCG stimato. I listini cambiano spesso: si modificano in Opzioni.
export const GRADE_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'ACE', 'TAG', 'PCG'];
export const DEFAULT_GRADE_FEES = { PSA: 70, BGS: 32, CGC: 50, SGC: 45, ACE: 29, TAG: 55, PCG: 40 };
export const DEFAULT_GRADE_SHIP = 10; // spedizione (andata e ritorno), imballo e assicurazione, per carta

export const SCAN_CHOICES = [10, 20, 30, 60, 300];

export const DEFAULT_SETTINGS = {
  paused: false,
  quietEnabled: false,
  quietFrom: '23:00',
  quietTo: '08:00',
  tz: 'Europe/Rome',
  scanEverySec: 10,
  summary: true, // riepilogo giornaliero alle 9
  reminders: true, // promemoria dopo 24 ore se un annuncio segnalato è ancora in vendita
  orderAlerts: true, // avviso quando cambia lo stato di un ordine CardTrader
  collZero: true, // valore della collezione con i soli prezzi CardTrader Zero
  collTypical: true, // valore con il prezzo tipico (mediana dei 5 più economici) invece del più basso
  gradeFees: { ...DEFAULT_GRADE_FEES }, // costo di gradazione per società (€)
  gradeShip: DEFAULT_GRADE_SHIP, // spedizione e imballo per carta (€)
  collMinCents: 0, // 0 = spento: sotto questo valore (centesimi) le carte non entrano in collezione e quelle presenti si nascondono
  collReliable: true, // valore della collezione senza i venditori segnalati da CardTrader (annullamenti, venditori nuovi)
};

/** "07:30" -> 450 minuti dalla mezzanotte; null se non è un orario valido. */
export function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Minuti dalla mezzanotte nel fuso indicato. */
export function localMinutes(date, tz) {
  const zone = validTz(tz) ? tz : 'UTC';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return get('hour') * 60 + get('minute');
}

/** True se in questo momento le notifiche devono restare in silenzio. */
export function isQuiet(settings, date = new Date()) {
  if (!settings || !settings.quietEnabled) return false;
  const from = minutesOf(settings.quietFrom);
  const to = minutesOf(settings.quietTo);
  if (from == null || to == null || from === to) return false;
  const now = localMinutes(date, settings.tz);
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** Costi di gradazione: solo le società note, numeri tra 0 e 2000 €; quelli mancanti restano come prima (o il valore di partenza). */
function cleanFees(input, old) {
  const base = { ...DEFAULT_GRADE_FEES, ...(old && typeof old === 'object' ? old : {}) };
  const out = {};
  for (const co of GRADE_COMPANIES) {
    const v = input && typeof input === 'object' ? Number(input[co]) : NaN;
    const cur = Number.isFinite(Number(base[co])) ? Number(base[co]) : DEFAULT_GRADE_FEES[co];
    out[co] = input && input[co] !== undefined && Number.isFinite(v) ? Math.max(0, Math.min(2000, Math.round(v * 100) / 100)) : cur;
  }
  return out;
}

/** Accetta solo i campi noti e li riporta a valori validi. */
export function cleanSettings(input, old = DEFAULT_SETTINGS) {
  const b = input && typeof input === 'object' ? input : {};
  const pickTime = (v, fallback) => (minutesOf(v) != null ? String(v).padStart(5, '0') : fallback);
  const scan = Number(b.scanEverySec);
  return {
    paused: b.paused === undefined ? !!old.paused : !!b.paused,
    quietEnabled: b.quietEnabled === undefined ? !!old.quietEnabled : !!b.quietEnabled,
    quietFrom: pickTime(b.quietFrom, old.quietFrom),
    quietTo: pickTime(b.quietTo, old.quietTo),
    tz: typeof b.tz === 'string' && validTz(b.tz) ? b.tz : old.tz,
    scanEverySec: SCAN_CHOICES.includes(scan) ? scan : old.scanEverySec,
    summary: b.summary === undefined ? old.summary !== false : !!b.summary,
    reminders: b.reminders === undefined ? old.reminders !== false : !!b.reminders,
    orderAlerts: b.orderAlerts === undefined ? old.orderAlerts !== false : !!b.orderAlerts,
    collZero: b.collZero === undefined ? !!old.collZero : !!b.collZero,
    collTypical: b.collTypical === undefined ? !!old.collTypical : !!b.collTypical,
    gradeFees: cleanFees(b.gradeFees, old.gradeFees),
    gradeShip: b.gradeShip === undefined ? (Number.isFinite(Number(old.gradeShip)) ? Number(old.gradeShip) : DEFAULT_GRADE_SHIP) : Math.max(0, Math.min(500, Math.round(Number(b.gradeShip) * 100) / 100 || 0)),
    collMinCents: b.collMinCents === undefined ? Number(old.collMinCents) || 0 : Math.max(0, Math.min(10_000_000, Math.round(Number(b.collMinCents)) || 0)),
    collReliable: b.collReliable === undefined ? old.collReliable !== false : !!b.collReliable,
  };
}
