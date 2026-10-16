import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSession, readSession } from '../src/session.js';

test('sessione firmata: valida, manomessa, scaduta', async () => {
  const s = await makeSession('segreto', '12345');
  assert.equal(await readSession('segreto', s), '12345');
  assert.equal(await readSession('altro', s), null);
  assert.equal(await readSession('segreto', s.replace('12345', '12346')), null);
  assert.equal(await readSession('segreto', s, Date.now() + 400 * 86400_000), null);
  assert.equal(await readSession('segreto', 'spazzatura'), null);
});
