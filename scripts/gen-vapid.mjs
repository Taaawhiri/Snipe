// Genera le chiavi VAPID per le notifiche push. Esegui: npm run vapid
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

const b64u = (b) => Buffer.from(b).toString('base64url');
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);

console.log('Aggiungi questi due Secret su Cloudflare (Workers → snipe → Settings → Variables and Secrets):\n');
console.log(`VAPID_PUBLIC_KEY=${b64u(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${priv.d}`);
