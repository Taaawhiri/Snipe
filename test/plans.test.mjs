import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planOf, rulesInPlan } from '../src/plans.js';

test('piano sconosciuto: gratuito', () => {
  assert.equal(planOf('boh').id, 'free');
  assert.equal(planOf('pro').maxRules, 30);
});

test('il piano gratuito controlla solo i primi 3 alert su carta e nessun set', () => {
  const rules = [
    { id: 'a', enabled: true, blueprintId: 1 },
    { id: 'b', enabled: false, blueprintId: 2 },
    { id: 's', enabled: true, blueprintId: null },
    { id: 'c', enabled: true, blueprintId: 3 },
    { id: 'd', enabled: true, blueprintId: 4 },
    { id: 'e', enabled: true, blueprintId: 5 },
  ];
  assert.deepEqual([...rulesInPlan(rules, planOf('free'))], ['a', 'c', 'd']);
  assert.deepEqual([...rulesInPlan(rules, planOf('pro'))].sort(), ['a', 'c', 'd', 'e', 's']);
});
