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
const keyCache = new Map();

async function signingKey(keys) {
  if (keyCache.has(keys.privateKey)) return keyCache.get(keys.privateKey);
  const pub = b64uDecode(keys.publicKey);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64uEncode(pub.slice(1, 33)),
    y: b64uEncode(pub.slice(33, 65)),
    d: keys.privateKey,
    ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  keyCache.set(keys.privateKey, key);
  return key;
}

/** Genera una coppia di chiavi VAPID (pubblica in formato non compresso, privata = d), entrambe base64url. */
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const raw = new Uint8Array(65);
  raw[0] = 4;
  raw.set(b64uDecode(jwk.x), 1);
  raw.set(b64uDecode(jwk.y), 33);
  return { publicKey: b64uEncode(raw), privateKey: jwk.d };
}

/**
 * keys: { publicKey, privateKey, subject }.
 * Ritorna lo status HTTP del servizio push (201 = ok, 404/410 = iscrizione scaduta).
 */
export async function sendPush(keys, endpoint) {
  const key = await signingKey(keys);
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: keys.subject,
      }),
    ),
  );
  const input = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input));
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${input}.${b64uEncode(sig)}, k=${keys.publicKey}`,
      TTL: '300',
      Urgency: 'high',
    },
  });
  return res.status;
}
