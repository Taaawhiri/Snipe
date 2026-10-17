import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vintageEra } from '../src/vintage.js';

test('set vintage riconosciuti', () => {
  for (const n of ['Base Set', 'Jungle', 'Fossil', 'Team Rocket', 'Neo Genesis', 'Skyridge', 'Legendary Collection']) assert.equal(vintageEra(n), 'WOTC', n);
  for (const n of ['EX Dragon Frontiers', 'EX Team Rocket Returns', 'Power Keepers', 'EX Ruby & Sapphire']) assert.equal(vintageEra(n), 'EX', n);
});
test('set moderni non vintage', () => {
  for (const n of ['Paldea Evolved', 'Prismatic Evolutions', '151', 'Surging Sparks', '30th Celebration JP', 'Shiny Treasure ex', 'Terastal Festival ex', 'Mega Evolution']) assert.equal(vintageEra(n), null, n);
});
test('nomi ambigui moderni', () => {
  for (const n of ['Sword & Shield Base Set', 'Scarlet & Violet Base Set', "McDonald's Collection 2023", 'Fossil Expansion Pack 2024 Promo']) assert.equal(vintageEra(n), null, n);
});
