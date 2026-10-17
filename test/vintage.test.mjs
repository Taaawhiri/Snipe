import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vintageEra } from '../src/vintage.js';
import { RELEASED } from '../src/expdates.js';

test('era dalla data di uscita', () => {
  assert.equal(vintageEra(1472), 'WOTC'); // Base Set
  assert.equal(vintageEra(1486), 'WOTC'); // Neo Destiny
  assert.equal(vintageEra(1492), 'WOTC'); // Skyridge
  assert.equal(vintageEra(1970), 'WOTC'); // Expansion Pack (JP 1996)
  assert.equal(vintageEra(1991), 'EX'); // ADV Expansion Pack (JP 2003)
  assert.equal(vintageEra(1493), 'EX'); // EX Ruby & Sapphire
  assert.equal(vintageEra(1515), 'EX'); // EX Power Keepers
  assert.equal(vintageEra(2007), null); // Space-Time Creation (DP)
  assert.equal(vintageEra(1518), null); // Diamond & Pearl
  assert.equal(vintageEra(999999), null); // espansione nuova, senza data
});
test('elenco delle date completo', () => {
  assert.ok(Object.keys(RELEASED).length >= 850);
});
