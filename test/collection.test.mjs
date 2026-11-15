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
  assert.equal(pickPrice(p, true, true).cents, 1300); // solo 2 annunci Zero: con meno di 5 il tipico è il più basso (la mediana di 1300 e 5000 non direbbe niente)
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

import { useCmPrice } from '../src/collection.js';
test('usa Cardmarket per una copia con pochi annunci', () => {
  const p = { cents: 1000, typCents: 1000 };
  const q = useCmPrice(p, 700);
  assert.equal(q.cents, 700);
  assert.equal(q.ctCents, 1000);
  assert.equal(q.cmCapped, true);
  assert.equal(useCmPrice(p, null), p);
  assert.equal(useCmPrice(null, 700), null);
});

import { cmCappable } from '../src/collection.js';
test('il tetto Cardmarket non vale per gradate, 1ª edizione e reverse', () => {
  assert.equal(cmCappable({ cond: 'Near Mint' }), true);
  assert.equal(cmCappable({ cond: 'PSA 10' }), false);
  assert.equal(cmCappable({ cond: 'Near Mint', first: true }), false);
  assert.equal(cmCappable({ cond: 'Near Mint', reverse: true }), false);
});

import { isOutlierPrice } from '../src/collection.js';
test('prezzi stratosferici: annunci parcheggiati non contano nel valore', () => {
  assert.equal(isOutlierPrice(1000064, { paidCents: 200 }), true); // Vulpix a 10.000 €, pagata 2 €
  assert.equal(isOutlierPrice(1000064, { cmCents: 150 }), true);
  assert.equal(isOutlierPrice(12000, { cmCents: 2500 }), true); // oltre 4 volte Cardmarket
  assert.equal(isOutlierPrice(9000, { cmCents: 5000 }), false);
  assert.equal(isOutlierPrice(15000, { paidCents: 8000 }), false); // 150 €: valore normale
  assert.equal(isOutlierPrice(1000064, { graded: true }), false); // le gradate possono valere molto
  assert.equal(isOutlierPrice(600000, {}), true); // oltre 5.000 € senza riferimenti
});

test('prezzi anomali: reverse, 1ª edizione e stime non si confrontano con Cardmarket', () => {
  assert.equal(isOutlierPrice(10241, { cmCents: 221, comparable: false }), false); // reverse holo EX: vale molto più del prezzo generico
  assert.equal(isOutlierPrice(10241, { cmCents: 221, comparable: true }), true);
});

test('prezzo tipico con pochi annunci (gradate): vale il più basso, non la mediana alta', () => {
  const G = (cents, user) => ({ quantity: 1, price: { cents }, properties_hash: { condition: 'Near Mint', pokemon_language: 'en' }, description: 'PSA 9', user: { username: user, can_sell_via_hub: false } });
  const p = priceFor([G(17063, 'a'), G(51688, 'b'), G(51688, 'c')], 'en', 'PSA 9', {});
  assert.equal(p.cents, 17063);
  assert.equal(p.typCents, 17063);
});

import { gradedFromBase, gradingFeeCents } from '../src/collection.js';
test('stima gradata: usa il costo di gradazione della società', () => {
  const base = 10000;
  const psa = gradedFromBase(base, { co: 'PSA', g: '9' }, 8000);
  const cgc = gradedFromBase(base, { co: 'CGC', g: '9' }, 6000);
  assert.ok(psa >= base + 8000 && cgc >= base + 6000 * 0.85 - 1);
  assert.equal(gradingFeeCents('PSA', { PSA: 8000 }), 8000);
  assert.equal(gradingFeeCents('ACE', { PSA: 8000 }), 2500); // società senza costo: valore di riferimento
});

import { cardTier } from '../src/collection.js';
test('tipo di carta dalla rarità', () => {
  assert.equal(cardTier('Charizard ex (Special Illustration Rare | 199/165)'), 'chase');
  assert.equal(cardTier('Umbreon (Hyper Rare)'), 'chase');
  assert.equal(cardTier('Pikachu (Illustration Rare | 075/066)'), 'mid');
  assert.equal(cardTier('Charizard (Holo Rare | 4/102)'), 'mid');
  assert.equal(cardTier('Pidgey (Common | 16/102)'), 'common');
  assert.equal(cardTier('Mew ex (SVP 053)'), 'mid');
});

test('gradata: annuncio molto più alto della stima → vale la stima; vicino → vale l\'annuncio', () => {
  const raw = (c, u) => ({ ...L(c, 'en', 'Near Mint'), user: { username: u, can_sell_via_hub: false } });
  const G = (cents, u) => ({ quantity: 1, price: { cents }, properties_hash: { condition: 'Near Mint', pokemon_language: 'en' }, description: 'PSA 9', user: { username: u, can_sell_via_hub: false } });
  const fees = { PSA: 4000 };
  // carta non gradata a 100 €: stima PSA 9 intermedia = max(100×1,4, 100+40) = 140 €
  const far = priceFor([raw(10000, 'r'), G(51688, 'a'), G(51688, 'b')], 'en', 'PSA 9', { gradeFees: fees, premium: 1 });
  assert.equal(far.cents, 14000);
  assert.ok(far.hybrid && far.hybrid.listing === 51688);
  const near = priceFor([raw(10000, 'r'), G(17063, 'a'), G(51688, 'b')], 'en', 'PSA 9', { gradeFees: fees, premium: 1 });
  assert.equal(near.cents, 17063); // 170 € ≤ 1,6 × 140 € = 224 €
  assert.equal(near.hybrid, undefined);
  // una chase ha un premio più alto: la stessa carta a 100 € vale più
  const chase = priceFor([raw(10000, 'r'), G(51688, 'a')], 'en', 'PSA 9', { gradeFees: fees, premium: 1.6 });
  assert.ok(chase.cents > 14000 && chase.cents < 51688 / 1.6 + 1);
});
