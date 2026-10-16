import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceFor, summarize } from '../src/collection.js';

const L = (cents, lang, cond, zero = false) => ({ quantity: 1, price: { cents }, properties_hash: { condition: cond, pokemon_language: lang }, user: { can_sell_via_hub: zero } });

test('prezzo: stessa lingua e condizione uguale o migliore', () => {
  const list = [L(500, 'en', 'Played'), L(900, 'jp', 'Near Mint'), L(1200, 'en', 'Near Mint'), L(1500, 'en', 'Mint')];
  assert.equal(priceFor(list, 'en', 'Near Mint').cents, 1200);
  assert.equal(priceFor(list, 'jp', 'Near Mint').cents, 900);
  const fb = priceFor(list, 'fr', 'Near Mint');
  assert.equal(fb.cents, 500);
  assert.equal(fb.approx, true);
  assert.equal(priceFor([], 'en', 'Near Mint'), null);
});

test('totali della collezione', () => {
  const s = summarize([
    { qty: 2, price: { cents: 1000 }, paidCents: 700, cmCents: 900 },
    { qty: 1, price: null, paidCents: 0 },
  ]);
  assert.deepEqual(s, { value: 2000, paid: 1400, qty: 3, distinct: 2, missing: 1, cm: 1800, paidPriced: 1400 });
});

import { pickPrice } from '../src/collection.js';

test('prezzo solo CardTrader Zero', () => {
  const list = [L(1000, 'en', 'Near Mint'), L(1400, 'en', 'Near Mint', true), L(900, 'jp', 'Near Mint', true)];
  const p = priceFor(list, 'en', 'Near Mint');
  assert.equal(p.cents, 1000);
  assert.equal(p.zeroCents, 1400);
  assert.equal(pickPrice(p, true).cents, 1400);
  assert.equal(pickPrice(priceFor([L(500, 'en', 'Near Mint')], 'en', 'Near Mint'), true), null);
});
