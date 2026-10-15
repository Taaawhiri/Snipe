// Genera le icone PNG della PWA (mirino su fondo scuro) senza dipendenze. Esegui: npm run icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG = [15, 20, 25];
const FG = [61, 219, 192];

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

function png(size, maskable) {
  const scale = maskable ? 0.7 : 1; // la versione maskable tiene il disegno nella zona sicura
  const cx = size / 2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - cx) / (size / 2) / scale;
      const dy = (y + 0.5 - cx) / (size / 2) / scale;
      const d = Math.hypot(dx, dy);
      const ring = Math.abs(d - 0.55) < 0.07;
      const cross = (Math.abs(dx) < 0.04 && Math.abs(dy) < 0.85) || (Math.abs(dy) < 0.04 && Math.abs(dx) < 0.85);
      const hole = d < 0.3 && cross; // il mirino non attraversa il centro
      const dot = d < 0.09;
      const on = (ring || (cross && !hole && d > 0.3) || dot) && d < 0.9;
      const c = on ? FG : BG;
      row[1 + x * 3] = c[0];
      row[2 + x * 3] = c[1];
      row[3 + x * 3] = c[2];
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
