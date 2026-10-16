// Sessione in un cookie firmato (HMAC-SHA256): "<userId>.<scadenza>.<firma>".
// Il cookie è HttpOnly, così anche il service worker lo invia quando chiede l'ultimo avviso.

export const COOKIE = 'snipe_s';
export const SESSION_DAYS = 365;

const enc = new TextEncoder();

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(secret, data) {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data)));
}

export async function makeSession(secret, userId, now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  const body = `${userId}.${exp}`;
  return `${body}.${await sign(secret, body)}`;
}

/** userId (stringa) se il cookie è valido e non scaduto, altrimenti null. */
export async function readSession(secret, value, now = Date.now()) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  if (!/^\d+$/.test(userId) || !/^\d+$/.test(exp)) return null;
  if (Number(exp) * 1000 < now) return null;
  const want = await sign(secret, `${userId}.${exp}`);
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? userId : null;
}

export function getCookie(req, name) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(value) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
