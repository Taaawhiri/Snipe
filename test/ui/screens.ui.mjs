import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, baseState } from './helpers.mjs';

let srv;
let browser;
before(async () => { srv = await startServer(); browser = await launch(); });
after(async () => { await browser.close(); srv.server.close(); });

test('accesso: piani e modulo, poi l\'app', async () => {
  const { page, errors } = await openApp(browser, srv.url, {}, { loggedIn: false });
  assert.ok(await page.isVisible('#login'));
  assert.ok((await page.textContent('#loginPlans')).includes('Sniper'));
  await page.fill('#keyInput', 'x'.repeat(30));
  await page.click('#loginForm button');
  await page.waitForTimeout(600);
  assert.ok(await page.isVisible('#app'));
  assert.deepEqual(errors, []);
});

test('collezione: valore, guadagno per carta e filtri', async () => {
  const { page, errors, calls } = await openApp(browser, srv.url);
  await page.waitForTimeout(400);
  assert.ok(await page.isVisible('#collView'));
  const hero = await page.textContent('#collHero');
  assert.ok(hero.includes('169,00'), hero);
  const pills = await page.$$eval('.gain-pill', (els) => els.map((e) => e.textContent));
  assert.ok(pills.some((t) => t.startsWith('+47,00')), pills.join('|'));
  assert.ok(pills.some((t) => t.startsWith('−9,00')), pills.join('|'));
  await page.click('label:has(#collZero)');
  await page.waitForTimeout(300);
  assert.ok(calls.some((c) => c.key === 'POST /api/settings' && c.body.includes('"collZero":true')));
  assert.deepEqual(errors, []);
});

test('avvisi non visti: si apre su Avvisi con il contatore', async () => {
  const alerts = [{ id: 'a1', ts: Date.now(), name: 'Mew ex', expansion: '151', cents: 400, refCents: 900, discount: 0.55, currency: 'EUR', url: 'https://www.cardtrader.com/cards/1' }];
  const { page, errors } = await openApp(browser, srv.url, { 'GET /api/state': baseState({ alerts }) });
  assert.ok(await page.isVisible('#alertsView'));
  assert.equal(await page.textContent('#alertsLabel'), 'Avvisi1');
  assert.ok((await page.textContent('#alertList')).includes('Mew ex'));
  assert.deepEqual(errors, []);
});

test('scanner: risultato con lingua e candidati', async () => {
  const { page, errors } = await openApp(browser, srv.url, {
    'POST /api/scan': { engine: 'workers-ai', used: 1, limit: 200, scan: { name: 'Magikarp', number: '165', total: '103', language: 'jp' }, candidates: [{ score: 17, id: 9, name: 'Magikarp', version: '165/103', expansionId: 3, expName: '30th Celebration JP' }] },
  });
  // Una foto minuscola valida (PNG 1x1).
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#scanInput', { name: 'c.png', mimeType: 'image/png', buffer: png });
  await page.waitForTimeout(800);
  const read = await page.textContent('#scanRead');
  assert.ok(read.includes('Magikarp') && read.includes('Giapponese') && read.includes('165/103'), read);
  assert.ok((await page.textContent('#scanList')).includes('30th Celebration JP'));
  assert.deepEqual(errors, []);
});

test('opzioni: riquadri del piano con barre, sezione utenti nascosta a chi non è proprietario', async () => {
  const { page, errors } = await openApp(browser, srv.url);
  await page.click('.tabs button[data-tab=settings]');
  await page.waitForTimeout(300);
  assert.ok((await page.$$('#planUsage .kv-item')).length >= 5);
  assert.ok((await page.$$('#planUsage .meter')).length >= 2);
  assert.equal(await page.isVisible('#adminPanel'), false);
  assert.deepEqual(errors, []);
});

test('inglese: l\'interfaccia è tradotta', async () => {
  const { page, errors } = await openApp(browser, srv.url, {}, { lang: 'en' });
  assert.equal((await page.textContent('.tabs button[data-tab=alerts] span')).trim(), 'Collection');
  assert.ok((await page.textContent('#collHero')).includes('Current value'));
  assert.deepEqual(errors, []);
});

test('benvenuto: alla prima apertura senza alert compaiono i tre passi', async () => {
  const { page, errors } = await openApp(browser, srv.url, { 'GET /api/state': baseState({ rules: [] }) }, { welcome: true });
  await page.waitForSelector('.wl');
  assert.ok((await page.textContent('.wl')).includes('Crea il primo alert'));
  await page.click('.wl .btn.primary');
  assert.equal(await page.$('.wl'), null);
  assert.deepEqual(errors, []);
  await page.close();
});

test('opzioni: nessuno scorrimento orizzontale su telefono', async () => {
  const { page } = await openApp(browser, srv.url, { 'GET /api/state': baseState() });
  await page.click('[data-tab=settings]');
  await page.waitForTimeout(300);
  const [w, sw] = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollWidth]);
  assert.equal(sw, w);
  await page.close();
});

test('importa collezione: riepilogo con trovate, da scegliere e non trovate', async () => {
  const c = (id, v) => ({ id, name: 'Umbreon ex', version: `SIR | ${v}`, image: null, expansionId: 5, expName: '30th Deck' });
  const rows = [
    { line: 2, name: 'Umbreon ex', number: '044', total: '040', set: '30th', lang: 'jp', cond: 'Near Mint', qty: 1, status: 'found', candidates: [c(1, '044/040')] },
    { line: 3, name: 'Umbreon', number: '', total: '', set: '', lang: '', cond: 'Near Mint', qty: 2, status: 'choose', candidates: [c(2, '010/040'), c(3, '044/040')] },
    { line: 4, name: 'Pippo', number: '', total: '', set: '', lang: '', cond: 'Near Mint', qty: 1, status: 'none', candidates: [] },
  ];
  let sent = null;
  const { page, errors } = await openApp(browser, srv.url, {
    'GET /api/state': baseState(),
    'POST /api/collection/match': { rows },
    'POST /api/collection/import': (req) => { sent = JSON.parse(req.postData()); return { added: 2, merged: 0, limited: 0, limit: 500 }; },
  });
  await page.click('[data-tab=settings]');
  await page.setInputFiles('#importCollFile', { name: 'c.csv', mimeType: 'text/csv', buffer: Buffer.from('Carta\nUmbreon ex\n') });
  await page.waitForSelector('.im');
  assert.match(await page.textContent('.im .btn.primary'), /Importa 1 carta/);
  await page.click('.im-row.choose .im-cand >> nth=1');
  assert.match(await page.textContent('.im .btn.primary'), /Importa 2 carte/);
  await page.click('.im .btn.primary');
  await page.waitForSelector('.cs-dialog:not(.im)');
  assert.deepEqual(sent.items.map((x) => x.bp), [1, 3]);
  assert.deepEqual(errors, []);
  await page.close();
});
