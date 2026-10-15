// Web Push senza payload: basta il JWT VAPID (ES256) via WebCrypto, nessuna libreria.
// Il service worker, alla ricezione, scarica /api/latest e mostra la notifica.

function b64uEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

const enc = new TextEncoder();
let cachedKey = null;

async function signingKey(env) {
  if (cachedKey) return cachedKey;
  const pub = b64uDecode(env.VAPID_PUBLIC_KEY);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64uEncode(pub.slice(1, 33)),
    y: b64uEncode(pub.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY,
    ext: true,
  };
  cachedKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return cachedKey;
}

/** Ritorna lo status HTTP del servizio push (201 = ok, 404/410 = iscrizione scaduta). */
export async function sendPush(env, endpoint) {
  const key = await signingKey(env);
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT || 'mailto:admin@example.com',
      }),
    ),
  );
  const input = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input));
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${input}.${b64uEncode(sig)}, k=${env.VAPID_PUBLIC_KEY}`,
      TTL: '300',
      Urgency: 'high',
    },
  });
  return res.status;
}
