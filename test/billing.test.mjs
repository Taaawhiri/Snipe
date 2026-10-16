import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingChange, checkoutUrl, verifySignature } from '../src/billing.js';
import { createHmac } from 'node:crypto';

const env = { LS_VARIANTS_PRO: '111, 112', LS_VARIANTS_SNIPER: '221' };
const ev = (event, attrs, user = '9042') => ({ meta: { event_name: event, custom_data: { user_id: user } }, data: { type: 'subscriptions', id: '5', attributes: { variant_id: 111, urls: { customer_portal: 'https://x/portal' }, ...attrs } } });

test('firma del webhook', async () => {
  const body = '{"a":1}';
  const sig = createHmac('sha256', 'segreto').update(body).digest('hex');
  assert.equal(await verifySignature('segreto', body, sig), true);
  assert.equal(await verifySignature('segreto', body + ' ', sig), false);
  assert.equal(await verifySignature('', body, sig), false);
});

test('stati dell\'abbonamento -> piano', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  assert.equal(billingChange(env, ev('subscription_created', { status: 'active' }), now).plan, 'pro');
  assert.equal(billingChange(env, ev('subscription_updated', { status: 'active', variant_id: 221 }), now).plan, 'sniper');
  assert.equal(billingChange(env, ev('subscription_cancelled', { status: 'cancelled', ends_at: '2026-11-01T00:00:00Z' }), now).plan, 'pro');
  assert.equal(billingChange(env, ev('subscription_expired', { status: 'expired' }), now).plan, 'free');
  assert.equal(billingChange(env, ev('subscription_updated', { status: 'active', variant_id: 999 }), now).plan, 'free');
  assert.equal(billingChange(env, ev('order_created', { status: 'paid' }), now), null);
  assert.equal(billingChange(env, ev('subscription_created', { status: 'active' }, null), now), null);
  assert.equal(billingChange(env, ev('subscription_created', { status: 'active' }), now).billing.portalUrl, 'https://x/portal');
});

test('link di acquisto con utente', () => {
  const u = checkoutUrl('https://snipe.lemonsqueezy.com/checkout/buy/abc', 9042);
  assert.ok(u.includes('checkout%5Bcustom%5D%5Buser_id%5D=9042'));
});

import { rejectReasons } from '../src/deals.js';
test('regola con più lingue: accetta una qualsiasi', () => {
  const p = { quantity: 1, price: { cents: 500 }, properties_hash: { condition: 'Near Mint', pokemon_language: 'en' } };
  assert.equal(rejectReasons(p, { language: 'it,en' }).filter((x) => x.startsWith('lingua')).length, 0);
  assert.equal(rejectReasons(p, { language: 'ja,fr' }).filter((x) => x.startsWith('lingua')).length, 1);
});
