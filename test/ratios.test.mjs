import test from 'node:test';
import assert from 'node:assert/strict';
import { addSamples, estimateFrom, samplesFromCard, summarizeRatios, variantOf } from '../src/ratios.js';
import { pickPrice, priceFor } from '../src/collection.js';

const L = (cents, lang, cond, extra = {}) => ({ price: { cents }, quantity: 1, properties_hash: { condition: cond, pokemon_language: lang }, ...extra });

test('rapporti: varianti della stessa carta', () => {
  assert.deepEqual(variantOf(L(100, 'jp', 'Mint')), { lang: 'jp', cond: 'Near Mint', first: false });
  assert.deepEqual(variantOf(L(100, 'en', 'Near Mint', { description: 'PSA 10 gem' })), { lang: 'en', grade: 'PSA 10', first: false });
  const s = Object.fromEntries(samplesFromCard([
    L(1000, 'en', 'Near Mint'), L(800, 'en', 'Slightly Played'), L(1200, 'jp', 'Near Mint'),
    L(3000, 'en', 'Near Mint', { description: 'PSA 10' }), L(2500, 'en', 'Near Mint', { description: '1st edition' }),
  ]));
  assert.equal(s['cond:Slightly Played'], 0.8);
  assert.equal(s['lang:jp'], 1.2);
  assert.equal(s['grade:PSA 10'], 3);
  assert.equal(s.first, 2.5);
});

/** Rapporti finti con abbastanza carte (n = 50). */
function ratios(map, era = 'vintage') {
  const store = {};
  for (let i = 0; i < 50; i++) addSamples(store, String(i), era, Object.entries(map));
  return summarizeRatios(store);
}

test('stima: 1ª edizione giapponese dalla normale giapponese', () => {
  const R = ratios({ first: 2, 'lang:jp': 1.3 });
  const list = [L(6564, 'jp', 'Near Mint'), L(3952, 'jp', 'Played', { description: '1st edition' })];
  const e = estimateFrom(list, { lang: 'jp', cond: 'Near Mint', first: true }, R, 'vintage');
  assert.equal(e.cents, 13128); // 65,64 € × 2 (un solo passaggio: edizione)
  assert.equal(e.parts.length, 1);
  // In collezione: badge stima, prezzo uguale anche in modalità Zero.
  const p = priceFor(list, 'jp', 'Near Mint', { first: true, ratios: R, era: 'vintage' });
  assert.equal(p.estimated, true);
  assert.equal(pickPrice(p, true).cents, 13128);
});

test('stima: gradata dalla non gradata nella stessa lingua', () => {
  const R = ratios({ 'grade:CGC 7.5': 1.4 });
  const list = [L(2025, 'jp', 'Near Mint'), L(9250, 'jp', 'Near Mint')];
  const p = priceFor(list, 'jp', 'CGC 7.5', { ratios: R, era: 'vintage' });
  assert.equal(p.cents, 2835);
  assert.equal(p.est.from.cents, 2025);
});

test('stima: senza rapporti affidabili si usano i ripieghi di prima', () => {
  const store = {};
  for (let i = 0; i < 5; i++) addSamples(store, String(i), 'modern', [['lang:jp', 0.5]]); // solo 5 carte: troppo poche
  const p = priceFor([L(1000, 'en', 'Near Mint')], 'jp', 'Near Mint', { ratios: summarizeRatios(store), era: 'modern' });
  assert.equal(p.estimated, undefined);
  assert.equal(p.approx, true);
});

test('prezzo esatto: lingua e condizione uguali vincono sempre sulla stima', () => {
  const R = ratios({ 'lang:jp': 0.1 });
  const p = priceFor([L(700, 'jp', 'Near Mint'), L(1000, 'en', 'Near Mint')], 'jp', 'Near Mint', { ratios: R, era: 'vintage' });
  assert.equal(p.cents, 700);
  assert.equal(p.approx, false);
});

test('più basso affidabile: prezzo anomalo scartato solo con abbastanza annunci', () => {
  const p = priceFor([L(400, 'en', 'Near Mint'), L(1200, 'en', 'Near Mint'), L(1300, 'en', 'Near Mint'), L(1400, 'en', 'Near Mint')], 'en', 'Near Mint');
  assert.equal(p.cents, 1200);
  assert.deepEqual(p.skipped, [400]);
  assert.equal(priceFor([L(1000, 'en', 'Near Mint'), L(1100, 'en', 'Near Mint'), L(1200, 'en', 'Near Mint'), L(1300, 'en', 'Near Mint')], 'en', 'Near Mint').cents, 1000);
  assert.equal(priceFor([L(2025, 'jp', 'Near Mint'), L(9250, 'jp', 'Near Mint')], 'jp', 'Near Mint').cents, 2025); // pochi annunci: si tiene
});
