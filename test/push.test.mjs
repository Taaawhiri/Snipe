import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPublicKey, verify } from 'node:crypto';
import { generateVapidKeys, sendPush } from '../src/push.js';

test('chiavi VAPID generate: formato corretto e firma verificabile', async () => {
  const keys = await generateVapidKeys();
  const raw = Buffer.from(keys.publicKey, 'base64url');
  assert.equal(raw.length, 65);
  assert.equal(raw[0], 4);
  assert.equal(Buffer.from(keys.privateKey, 'base64url').length, 32);

  let received;
  const srv = http.createServer((req, res) => {
    received = req.headers.authorization;
    res.statusCode = 201;
    res.end();
  });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const status = await sendPush({ ...keys, subject: 'https://esempio.workers.dev' }, `http://localhost:${port}/push`);
  srv.close();
  assert.equal(status, 201);

  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(received);
  assert.ok(m, 'intestazione Authorization nel formato VAPID');
  assert.equal(m[4], keys.publicKey);
  const pubKey = createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33, 65).toString('base64url') },
    format: 'jwk',
  });
  const ok = verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'));
  assert.ok(ok, 'firma ES256 valida');
  const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  assert.equal(claims.sub, 'https://esempio.workers.dev');
});
