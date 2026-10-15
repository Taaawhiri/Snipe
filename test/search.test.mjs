import test from 'node:test';
import assert from 'node:assert/strict';
import { normText, queryTerms, matchesTerms, relevance, packImg, unpackImg } from '../src/search.js';

test('normText toglie accenti e punteggiatura', () => {
  assert.equal(normText('Pokémon Card'), 'pokemon card');
  assert.equal(normText("Professor's Research"), 'professor s research');
  assert.equal(normText('  Mew  ex '), 'mew ex');
});

test('ricerca per più parole: tutte devono comparire', () => {
  const terms = queryTerms('Charizard ex');
  assert.equal(matchesTerms(normText('Charizard ex (Holo)'), terms), true);
  assert.equal(matchesTerms(normText('Charizard VMAX'), terms), false);
  assert.equal(matchesTerms(normText('Pikachu'), queryTerms('pika')), true);
  assert.equal(matchesTerms(normText('Pikachu'), []), false);
});

test('pertinenza: nome identico prima, poi inizio nome, poi il resto', () => {
  const t = queryTerms('pikachu');
  assert.ok(relevance('pikachu', t) < relevance('pikachu ex', t));
  assert.ok(relevance('pikachu ex', t) < relevance('detective pikachu', t));
  assert.ok(relevance('detective pikachu', t) <= relevance('flying pikachu vmax', t));
});

test('immagini accorciate e ricostruite senza perdite', () => {
  const url = 'https://cardtrader.com/uploads/blueprints/image/395474/preview_395474-30th-celebration-jp-booster-box.jpg';
  const packed = packImg(395474, url);
  assert.equal(packed, '30th-celebration-jp-booster-box.jpg');
  assert.equal(unpackImg(395474, packed), url);
  // un indirizzo con altro formato resta intero
  assert.equal(unpackImg(1, packImg(1, 'https://altro.example/x.jpg')), 'https://altro.example/x.jpg');
  assert.equal(unpackImg(1, ''), null);
});
