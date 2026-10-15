import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePriceGuide, toShards, shardOf, cmEntry, maxCentsBelow, SHARDS } from '../src/cardmarket.js';

const sample = '{"version":1,"createdAt":"2026-10-15T02:46:33+0200","priceGuides":[' +
  '{"idProduct":271439,"idCategory":52,"avg":149,"low":150,"trend":279.1,"avg1":null,"avg7":null,"avg30":null,"avg-holo":null,"low-holo":null,"trend-holo":3.93},' +
  '{"idProduct":271440,"idCategory":53,"avg":2103,"low":100000,"trend":2239.24,"avg1":null,"avg7":null,"avg30":2000.5,"avg-holo":null,"low-holo":null,"trend-holo":null},' +
  '{"idProduct":5,"idCategory":53,"avg":null,"low":null,"trend":null}]}';

test('parsePriceGuide legge gli elementi e i valori mancanti', () => {
  const rows = parsePriceGuide(sample);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], [271439, 279.1, null, 150, 149, 3.93]);
  assert.deepEqual(rows[1], [271440, 2239.24, 2000.5, 100000, 2103, null]);
  assert.equal(cmEntry(rows[2].slice(1)), null); // senza tendenza non c'è riferimento
});

test('formato sconosciuto: errore chiaro', () => {
  assert.throws(() => parsePriceGuide('<html>non è json</html>'), /non riconosciuto/);
});

test('shard: ogni prodotto finisce in un solo gruppo ritrovabile', () => {
  const shards = toShards(parsePriceGuide(sample));
  assert.equal(shards.length, SHARDS);
  const id = 271439;
  assert.deepEqual(cmEntry(shards[shardOf(id)][id]), { trend: 279.1, avg30: null, low: 150, avg: 149, trendFoil: 3.93 });
});

test('soglia sotto la tendenza', () => {
  assert.equal(maxCentsBelow(100, 20), 8000);
  assert.equal(maxCentsBelow(12.5, 10), 1125);
  assert.equal(maxCentsBelow(0, 20), null);
});
