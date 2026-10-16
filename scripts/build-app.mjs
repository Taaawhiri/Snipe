// Ricompone public/app.js dalle parti in ui/ (in ordine di nome). public/app.js è generato: si modifica ui/.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function buildApp() {
  const dir = join(root, 'ui');
  const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  // Ogni parte finisce con un a capo: concatenate così come sono, con un solo a capo finale.
  const body = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('');
  return body.replace(/\n+$/, '') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(root, 'public', 'app.js'), buildApp());
  console.log('public/app.js ricomposto da ui/');
}
