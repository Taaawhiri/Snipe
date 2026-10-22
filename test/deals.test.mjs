import test from 'node:test';
import assert from 'node:assert/strict';
import { findDeals, median, condRank, rejectReasons, normLang, isSingleCard, listingLang } from '../src/deals.js';

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

test('lingua: giapponese equivale a ja, jp e Japanese', () => {
  assert.equal(normLang('JA'), normLang('jp'));
  assert.equal(normLang('Japanese'), 'jp');
  const jp = p(1, 1000, { properties_hash: { condition: 'Near Mint', pokemon_language: 'jp' } });
  assert.deepEqual(rejectReasons(jp, { language: 'ja' }), []);
  assert.deepEqual(rejectReasons(jp, { language: 'en' }), ['lingua jp diversa']);
  const nolang = p(2, 1000);
  assert.deepEqual(rejectReasons(nolang, { language: 'ja' }), []);
});

test('rejectReasons spiega perché un annuncio è scartato', () => {
  const x = p(1, 1000, { user: { can_sell_via_hub: false }, properties_hash: { condition: 'Played' } });
  const reasons = rejectReasons(x, { zero: 'only', minCondition: 'Near Mint' });
  assert.equal(reasons.length, 2);
});

test('carte singole contro sigillati e accessori', () => {
  const single = (name, version, category_id = 1) => isSingleCard({ name, version, category_id }, [1]);
  assert.equal(single('Charizard', 'Holo Rare | 137/103'), true);
  assert.equal(single('Pikachu', 'Common | 025/165'), true);
  for (const n of ['151 Booster Box', 'Elite Trainer Box', 'Ultra Pro Binder 9 Pocket', 'Trainer Box', 'Booster Bundle', 'Premium Collection', 'Sleeves 65 pcs']) {
    assert.equal(isSingleCard({ name: n, version: null, category_id: 1 }, [1]), false, n);
  }
  // un nome da carta ma con "Box" nel nome viene scartato anche se la categoria sembra giusta
  assert.equal(single('Charizard Box', 'Holo Rare | 1/1'), false);
  // senza categorie note e senza versione: valgono nome e assenza di parole da sigillato
  assert.equal(isSingleCard({ name: 'Mew', version: null }, null), true);
  assert.equal(isSingleCard({ name: 'Mew', version: null, category_id: 9 }, [1]), false);
});

test('lingua letta anche da campi con nome diverso', () => {
  const mk = (h, extra = {}) => ({ properties_hash: h, ...extra });
  assert.equal(listingLang(mk({ pokemon_language: 'jp' })), 'jp');
  assert.equal(listingLang(mk({ language: 'zh-CN' })), 'zh-CN');
  assert.equal(listingLang(mk({ condition: 'Near Mint', idioma: 'es' })), 'es');
  assert.equal(listingLang(mk({ condition: 'Near Mint', l: 'ko' })), 'ko');
  assert.equal(listingLang(mk({ condition: 'Near Mint' })), null);
  assert.equal(listingLang(mk({}, { language: 'fr' })), 'fr');
  assert.equal(normLang('zh-CN'), 'zh');
});

import { cheapestPerCard, replaceAlerts } from '../src/deals.js';
test('un solo annuncio per carta: il più economico', () => {
  const D = (id, bp, cents) => ({ product: { id, blueprint_id: bp }, cents });
  const out = cheapestPerCard([D(1, 10, 500), D(2, 10, 300), D(3, 10, 400), D(4, 20, 900)]);
  assert.deepEqual(out.map((d) => d.product.id).sort(), [2, 4]);
});

test('il nuovo avviso sostituisce quelli precedenti della stessa carta, tranne i comprati', () => {
  const old = [
    { id: 'a', ruleId: 'r1', bp: 10, cents: 500 },
    { id: 'b', ruleId: 'r1', bp: 10, cents: 450, mark: 'bought' },
    { id: 'c', ruleId: 'r1', bp: 20, cents: 100 },
    { id: 'd', ruleId: 'r2', bp: 10, cents: 500 },
  ];
  const kept = replaceAlerts(old, [{ ruleId: 'r1', bp: 10, cents: 300 }]);
  assert.deepEqual(kept.map((a) => a.id), ['b', 'c', 'd']);
});
