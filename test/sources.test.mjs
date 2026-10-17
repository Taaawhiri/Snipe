import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDue, pickData } from '../src/sources.js';

const now = 1_000_000;

test('sceglie le fonti più vecchie, al massimo n', () => {
  const ts = { a: now - 10_000, b: now - 50_000, c: 0 };
  const src = Object.keys(ts).map((id) => ({ id, prio: 1 }));
  assert.deepEqual(pickDue(src, (s) => ts[s.id], now, 2).map((s) => s.id), ['c', 'b']);
});

test('la stella fa passare avanti un alert', () => {
  const ts = { a: now - 20_000, b: now - 50_000 };
  const src = [{ id: 'a', prio: 3 }, { id: 'b', prio: 1 }];
  assert.deepEqual(pickDue(src, (s) => ts[s.id], now, 1).map((s) => s.id), ['a']);
});

test('la lista dei desideri aspetta la sua età minima', () => {
  const src = [{ id: 'w', prio: 1, minAge: 15 * 60_000 }];
  assert.equal(pickDue(src, () => now - 60_000, now, 2).length, 0);
  assert.equal(pickDue(src, () => 0, now, 2).length, 1);
});

test('dati per la regola: carta se più recente o fresca, altrimenti espansione', () => {
  const exp = { ts: now - 1000, data: 'E' };
  assert.equal(pickData(exp, { ts: now - 60_000, data: 'B' }, now), 'B'); // fresca (< 3 min)
  assert.equal(pickData(exp, { ts: now - 10 * 60_000, data: 'B' }, now), 'E'); // vecchia
  assert.equal(pickData(null, null, now), null);
});

test('pickDue: un alert con la stella vecchio di 1 ora passa prima di una carta mai letta', () => {
  const now = Date.parse('2026-10-17T20:00:00Z');
  const src = [{ id: 'nuova', prio: 2 }, { id: 'stella', prio: 6 }];
  const ts = { nuova: 0, stella: now - 3600_000 };
  assert.deepEqual(pickDue(src, (s) => ts[s.id], now, 1).map((s) => s.id), ['stella']);
});
