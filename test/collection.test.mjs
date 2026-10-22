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
  assert.deepEqual(s, { value: 2000, paid: 1400, qty: 3, distinct: 2, missing: 1, cm: 1800, paidPriced: 1400, valueKnown: 2000, known: 2 });
});

import { pickPrice } from '../src/collection.js';

test('prezzo solo CardTrader Zero', () => {
  const list = [L(1000, 'en', 'Near Mint'), L(1400, 'en', 'Near Mint', true), L(900, 'jp', 'Near Mint', true)];
  const p = priceFor(list, 'en', 'Near Mint');
  assert.equal(p.cents, 1000);
  assert.equal(p.zeroCents, 1400);
  assert.equal(pickPrice(p, true).cents, 1400);
  // Nessun annuncio Zero: prezzo di tutti i venditori, segnato "non Zero".
  const nz = pickPrice(priceFor([L(500, 'en', 'Near Mint')], 'en', 'Near Mint'), true);
  assert.equal(nz.cents, 500);
  assert.equal(nz.notZero, true);
  // Zero solo in un'altra lingua: vale l'annuncio giusto non Zero (1ª ed. JP a 70 € contro inglese Zero a 39 €).
  const jp = pickPrice(priceFor([L(7000, 'jp', 'Near Mint'), L(3900, 'en', 'Near Mint', true)], 'jp', 'Near Mint'), true);
  assert.equal(jp.cents, 7000);
  assert.equal(jp.notZero, true);
});

test('prezzo tipico e venditori esclusi', () => {
  const U = (c, user, zero = false) => ({ ...L(c, 'en', 'Near Mint', zero), user: { username: user, can_sell_via_hub: zero } });
  const list = [U(100, 'furbo'), U(1000, 'a'), U(1100, 'b'), U(1200, 'c'), U(1300, 'd', true), U(5000, 'e', true)];
  const p = priceFor(list, 'en', 'Near Mint');
  assert.equal(p.cents, 1000); // 100 è molto sotto gli altri: prezzo anomalo, ignorato
  assert.deepEqual(p.skipped, [100]);
  assert.equal(p.typCents, 1100); // mediana di 100, 1000, 1100, 1200, 1300
  assert.equal(pickPrice(p, false, true).cents, 1100);
  assert.equal(pickPrice(p, true, true).cents, 3150);
  const noFurbo = priceFor(list, 'en', 'Near Mint', { blocked: new Set(['furbo']) });
  assert.equal(noFurbo.cents, 1000);
});

test('venditori segnalati da CardTrader esclusi dal valore', () => {
  const R = (c, u) => ({ ...L(c, 'en', 'Near Mint'), user: { username: 'x' + c, ...u } });
  // Solo i troppi annullamenti escludono; il tetto di vendite giornaliero è un'informazione (lo hanno anche i venditori PRO).
  const list = [R(100, { too_many_request_for_cancel_as_seller: true }), R(200, { max_sellable_in24h_quantity: 5 }), R(1000, {})];
  assert.equal(priceFor(list, 'en', 'Near Mint').cents, 100);
  assert.equal(priceFor(list, 'en', 'Near Mint', { reliable: true }).cents, 200);
});

test('reverse holo: la copia reverse usa solo annunci reverse, la normale solo i non reverse', () => {
  const R = (cents, rev, cond = 'Near Mint') => ({ quantity: 1, price: { cents }, properties_hash: { condition: cond, pokemon_language: 'en', pokemon_reverse: rev }, user: { username: 'u' } });
  const list = [R(200, false), R(300, true), R(220, false), R(450, true)];
  assert.equal(priceFor(list, 'en', 'Near Mint', { reverse: true }).cents, 300);
  assert.equal(priceFor(list, 'en', 'Near Mint', { reverse: false }).cents, 200);
  // nessun annuncio reverse: si usa il prezzo dei normali, segnato come approssimato
  const only = priceFor([R(200, false)], 'en', 'Near Mint', { reverse: true });
  assert.equal(only.cents, 200);
  assert.equal(only.approx, true);
  assert.equal(only.revApprox, true);
  // senza indicazione di variante (vecchie voci) il comportamento resta quello di prima
  assert.equal(priceFor(list, 'en', 'Near Mint').cents, 200);
  // reverse riconosciuta anche dal commento del venditore, ma non se la proprietà dice di no
  const D = (cents, description, rev) => ({ quantity: 1, price: { cents }, description, properties_hash: { condition: 'Near Mint', pokemon_language: 'en', ...(rev === undefined ? {} : { pokemon_reverse: rev }) }, user: { username: 'u' } });
  assert.equal(priceFor([D(100, 'carta bella'), D(400, 'Reverse Holo')], 'en', 'Near Mint', { reverse: true }).cents, 400);
  assert.equal(priceFor([D(100, 'non reverse', false), D(400, 'x', true)], 'en', 'Near Mint', { reverse: false }).cents, 100);
});
