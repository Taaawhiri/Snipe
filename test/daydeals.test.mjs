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

test('ogni lingua si confronta con sé stessa', () => {
  const cards = [{ id: 1, single: true, name: 'X', cm: null }];
  // Le giapponesi costano la metà delle inglesi, ma tra loro sono in linea: nessun affare.
  const products = { 1: [L(1, 1000, 'jp'), L(2, 1020, 'jp'), L(3, 1050, 'jp'), L(4, 1080, 'jp'), L(5, 2000), L(6, 2050), L(7, 2100), L(8, 2150)] };
  assert.equal(dealsFromProducts(cards, products).length, 0);
});

import { zeroDealsFromProducts } from '../src/daydeals.js';

test('affari solo Zero: annuncio Zero molto sotto gli altri annunci', () => {
  const cards = [{ id: 1, single: true, name: 'X', cm: null }];
  const Z = (id, cents) => ({ ...L(id, cents), user: { username: 'z' + id, can_sell_via_hub: true } });
  const products = { 1: [L(1, 900), Z(2, 1000), L(3, 1900), L(4, 2000), L(5, 2100), L(6, 2200)] };
  const out = zeroDealsFromProducts(cards, products);
  assert.equal(out.length, 1);
  assert.equal(out[0].cents, 1000);
  assert.equal(out[0].zero, true);
});

import { wantedDealLang, DEAL_LANGS } from '../src/daydeals.js';
test('affari: solo giapponese, coreano, cinese semplificato, inglese e italiano', () => {
  const P = (lang) => ({ properties_hash: { pokemon_language: lang } });
  for (const l of ['jp', 'ja', 'ko', 'en', 'it', 'zh-cn', 'zh']) assert.equal(wantedDealLang(P(l)), true, l);
  for (const l of ['de', 'es', 'fr', 'pt', 'ru', 'th', 'zh-tw']) assert.equal(wantedDealLang(P(l)), false, l);
  assert.ok(DEAL_LANGS.has('zh') && !DEAL_LANGS.has('de'));
});

test('affari del giorno: nessun affare tedesco', () => {
  const cards = [{ id: 1, single: true, name: 'X', cm: null }];
  const products = { 1: [L(1, 900, 'de'), L(2, 1900, 'de'), L(3, 2000, 'de'), L(4, 2100, 'de'), L(5, 2200, 'de')] };
  assert.equal(dealsFromProducts(cards, products).length, 0);
});

import { bogusRef } from '../src/daydeals.js';
test('affari: niente confronto con prezzi assurdi (10.000 € parcheggiati)', () => {
  assert.equal(bogusRef(1000064, 214), true);
  assert.equal(bogusRef(2000, 1500), false);
  assert.equal(bogusRef(1000064, null), false);
  const cards = [{ id: 1, single: true, name: 'X', cm: { trend: 2.14 } }];
  const products = { 1: [L(1, 507), L(2, 1000064), L(3, 1000064), L(4, 1000064), L(5, 1000064), L(6, 1000064)] };
  assert.equal(dealsFromProducts(cards, products).length, 0);
  // senza tendenza Cardmarket, uno sconto del 99% è comunque scartato
  const noCm = [{ id: 1, single: true, name: 'X', cm: null }];
  assert.equal(dealsFromProducts(noCm, products).length, 0);
});
