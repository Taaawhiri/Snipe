import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expScore, mapRows, parseCsv } from '../src/importcsv.js';

test('CSV italiano con ; e decimali con virgola', () => {
  const { items } = mapRows(parseCsv('Carta;Numero;Espansione;Lingua;Condizione;Copie;Pagata\r\nUmbreon ex;044/040;30th Celebration Premium Deck Set;JP;NM;2;100,50\r\n'));
  assert.deepEqual(items[0], { line: 2, name: 'Umbreon ex', number: '044', total: '040', set: '30th Celebration Premium Deck Set', lang: 'jp', cond: 'Near Mint', qty: 2, paidCents: 10050, bp: null });
});
test('CSV inglese con virgole e virgolette, colonne minime', () => {
  const { items } = mapRows(parseCsv('Name,Set\n"Pikachu, promo",151\n'));
  assert.equal(items[0].name, 'Pikachu, promo');
  assert.equal(items[0].cond, 'Near Mint');
  assert.equal(items[0].qty, 1);
});
test('export di HoloSnipe: usa l’ID CardTrader', () => {
  const { items } = mapRows(parseCsv("Carta;Espansione;Lingua;Condizione;Copie;Pagata (€ l'una);ID CardTrader\nLugia;30th Celebration JP;JP;Near Mint;1;165,00;12345\n"));
  assert.equal(items[0].bp, 12345);
  assert.equal(items[0].paidCents, 16500);
});
test('manca la colonna della carta', () => {
  assert.ok(mapRows(parseCsv('Foo;Bar\n1;2\n')).error);
});
test('espansione scritta in modo approssimativo', () => {
  const e = { name: '30th Celebration Premium Deck Set', code: 'mf' };
  assert.ok(expScore('30th premium deck', e) >= 6);
  assert.equal(expScore('mf', e), 10);
  assert.equal(expScore('Paldea Evolved', e), 0);
});

import { summarize } from '../src/collection.js';
test('carta pagata 0 (sbustata): tutto il valore è guadagno', () => {
  const sm = summarize([{ qty: 1, paidCents: 0, price: { cents: 5000 } }, { qty: 1, paidCents: null, price: { cents: 3000 } }]);
  assert.equal(sm.valueKnown - sm.paidPriced, 5000);
  assert.equal(sm.known, 1);
});

import { gradeOf, isListable } from '../src/deals.js';
import { priceFor as pf } from '../src/collection.js';
test('gradate: voto letto dal commento', () => {
  assert.deepEqual(gradeOf({ description: 'BGS 9.5' }), { co: 'BGS', g: '9.5' });
  assert.deepEqual(gradeOf({ description: 'Beckett 8.5' }), { co: 'BGS', g: '8.5' });
  assert.deepEqual(gradeOf({ description: 'psa10 gem mint' }), { co: 'PSA', g: '10' });
  assert.equal(gradeOf({ description: 'carta perfetta, mai giocata' }), null);
  const mk = (cents, description, graded = false) => ({ price: { cents }, quantity: 1, description, graded, properties_hash: { condition: 'Near Mint', pokemon_language: 'jp' } });
  assert.equal(isListable(mk(100, 'PSA 9')), false); // segnata non gradata ma col voto nel commento: esclusa dai prezzi normali
  const list = [mk(5000, 'PSA 10'), mk(3000, 'PSA 9'), mk(800, ''), mk(7000, 'PSA 10', true)];
  assert.equal(pf(list, 'jp', 'PSA 10').cents, 5000);
  assert.equal(pf(list, 'jp', 'Near Mint').cents, 800);
  // Nessuna BGS 10 in vendita: stima dalla copia non gradata (800) col premio del voto, segnata come stima.
  const est = pf(list, 'jp', 'BGS 10');
  assert.equal(est.estimated, true);
  assert.ok(est.cents > 800);
  assert.equal(pf([], 'jp', 'BGS 10'), null);
});
