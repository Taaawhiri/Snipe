import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSettings, isQuiet, minutesOf, DEFAULT_SETTINGS } from '../src/settings.js';

test('minutesOf accetta solo orari validi', () => {
  assert.equal(minutesOf('07:30'), 450);
  assert.equal(minutesOf('7:05'), 425);
  assert.equal(minutesOf('24:00'), null);
  assert.equal(minutesOf('ab'), null);
});

test('orari silenziosi a cavallo della mezzanotte', () => {
  const s = { ...DEFAULT_SETTINGS, quietEnabled: true, quietFrom: '23:00', quietTo: '08:00', tz: 'Europe/Rome' };
  // 21:30 UTC in ottobre = 23:30 a Roma (ora legale)
  assert.equal(isQuiet(s, new Date('2026-10-15T21:30:00Z')), true);
  // 05:00 UTC = 07:00 a Roma
  assert.equal(isQuiet(s, new Date('2026-10-15T05:00:00Z')), true);
  // 08:00 UTC = 10:00 a Roma
  assert.equal(isQuiet(s, new Date('2026-10-15T08:00:00Z')), false);
  assert.equal(isQuiet({ ...s, quietEnabled: false }, new Date('2026-10-15T21:30:00Z')), false);
});

test('orari silenziosi nella stessa giornata', () => {
  const s = { ...DEFAULT_SETTINGS, quietEnabled: true, quietFrom: '13:00', quietTo: '15:00', tz: 'UTC' };
  assert.equal(isQuiet(s, new Date('2026-10-15T14:00:00Z')), true);
  assert.equal(isQuiet(s, new Date('2026-10-15T15:00:00Z')), false);
});

test('cleanSettings ripulisce i valori', () => {
  const c = cleanSettings({ paused: 1, scanEverySec: 25, quietFrom: 'xx', tz: 'Marte/Olympus', quietEnabled: true });
  assert.equal(c.paused, true);
  assert.equal(c.scanEverySec, DEFAULT_SETTINGS.scanEverySec); // 25 non è una scelta valida
  assert.equal(c.quietFrom, DEFAULT_SETTINGS.quietFrom);
  assert.equal(c.tz, DEFAULT_SETTINGS.tz);
  assert.equal(c.quietEnabled, true);
  assert.equal(cleanSettings({ scanEverySec: 30 }).scanEverySec, 30);
});
