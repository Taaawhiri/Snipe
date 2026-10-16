import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheapestShipping } from '../src/shipping.js';

test('sceglie il metodo più economico nella fascia di peso di una carta', () => {
  const methods = [
    { name: 'Tracciata', tracked: true, shipping_method_costs: [{ from_grams: 0, to_grams: 100, price: { cents: 650 } }] },
    { name: 'Lettera', tracked: false, min_estimate_shipping_days: 3, max_estimate_shipping_days: 7, shipping_method_costs: [{ from_grams: 0, to_grams: 50, price: { cents: 180 } }, { from_grams: 51, to_grams: 200, price: { cents: 300 } }] },
  ];
  assert.deepEqual(cheapestShipping(methods), { cents: 180, name: 'Lettera', tracked: false, days: [3, 7] });
});

test('nessun metodo utile: null', () => {
  assert.equal(cheapestShipping([]), null);
  assert.equal(cheapestShipping([{ name: 'x', shipping_method_costs: [{ from_grams: 100, to_grams: 200, price: 300 }] }]), null);
});
