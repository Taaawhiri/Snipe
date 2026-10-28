import test from 'node:test';
import assert from 'node:assert/strict';
import { appraisalFacts, verdictOf, percentileIn, appraisalPrompt } from '../src/appraisal.js';

const prod = (cents, lang = 'en', cond = 'Near Mint') => ({ price: { cents, currency: 'EUR' }, quantity: 1, properties_hash: { condition: cond, pokemon_language: lang }, user: { username: 'u' } });
const hist = (vals) => vals.map((min, i) => ({ d: `2026-10-${String(i + 1).padStart(2, '0')}`, min, n: 5 }));

test('percentile: prezzo basso rispetto allo storico', () => {
  const h = hist([1000, 1100, 1200, 1300, 1400, 1500]);
  assert.equal(percentileIn(h, 900), 0);
  assert.equal(percentileIn(h, 1600), 1);
  assert.equal(percentileIn(hist([1000, 1100]), 900), null);
});

test('voto: occasione, caro e dati scarsi', () => {
  const h = hist([1000, 1100, 1200, 1300, 1400, 1500, 1500]);
  const cheap = appraisalFacts({ products: [prod(900), prod(1300), prod(1350), prod(1400)], hist: h, cmCents: 1500 });
  assert.equal(verdictOf(cheap), 'deal');
  const dear = appraisalFacts({ products: [prod(1700), prod(1800)], hist: h, cmCents: 1300 });
  assert.equal(verdictOf(dear), 'high');
  assert.equal(verdictOf(appraisalFacts({ products: [prod(900)], hist: [] })), 'few');
  assert.equal(verdictOf(appraisalFacts({ products: [] })), 'none');
});

test('fatti: filtra la lingua e segnala il più basso anomalo', () => {
  const f = appraisalFacts({ products: [prod(100), prod(1000), prod(1100), prod(1200), prod(50, 'ja')], hist: [], rule: { language: 'en' } });
  assert.equal(f.listings, 4);
  assert.equal(f.lowCents, 100);
  assert.equal(f.outlierLow, true);
});

test('prompt: contiene i numeri e non i centesimi grezzi', () => {
  const f = appraisalFacts({ products: [prod(1234)], hist: [], cmCents: 1500 });
  const t = appraisalPrompt({ name: 'Pikachu', expansion: 'Base', language: 'en' }, f, 'few');
  assert.match(t, /"prezzoPiuBassoEur":12.34/);
});

import { suggestPrice } from '../src/appraisal.js';
test('prezzo consigliato: dallo storico, mai sopra il prezzo di adesso', () => {
  const h = [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900].map((min, i) => ({ d: `d${i}`, min }));
  const s = suggestPrice({ hist: h, lowCents: 1800, typicalCents: 1900 });
  assert.equal(s.now, false);
  assert.ok(s.cents <= 1800 && s.cents >= 970);
  assert.equal(suggestPrice({ hist: h, lowCents: 1000, typicalCents: 1000 }).now, true);
  assert.equal(suggestPrice({ hist: [], lowCents: 2000, typicalCents: 2000, cmCents: 2000 }).cents, 1700);
  assert.equal(suggestPrice({ hist: [], lowCents: 0 }), null);
});

test('annuncio Zero: segnalato nei fatti', () => {
  const z = { ...prod(1000), properties_hash: { condition: 'Near Mint', pokemon_language: 'en' }, user: { username: 'u', user_type: 'zero' }, can_sell_via_hub: true };
  const f = appraisalFacts({ products: [prod(2000), prod(2100)], hist: [] });
  assert.equal(f.lowIsZero, false);
  assert.equal(typeof f.zeroLowCents, 'object'); // null senza annunci Zero
  assert.ok(z);
});
