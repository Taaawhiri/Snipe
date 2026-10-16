// Lemon Squeezy: firma dei webhook e piano dall'evento di abbonamento (logica pura, testabile).

const enc = new TextEncoder();

/** X-Signature = HMAC-SHA256 esadecimale del corpo grezzo, con la chiave di firma del webhook. */
export async function verifySignature(secret, rawBody, signature) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(rawBody)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  const sig = String(signature).trim().toLowerCase();
  if (hex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

/** Piano corrispondente a una variante (prodotto) di Lemon Squeezy, dalle variabili LS_VARIANTS_PRO / LS_VARIANTS_SNIPER. */
export function planForVariant(env, variantId) {
  const id = String(variantId || '');
  if (list(env.LS_VARIANTS_SNIPER).includes(id)) return 'sniper';
  if (list(env.LS_VARIANTS_PRO).includes(id)) return 'pro';
  return null;
}

/**
 * Dall'evento al cambio di piano. null se l'evento non riguarda un abbonamento o manca l'utente.
 * Stati: active / on_trial / past_due (tentativi di pagamento in corso) = piano attivo;
 * cancelled = attivo fino a ends_at (poi arriva subscription_expired); expired / paused / unpaid = Gratuito.
 */
export function billingChange(env, payload, now = Date.now()) {
  const event = payload && payload.meta && payload.meta.event_name;
  const userId = payload && payload.meta && payload.meta.custom_data && payload.meta.custom_data.user_id;
  const data = payload && payload.data;
  if (!event || !String(event).startsWith('subscription_') || !userId || !data || data.type !== 'subscriptions') return null;
  const a = data.attributes || {};
  const paid = planForVariant(env, a.variant_id);
  const status = String(a.status || '');
  const endsAt = a.ends_at ? Date.parse(a.ends_at) : null;
  let plan;
  if (['active', 'on_trial', 'past_due'].includes(status)) plan = paid;
  else if (status === 'cancelled') plan = endsAt && endsAt > now ? paid : 'free';
  else plan = 'free';
  return {
    userId: String(userId),
    plan: plan || 'free',
    billing: {
      provider: 'lemonsqueezy',
      subscriptionId: String(data.id || ''),
      status,
      variantId: String(a.variant_id || ''),
      variantName: String(a.variant_name || a.product_name || '').slice(0, 80),
      renewsAt: a.renews_at || null,
      endsAt: a.ends_at || null,
      portalUrl: (a.urls && a.urls.customer_portal) || null,
      updatedAt: now,
    },
  };
}

/** Link di acquisto con l'utente allegato (torna nel webhook come meta.custom_data.user_id). */
export function checkoutUrl(base, userId) {
  if (!base) return null;
  const u = new URL(base);
  u.searchParams.set('checkout[custom][user_id]', String(userId));
  return u.toString();
}
