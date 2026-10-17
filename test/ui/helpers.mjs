// Ambiente per i test delle schermate: la pagina vera (public/) servita in locale, con le API simulate.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const PUB = fileURLToPath(new URL('../../public/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

export async function startServer() {
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    try {
      const body = await readFile(join(PUB, p));
      res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

export async function launch() {
  // CHROME_PATH per usare un Chromium già installato; altrimenti quello di Playwright.
  const executablePath = process.env.CHROME_PATH;
  return chromium.launch(executablePath ? { executablePath } : {});
}

export const PLAN = { id: 'pro', label: 'Pro', maxRules: 30, maxSetRules: 1, maxWish: 200, maxColl: 500, maxScans: 200, batchScan: true, scanSec: 30, historyDays: 120, shipping: true, priority: true, unlimited: 100000 };

export function baseState(over = {}) {
  return {
    rules: [], alerts: [], status: { lastScan: Date.now() - 5000, scans: 10 }, pushDevices: 1, bought: [],
    sellers: { fav: [], block: [] }, outOfPlan: [], wish: [],
    account: { name: 'Tester', plan: PLAN },
    settings: { paused: false, quietEnabled: false, quietFrom: '23:00', quietTo: '08:00', tz: 'Europe/Rome', scanEverySec: 30, summary: true, collZero: false, collTypical: false },
    system: { build: '#test', index: { done: 1, total: 1, complete: true, withCards: 1 }, cm: { ts: Date.now() }, market: { gapMs: 3000, tokens: 6, recent429: [] } },
    vapidPublic: 'x', conditions: ['Poor', 'Heavily Played', 'Played', 'Moderately Played', 'Slightly Played', 'Near Mint', 'Mint'],
    ...over,
  };
}

export const COLLECTION = {
  items: [
    { key: '1|en|Near Mint', bp: 1, lang: 'en', cond: 'Near Mint', qty: 1, paidCents: 9500, name: 'Charizard ex', expName: 'Obsidian Flames', image: null, price: { cents: 14200 }, cmCents: 12800, change7: 0.08 },
    { key: '2|jp|Near Mint', bp: 2, lang: 'jp', cond: 'Near Mint', qty: 3, paidCents: 1200, name: 'Pikachu', expName: '151', image: null, price: { cents: 900 }, cmCents: null, change7: -0.04 },
  ],
  summary: { value: 16900, paid: 13100, paidPriced: 13100, qty: 4, distinct: 2, missing: 0, cm: 12800 },
  history: [], limit: 500, unlimited: 100000, zeroOnly: false, typical: false, refreshing: 0,
};

/**
 * Apre la pagina con le API simulate. api: { 'GET /api/state': body | (req) => body, ... }.
 * loggedIn=false: /api/state risponde 401 finché non arriva un /api/login.
 */
export async function openApp(browser, url, api = {}, { loggedIn = true, lang = 'it', viewport = { width: 390, height: 844 }, welcome = false } = {}) {
  const page = await browser.newPage({ viewport });
  // Il benvenuto della prima apertura si prova a parte: qui risulta già visto.
  if (!welcome) await page.addInitScript(() => { try { localStorage.setItem('snipe.welcome', '1'); } catch {} });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let logged = loggedIn;
  const calls = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const key = `${req.method()} ${path}`;
    calls.push({ key, body: req.postData() });
    if (key === 'POST /api/login') { logged = true; return route.fulfill({ json: { ok: true } }); }
    if (!logged) return route.fulfill({ status: 401, json: { error: 'Accesso richiesto' } });
    let h = api[key];
    if (h === undefined && key === 'GET /api/state') h = baseState();
    if (h === undefined && key === 'GET /api/collection') h = COLLECTION;
    if (h === undefined && key === 'GET /api/expansions') h = [{ id: 3, code: 'm6', name: 'Storm Emeralda' }];
    if (h === undefined) h = {};
    const body = typeof h === 'function' ? await h(req) : h;
    return route.fulfill({ json: body });
  });
  await page.addInitScript((l) => { try { localStorage.setItem('snipe.lang', l); } catch {} }, lang);
  await page.goto(url);
  await page.waitForTimeout(600);
  return { page, errors, calls };
}
