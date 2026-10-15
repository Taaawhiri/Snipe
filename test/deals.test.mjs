import test from 'node:test';
import assert from 'node:assert/strict';
import { findDeals, median, condRank } from '../src/deals.js';

const p = (id, cents, extra = {}) => ({
  id,
  blueprint_id: 1,
  name_en: 'Charizard ex',
  quantity: 1,
  graded: false,
  on_vacation: false,
  price: { cents, currency: 'EUR' },
  properties_hash: { condition: 'Near Mint' },
  ...extra,
});

const rule = { minDiscount: 30, minPriceCents: 500, minCondition: 'Slightly Played' };

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('condRank ignora le maiuscole e gestisce valori sconosciuti', () => {
  assert.equal(condRank('near mint'), 5);
  assert.equal(condRank('boh'), -1);
});

test('trova un annuncio molto sotto la mediana', () => {
  const res = findDeals({ 1: [p(1, 5000), p(2, 9000), p(3, 9500), p(4, 10000), p(5, 11000)] }, rule);
  assert.equal(res.length, 1);
  assert.equal(res[0].product.id, 1);
  assert.equal(res[0].refCents, 9750);
  assert.ok(res[0].discount > 0.4);
});

test('nessun alert se i prezzi sono omogenei', () => {
  const res = findDeals({ 1: [p(1, 9000), p(2, 9200), p(3, 9500), p(4, 10000)] }, rule);
  assert.equal(res.length, 0);
});

test('servono almeno 3 annunci di riferimento', () => {
  const res = findDeals({ 1: [p(1, 1000), p(2, 9000), p(3, 9500)] }, rule);
  assert.equal(res.length, 0);
});

test('scarta graded, in vacanza e condizioni troppo basse', () => {
  const list = [
    p(1, 1000, { graded: true }),
    p(2, 1000, { on_vacation: true }),
    p(3, 1000, { properties_hash: { condition: 'Poor' } }),
    p(4, 9000),
    p(5, 9500),
    p(6, 10000),
    p(7, 10500),
  ];
  assert.equal(findDeals({ 1: list }, rule).length, 0);
});

test('rispetta prezzo minimo e filtro nome', () => {
  const cheap = [p(1, 300), p(2, 900), p(3, 950), p(4, 1000)];
  assert.equal(findDeals({ 1: cheap }, rule).length, 0);
  const list = [p(1, 5000), p(2, 9000), p(3, 9500), p(4, 10000)];
  assert.equal(findDeals({ 1: list }, { ...rule, nameContains: 'pikachu' }).length, 0);
  assert.equal(findDeals({ 1: list }, { ...rule, nameContains: 'charizard' }).length, 1);
});

test('prezzo assoluto: scatta sotto la soglia anche con pochi annunci', () => {
  const list = [p(1, 1800), p(2, 2500)];
  const res = findDeals({ 1: list }, { maxPriceCents: 2000 });
  assert.equal(res.length, 1);
  assert.equal(res[0].product.id, 1);
  assert.equal(findDeals({ 1: list }, { maxPriceCents: 1000 }).length, 0);
});

test('filtro CardTrader Zero', () => {
  const z = (id, cents, hub) => p(id, cents, { user: { can_sell_via_hub: hub } });
  const list = [z(1, 1000, true), z(2, 1100, false)];
  assert.equal(findDeals({ 1: list }, { maxPriceCents: 5000, zero: 'only' }).length, 1);
  assert.equal(findDeals({ 1: list }, { maxPriceCents: 5000, zero: 'exclude' })[0].product.id, 2);
  assert.equal(findDeals({ 1: list }, { maxPriceCents: 5000 }).length, 2);
});

test('blueprintId limita il controllo a una carta', () => {
  const products = { 10: [p(1, 1000)], 20: [p(2, 1000)] };
  const res = findDeals(products, { maxPriceCents: 5000, blueprintId: 20 });
  assert.equal(res.length, 1);
  assert.equal(res[0].product.id, 2);
});
