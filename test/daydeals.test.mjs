import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealsFromCards } from '../src/daydeals.js';

const card = (o) => ({ single: true, id: 1, name: 'X', cm: { trend: 20 }, lc: {}, currency: 'EUR', ...o });

test('affari: inglese NM almeno 25% sotto la tendenza', () => {
  const out = dealsFromCards([
    card({ id: 1, lc: { 'en|5': [1200, null], 'jp|6': [500, null] } }), // 40% sotto
    card({ id: 2, lc: { 'en|5': [1800, null] } }), // 10%: no
    card({ id: 3, lc: { 'en|3': [500, null] } }), // condizione bassa: no
    card({ id: 4, cm: { trend: 5 }, lc: { 'en|6': [100, null] } }), // tendenza bassa: no
    card({ id: 5, single: false, lc: { 'en|6': [100, null] } }),
  ]);
  assert.deepEqual(out.map((d) => d.id), [1]);
  assert.equal(Math.round(out[0].discount * 100), 40);
});
