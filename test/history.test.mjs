import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPoint } from '../src/history.js';

const p = (cents, zero = false) => ({ quantity: 1, price: { cents }, user: { can_sell_via_hub: zero }, properties_hash: { condition: 'Near Mint' } });

test('un punto al giorno: segue l’ultima lettura della giornata', () => {
  const t1 = Date.parse('2026-10-17T08:00:00Z');
  let h = addPoint([], [p(500), p(700, true)], t1);
  h = addPoint(h, [p(450), p(800, true)], t1 + 3600_000);
  assert.deepEqual(h, [{ d: '2026-10-17', min: 450, zero: 800, n: 2 }]); // lo Zero da 7 € è stato venduto: vale l'ultima lettura
  h = addPoint(h, [p(600)], t1 + 86400_000);
  assert.equal(h.length, 2);
  assert.deepEqual(h[1], { d: '2026-10-18', min: 600, zero: null, n: 1 });
});

import { refWeekAgo } from '../src/history.js';

test('riferimento di 7 giorni fa', () => {
  const now = Date.parse('2026-10-20T10:00:00Z');
  const h = [{ d: '2026-10-10', min: 900 }, { d: '2026-10-13', min: 1000 }, { d: '2026-10-15', min: 800 }, { d: '2026-10-20', min: 700 }];
  assert.equal(refWeekAgo(h, now), 1000);
  assert.equal(refWeekAgo(h.slice(2), now), null); // meno di 3 giorni
  assert.equal(refWeekAgo([{ d: '2026-10-17', min: 5 }, { d: '2026-10-18', min: 6 }, { d: '2026-10-19', min: 7 }], now), 5); // il più vecchio
});
