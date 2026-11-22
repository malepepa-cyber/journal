/**
 * E2E: „Link einfügen“ + Lesezeichen (Club-Seite nachgebaut) + Import gespeicherter HTML-Seite.
 * Nutzt die eigene Testseite tests/fixtures/zaubertopf-aufbau.html; falls vorhanden zusätzlich
 * die lokal gespeicherten Club-Seiten aus tests/fixtures/privat (werden nie committet).
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');

const PORT = 47612, TOKEN = 'lnk', B = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(join(tmpdir(), 'pra-link-'));
const fx = (f) => join(__dirname, '..', 'fixtures', f);
const PRIV = existsSync(fx('privat/zt-gyros.html'));
const MAIN = readFileSync(PRIV ? fx('privat/zt-gyros.html') : fx('zaubertopf-aufbau.html'), 'utf8');
const SUB = readFileSync(fx('zaubertopf-aufbau.html'), 'utf8').replace(/Test-Lin&shy;sen&shy;cur&shy;ry mit Ko&shy;kos/, 'Selbst gemachter Frischkäse');
let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failures++; console.log(`✗ ${name}\n   ${e.message.split('\n').slice(0, 6).join('\n   ')}`); } };

(async () => {
  const server = spawn(process.env.PRA_E2E_BIN || process.execPath, process.env.PRA_E2E_BIN ? ['--no-browser'] : ['dist/server.cjs', '--no-browser'],
    { env: { ...process.env, PRA_DATA_DIR: tmp, PRA_PORT: String(PORT), PRA_TOKEN: TOKEN }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${B}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    // Alles außer App und (nachgebauter) Club-Seite blockieren – gespeicherte Seiten laden sonst Videos/Werbung nach
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|www\.zaubertopf-club\.de)/, (r) => r.abort());
    await ctx.route('https://www.zaubertopf-club.de/**', (r) => {
      const u = new URL(r.request().url());
      if (!/^\/rezept\/[^/]+\.html$/.test(u.pathname)) return r.fulfill({ status: 204, body: '' });
      // Skripte der gespeicherten Seite entfernen (die echte Seite rendert denselben Aufbau)
      const strip = (h) => h.replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, '').replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
      return r.fulfill({ contentType: 'text/html; charset=utf-8', body: strip(/frischkaese|gemuesepaste/.test(u.pathname) ? SUB : MAIN) });
    });
    const app = await ctx.newPage();
    const errs = []; app.on('pageerror', (e) => errs.push(e.message)); app.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await app.goto(`${B}/#t=${TOKEN}`); await app.waitForSelector('text=Was kochen wir heute?');
    const js = decodeURIComponent((await (await app.request.get(`${B}/api/bookmarklet`, { headers: { 'x-pra-token': TOKEN } })).json()).code.slice(11));

    await check('Link einfügen → Club erkannt → Chrome-Weg angezeigt', async () => {
      await app.goto(`${B}/#/importieren`);
      await app.fill('input[aria-label="Link zur Rezeptseite"]', 'https://www.zaubertopf-club.de/rezept/gyros-feierabendblech-thermomix.html');
      await app.click('button:has-text("Rezept holen")');
      await app.waitForSelector('text=nur angemeldeten Mitgliedern');
    });
    await check('Seite öffnen → Lesezeichen → Teilrezept mitholen → automatische Übernahme', async () => {
      const pop = ctx.waitForEvent('page');
      await app.click('button:has-text("Seite in Chrome öffnen")');
      const club = await pop; await club.waitForLoadState('domcontentloaded');
      await club.evaluate(js);
      const h = club.locator('#petras-rezepte-helfer');
      const info = (await h.locator('main').textContent()).replace(/\s+/g, ' ');
      assert.match(info, /Gelesen aus: ZauberTopf Club/);
      const boxes = h.locator('input[type=checkbox]');
      assert.ok(await boxes.count() >= 1, 'Teilrezept angeboten');
      await boxes.first().check();
      await h.locator('#go').click();
      await h.locator('text=Kopiert!').waitFor();
      await club.screenshot({ path: join(tmp, 'lesezeichen.png') });
      await app.bringToFront(); await app.evaluate(() => window.dispatchEvent(new Event('focus')));
      await app.waitForSelector('text=Neues Rezept prüfen', { timeout: 10000 });
      const title = await app.inputValue('input[aria-label=Rezeptname]');
      assert.equal(title, PRIV ? 'Schnelles Gyros-Feierabendblech' : 'Test-Linsencurry mit Kokos');
      const pills = await app.$$eval('ol li button.tm-pill', (e) => e.length);
      assert.ok(pills >= 2, `TM-Knöpfe: ${pills}`);
      const groups = await app.$$eval('p.uppercase', (e) => e.map((x) => x.textContent));
      assert.ok(groups.length >= 2, `Gruppen: ${groups}`);
      await app.screenshot({ path: join(tmp, 'editor.png'), fullPage: true });
      const lib = await (await app.request.get(`${B}/api/recipes`, { headers: { 'x-pra-token': TOKEN } })).json();
      assert.ok(lib.some((r) => r.title === 'Selbst gemachter Frischkäse' || r.title.includes('Linsencurry')), `Teilrezept gespeichert: ${lib.map((r) => r.title)}`);
      await app.click('button:has-text("Verwerfen")'); await app.click('dialog button:has-text("Verwerfen")');
    });
    await check('Gespeicherte Webseite (.html) importieren', async () => {
      await app.goto(`${B}/#/importieren`);
      await app.setInputFiles('input[type=file]', fx('zaubertopf-aufbau.html'));
      await app.waitForSelector('text=Neues Rezept prüfen');
      assert.equal(await app.inputValue('input[aria-label=Rezeptname]'), 'Test-Linsencurry mit Kokos');
      assert.equal(await app.$$eval('ol li button.tm-pill', (e) => e.length), 4);
      assert.match(await app.locator('text=Bitte kurz prüfen').locator('..').textContent(), /Hinweis|Thermomix/);
      await app.click('button:has-text("Verwerfen")'); await app.click('dialog button:has-text("Verwerfen")');
    });
    for (const f of ['zt-rouladen.html', 'zt-bandnudeln.html']) {
      if (!existsSync(fx(`privat/${f}`))) continue;
      await check(`Gespeicherte Club-Seite ${f}`, async () => {
        await app.goto(`${B}/#/importieren`);
        await app.setInputFiles('input[type=file]', fx(`privat/${f}`));
        await app.waitForSelector('text=Neues Rezept prüfen');
        const pills = await app.$$eval('ol li button.tm-pill', (e) => e.map((x) => x.textContent));
        console.log(`   ${await app.inputValue('input[aria-label=Rezeptname]')}: ${pills.join(' | ')}`);
        assert.ok(pills.length >= 3);
        await app.click('button:has-text("Verwerfen")'); await app.click('dialog button:has-text("Verwerfen")');
      });
    }
    await check('Öffentlicher Link, der nicht erreichbar ist → Hinweis statt Fehler', async () => {
      await app.goto(`${B}/#/importieren`);
      await app.fill('input[aria-label="Link zur Rezeptseite"]', 'https://rezepte.invalid/x');
      await app.click('button:has-text("Rezept holen")');
      await app.waitForSelector('text=über Chrome klappt es trotzdem');
    });
    await check('Keine Fehler in der Browser-Konsole', async () => assert.deepEqual(errs.filter((e) => !/Failed to load resource/.test(e)), []));
    console.log(`   Bildschirmfotos: ${tmp}`);
  } finally { await browser.close(); server.kill(); }
  console.log(failures ? `\n${failures} Test(s) fehlgeschlagen` : '\nAlle Link-Import-Tests bestanden');
  process.exit(failures ? 1 : 0);
})();
