import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealsFromProducts } from '../src/daydeals.js';

const L = (id, cents, lang = 'en', cond = 'Near Mint') => ({ id, blueprint_id: 1, quantity: 1, price: { cents, currency: 'EUR' }, properties_hash: { condition: cond, pokemon_language: lang }, user: { username: 'u' + id } });

test('affari: molto sotto gli altri annunci CardTrader, inglese NM', () => {
  const cards = [{ id: 1, single: true, name: 'Charizard', image: null, cm: { trend: 10 } }];
  const products = { 1: [L(1, 1000), L(2, 2000), L(3, 2100), L(4, 2200), L(5, 2300), L(6, 500, 'jp'), L(7, 400, 'en', 'Played')] };
  const out = dealsFromProducts(cards, products);
  assert.equal(out.length, 1);
  assert.equal(out[0].cents, 1000);
  assert.equal(out[0].refCents, 2150);
  assert.equal(out[0].trendCents, 1000);
});

test('niente affari se il prezzo è in linea', () => {
  const cards = [{ id: 1, single: true, name: 'X', cm: null }];
  assert.equal(dealsFromProducts(cards, { 1: [L(1, 2000), L(2, 2050), L(3, 2100), L(4, 2200)] }).length, 0);
});
