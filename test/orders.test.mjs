import test from 'node:test';
import assert from 'node:assert/strict';
import { orderChanges, nextOrderStates } from '../src/orders.js';

test('ordini: nessun avviso la prima volta', () => {
  assert.deepEqual(orderChanges(null, [{ id: 1, state: 'paid' }]), []);
});

test('ordini: avviso per un ordine nuovo o con stato cambiato, non per quelli uguali', () => {
  const prev = { 1: 'paid', 2: 'done' };
  const out = orderChanges(prev, [{ id: 1, state: 'sent' }, { id: 2, state: 'done' }, { id: 3, state: 'paid' }]);
  assert.deepEqual(out.map((o) => o.id), [1, 3]);
});

test('ordini: la mappa degli stati si aggiorna e resta limitata', () => {
  const m = nextOrderStates({ 1: 'paid' }, [{ id: 1, state: 'sent' }, { id: 2, state: 'paid' }]);
  assert.deepEqual(m, { 1: 'sent', 2: 'paid' });
  const many = nextOrderStates({}, Array.from({ length: 10 }, (_, i) => ({ id: i + 1, state: 'done' })), 4);
  assert.deepEqual(Object.keys(many).map(Number).sort((a, b) => a - b), [7, 8, 9, 10]);
});
