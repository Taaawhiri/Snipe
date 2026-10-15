// Genera le icone PNG della PWA (Poké Ball su fondo giallo) senza dipendenze. Esegui: npm run icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [255, 203, 5]; // giallo Pokémon
const RED = [155, 28, 49]; // bordeaux
const WHITE = [255, 255, 255];
const INK = [27, 35, 64];

function crc32(buf) {
  let c, crc = ~0;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Colore di un punto: Poké Ball con contorno scuro su fondo giallo. Coordinate da -1 a 1. */
function ballAt(dx, dy) {
  const d = Math.hypot(dx, dy);
  if (d > 0.82) return BG;
  if (d > 0.74) return INK; // contorno
  if (d < 0.2 && d > 0.12) return INK; // anello del pulsante
  if (d <= 0.12) return WHITE;
  if (Math.abs(dy) < 0.055) return INK; // fascia centrale
  return dy < 0 ? RED : WHITE;
}

function png(size, maskable) {
  const scale = maskable ? 0.72 : 1; // la versione maskable tiene il disegno nella zona sicura
  const cx = size / 2;
  const SS = 3; // supersampling per i bordi lisci
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = (x + (sx + 0.5) / SS - cx) / (size / 2) / scale;
          const dy = (y + (sy + 0.5) / SS - cx) / (size / 2) / scale;
          const c = ballAt(dx, dy);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS;
      row[1 + x * 3] = Math.round(r / n);
      row[2 + x * 3] = Math.round(g / n);
      row[3 + x * 3] = Math.round(b / n);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, false));
writeFileSync('public/icons/icon-512.png', png(512, false));
writeFileSync('public/icons/maskable-512.png', png(512, true));
console.log('Icone generate in public/icons/');
