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

test('collezione: tieni premuto per selezionare ed eliminare più carte', async () => {
  const { page, errors, calls } = await openApp(browser, srv.url);
  await page.waitForTimeout(400);
  const rows = await page.$$('#collList .ci');
  assert.ok(rows.length >= 2);
  const box = await rows[0].boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.ok(await page.isVisible('#collSelBar'));
  assert.equal(await page.textContent('#collSelBar .sb-n'), '1 selezionata');
  await (await page.$$('#collList .ci'))[1].click({ position: { x: 20, y: 20 } });
  assert.equal(await page.textContent('#collSelBar .sb-n'), '2 selezionate');
  await page.click('#collSelBar .sb-del');
  await page.click('.cs-dialog button:has-text("Elimina")');
  await page.waitForTimeout(400);
  const rm = calls.filter((c) => c.key === 'POST /api/collection/remove');
  assert.equal(rm.length, 1); // una sola richiesta per tutte le carte
  assert.equal(JSON.parse(rm[0].body).keys.length, 2);
  assert.ok(await page.isHidden('#collSelBar'), JSON.stringify(errors) + await page.evaluate(() => document.getElementById('collSelBar').outerHTML.slice(0, 200)));
  assert.deepEqual(errors, []);
});

test('collezione: scorri a sinistra per eliminare una carta', async () => {
  const { page, errors, calls } = await openApp(browser, srv.url);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const row = document.querySelector('#collList .ci');
    const r = row.getBoundingClientRect();
    const ev = (type, x) => row.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', clientX: x, clientY: r.top + 20 }));
    ev('pointerdown', r.right - 20); ev('pointermove', r.right - 60); ev('pointermove', r.right - 140); ev('pointerup', r.right - 140);
  });
  await page.waitForTimeout(300);
  assert.ok(await page.isVisible('.ci-wrap.swiped .ci-swipe-del'));
  await page.click('.ci-wrap.swiped .ci-swipe-del');
  await page.click('.cs-dialog button:has-text("Elimina")');
  await page.waitForTimeout(300);
  assert.equal(calls.filter((c) => c.key === 'POST /api/collection' && c.body.includes('"qty":0')).length, 1);
  assert.deepEqual(errors.filter((e) => !/known/.test(e)), []); // la risposta finta del server è vuota
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
  // "Ce l'ho" dallo scanner apre il pannello con la lingua letta (JP), dove si sceglie condizione e prezzo.
  await page.click("#scanList button >> text=Ce l'ho");
  await page.waitForTimeout(300);
  assert.ok(await page.isVisible('#ownDialog'));
  assert.equal(await page.textContent('#ownLangs .pill.on'), 'JP');
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

test('regole: controllo su ogni alert e filtri nel pannello', async () => {
  const rules = Array.from({ length: 6 }, (_, i) => ({ id: 'r' + i, expansionId: 1, expansionName: 'Set', blueprintId: 100 + i, cardName: 'Carta ' + i, enabled: true, priority: false, language: i % 2 ? 'ja' : 'en', minCondition: 'Near Mint', maxPriceCents: 1000, minPriceCents: 0, zero: '' }));
  const checks = Object.fromEntries(rules.map((r) => [r.id, { ts: Date.now() - 60e3, reads: [Date.now() - 60e3] }]));
  const { page, errors } = await openApp(browser, srv.url, { 'GET /api/state': baseState({ rules, checks, status: { lastScan: Date.now(), scans: 1, cycle: { ms: 240000 } } }) });
  await page.click('[data-tab=rules]');
  assert.match(await page.textContent('#ruleHealth'), /Tutti i 6 alert controllati regolarmente/);
  assert.equal(await page.locator('.chk .cdot.ok').count(), 6);
  await page.click('#ruleFilterBtn');
  await page.click('#ruleLang .chip-btn >> text=JP');
  await page.click('#ruleFilterClose');
  assert.match(await page.textContent('#ruleCount'), /3 alert su 6/);
  assert.equal(await page.locator('.af-chip').count(), 1);
  assert.deepEqual(errors, []);
  await page.close();
});
