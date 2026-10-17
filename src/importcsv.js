// Importazione della collezione da un file CSV: lettura del file, colonne, e confronto con le espansioni.
import { normText } from './search.js';

/** Legge un CSV (separatore ; , o tab, virgolette doppie). Ritorna righe di celle. */
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const first = s.split(/\r?\n/, 1)[0] || '';
  const count = (c) => first.split(c).length - 1;
  const sep = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const COLS = {
  name: /^(carta|card|nome|name|pokemon|pok[eé]mon)$/,
  number: /^(numero|number|n|nr|#|no|num)$/,
  set: /^(espansione|set|expansion|serie|edizione)$/,
  lang: /^(lingua|language|lang)$/,
  cond: /^(condizione|condition|cond|stato)$/,
  qty: /^(copie|quantita|quantity|qty|qta|pezzi|count)$/,
  paid: /^(pagata|pagato|prezzo pagato|paid|price paid|costo|prezzo)/,
  bp: /^(id cardtrader|blueprint|blueprint id|bp)$/,
};

const COND = [
  [/^(m|mt|mint)$/, 'Mint'], [/^(nm|near mint|quasi perfetta)$/, 'Near Mint'], [/^(sp|ex|excellent|slightly played|lp|lightly played)$/, 'Slightly Played'],
  [/^(mp|moderately played|gd|good)$/, 'Moderately Played'], [/^(pl|played)$/, 'Played'], [/^(hp|heavily played)$/, 'Heavily Played'], [/^(po|poor)$/, 'Poor'],
];
const LANG = { jp: 'jp', ja: 'jp', jap: 'jp', giapponese: 'jp', japanese: 'jp', en: 'en', eng: 'en', inglese: 'en', english: 'en', it: 'it', ita: 'it', italiano: 'it', italian: 'it',
  fr: 'fr', francese: 'fr', french: 'fr', de: 'de', tedesco: 'de', german: 'de', es: 'es', spagnolo: 'es', spanish: 'es', pt: 'pt', portoghese: 'pt',
  ko: 'ko', kr: 'ko', coreano: 'ko', korean: 'ko', zh: 'zh', cn: 'zh', cinese: 'zh', chinese: 'zh', 'zh-cn': 'zh', 'zh-tw': 'zh' };

const money = (v) => {
  const t = String(v || '').replace(/[€\s]/g, '');
  if (!t) return null;
  const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; // 0 = trovata in una busta
};

/** Righe del CSV -> carte da cercare. La prima riga deve avere i nomi delle colonne. */
export function mapRows(rows) {
  if (!rows.length) return { items: [], error: 'Il file è vuoto.' };
  const head = rows[0].map((h) => normText(h).replace(/[()€']/g, '').replace(/\s+l una$/, '').trim());
  const col = {};
  for (const [k, re] of Object.entries(COLS)) {
    const i = head.findIndex((h) => re.test(h));
    if (i >= 0) col[k] = i;
  }
  if (col.name == null && col.bp == null) return { items: [], error: 'Manca la colonna “Carta” con il nome della carta.' };
  const get = (r, k) => (col[k] == null ? '' : String(r[col[k]] || '').trim());
  const items = rows.slice(1).map((r, i) => {
    let number = get(r, 'number').replace(/^#/, '');
    let total = '';
    const m = /^([A-Za-z]*\d+[A-Za-z]*)\s*\/\s*([A-Za-z]*\d+)$/.exec(number);
    if (m) { number = m[1]; total = m[2]; }
    const condRaw = normText(get(r, 'cond'));
    const cond = (COND.find(([re]) => re.test(condRaw)) || [])[1] || (condRaw ? '' : 'Near Mint');
    const qty = Math.max(1, Math.min(999, parseInt(get(r, 'qty'), 10) || 1));
    return {
      line: i + 2,
      name: get(r, 'name').slice(0, 120), number: number.slice(0, 12), total: total.slice(0, 12), set: get(r, 'set').slice(0, 100),
      lang: LANG[normText(get(r, 'lang'))] || '', cond, qty, paidCents: money(get(r, 'paid')),
      bp: parseInt(get(r, 'bp'), 10) || null,
    };
  }).filter((x) => x.name || x.bp);
  return { items };
}

/** Quanto il testo scritto somiglia a un'espansione (nome o codice). 0 = per niente. */
export function expScore(query, exp) {
  const q = normText(query);
  if (!q) return 0;
  const code = normText(exp.code);
  if (code && q === code) return 10;
  const n = normText(exp.name);
  if (q === n) return 10;
  const qw = q.split(' ').filter(Boolean);
  const nw = new Set(n.split(' '));
  const hit = qw.filter((w) => nw.has(w) || (w.length > 3 && [...nw].some((x) => x.startsWith(w)))).length;
  if (!hit) return 0;
  return Math.round((hit / qw.length) * 6 + (hit / nw.size) * 3);
}
