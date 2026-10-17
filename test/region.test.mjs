import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionFromLangs, regionFromName } from '../src/region.js';

test('regione dalle lingue degli annunci', () => {
  assert.equal(regionFromLangs({ en: 40, it: 10, jp: 1 }), 'INT');
  assert.equal(regionFromLangs({ jp: 30, en: 2 }), 'JAP');
  assert.equal(regionFromLangs({ zh: 12 }), 'CN');
  assert.equal(regionFromLangs({ ko: 9, jp: 1 }), 'KR');
  assert.equal(regionFromLangs({ zh: 5, jp: 5, th: 4 }), 'Asia');
  assert.equal(regionFromLangs({ en: 1 }), null);
});
test('regione dal nome', () => {
  assert.equal(regionFromName('Gem Pack Vol.1'), 'CN');
  assert.equal(regionFromName('Scarlet & Violet 151 (Japanese)'), 'JAP');
  assert.equal(regionFromName('Paldea Evolved'), null);
});
