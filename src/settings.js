// Impostazioni condivise tra i dispositivi e logica degli orari silenziosi (pura, testabile).

export const SCAN_CHOICES = [10, 20, 30, 60, 300];

export const DEFAULT_SETTINGS = {
  paused: false,
  quietEnabled: false,
  quietFrom: '23:00',
  quietTo: '08:00',
  tz: 'Europe/Rome',
  scanEverySec: 10,
  summary: true, // riepilogo giornaliero alle 9
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
  };
}
