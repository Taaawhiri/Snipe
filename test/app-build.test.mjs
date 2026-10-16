import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildApp } from '../scripts/build-app.mjs';

test('public/app.js è allineato con le parti in ui/ (npm run app per ricomporlo)', () => {
  assert.equal(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), buildApp());
});
