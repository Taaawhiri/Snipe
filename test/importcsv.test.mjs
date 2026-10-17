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
