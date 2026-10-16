import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPoint } from '../src/history.js';

const p = (cents, zero = false) => ({ quantity: 1, price: { cents }, user: { can_sell_via_hub: zero } });

test('un punto al giorno con il minimo visto', () => {
  const t1 = Date.parse('2026-10-17T08:00:00Z');
  let h = addPoint([], [p(500), p(700, true)], t1);
  h = addPoint(h, [p(450), p(800, true)], t1 + 3600_000);
  assert.deepEqual(h, [{ d: '2026-10-17', min: 450, zero: 700, n: 2 }]);
  h = addPoint(h, [p(600)], t1 + 86400_000);
  assert.equal(h.length, 2);
  assert.deepEqual(h[1], { d: '2026-10-18', min: 600, zero: null, n: 1 });
});
