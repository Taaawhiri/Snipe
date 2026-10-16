import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScan, scoreRow } from '../src/cardid.js';

test('parseScan: JSON nel testo, numero con barra, lingua giapponese', () => {
  const s = parseScan('Here it is: {"name":"Charizard","number":"137/103","total":"","set_code":"","language":"Japanese","confidence":0.9}');
  assert.equal(s.name, 'Charizard');
  assert.equal(s.number, '137');
  assert.equal(s.total, '103');
  assert.equal(s.language, 'jp');
  assert.equal(parseScan('nessun json'), null);
});

test('scoreRow: nome e numero esatti battono il solo nome', () => {
  const scan = { name: 'Charizard', number: '137', total: '103', setCode: '' };
  const right = scoreRow([1, 'Charizard', 'Holo Rare | 137/103'], scan);
  const sameName = scoreRow([2, 'Charizard', 'Rare | 4/102'], scan);
  const sameNum = scoreRow([3, 'Pikachu', 'Rare | 137/103'], scan);
  assert.ok(right > sameName && right > sameNum);
  assert.equal(scoreRow([4, 'Charizard ex', 'SIR | 199/165'], { ...scan, number: '199', total: '165', name: 'Charizard ex' }), 6 + 5 + 3);
});
