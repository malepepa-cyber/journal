/**
 * E2E: Ausfüllhilfe für den Cookidoo-Editor (gegen nachgebaute Cookidoo-Seiten).
 * Prüft: App → „Ausfüllhilfe starten“ → Lesezeichen auf „Meine Kreationen“ (Rezept anlegen, Doppelt-Warnung)
 *        → Editor (weiter) → „Zutaten & Rezeptschritte“ (alles eintragen inkl. <cr-tts>).
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { LIST, EDIT, STEPS_PAGE } = require('./cookidoo-mock.cjs');

const PORT = 47613, TOKEN = 'fill', B = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(join(tmpdir(), 'pra-fill-'));
let failures = 0;
const check = async (name, fn) => { try { await fn(); console.log(`✓ ${name}`); } catch (e) { failures++; console.log(`✗ ${name}\n   ${e.message.split('\n').slice(0, 6).join('\n   ')}`); } };
const RECIPE = `Testsuppe mit Linsen
4 Portionen
Arbeitszeit 10 Min.
Zutaten
Für die Suppe:
1 Zwiebel, halbiert
20 g Öl
200 g rote Linsen
800 g Wasser
Zubereitung
1. Zwiebel in den Mixtopf geben und 5 Sek. | Stufe 5 zerkleinern.
2. Öl zugeben und 3 Min. | 120 °C | Stufe 1 andünsten.
3. Linsen und Wasser zugeben und 20 Min. | 100 °C | Linkslauf | Sanftrührstufe garen.
4. Knoblauch zugeben, 2 Sek. | Turbo zerkleinern.`;

(async () => {
  const server = spawn(process.env.PRA_E2E_BIN || process.execPath, process.env.PRA_E2E_BIN ? ['--no-browser'] : ['dist/server.cjs', '--no-browser'],
    { env: { ...process.env, PRA_DATA_DIR: tmp, PRA_PORT: String(PORT), PRA_TOKEN: TOKEN }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${B}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const browser = await browser_launch();
  async function browser_launch() { return chromium.launch(); }
  try {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await ctx.route('https://cookidoo.de/**', (r) => {
      const p = new URL(r.request().url()).pathname;
      const body = /\/edit\/ingredients-and-preparation-steps/.test(p) ? STEPS_PAGE : /\/edit\/?$/.test(p) ? EDIT : LIST(['Testsuppe mit Linsen', 'Anderes Rezept']);
      return r.fulfill({ contentType: 'text/html; charset=utf-8', body });
    });
    const app = await ctx.newPage();
    const errs = []; app.on('pageerror', (e) => errs.push(e.message));
    await app.goto(`${B}/#t=${TOKEN}`); await app.waitForSelector('text=Was kochen wir heute?');
    const js = decodeURIComponent((await (await app.request.get(`${B}/api/bookmarklet`, { headers: { 'x-pra-token': TOKEN } })).json()).code.slice(11));

    // Rezept anlegen
    await app.goto(`${B}/#/importieren`);
    await app.fill('textarea[aria-label=Rezepttext]', RECIPE);
    await app.click('text=Rezept erkennen'); await app.waitForSelector('text=Neues Rezept prüfen');
    await app.click('button:has-text("Speichern & zu Cookidoo")'); await app.waitForSelector('text=nach Cookidoo übertragen');

    let ck;
    await check('App: „Ausfüllhilfe starten“ öffnet Cookidoo', async () => {
      const pop = ctx.waitForEvent('page');
      await app.click('button:has-text("Ausfüllhilfe starten")');
      ck = await pop; await ck.waitForLoadState();
      ck.on('pageerror', (e) => errs.push('cookidoo: ' + e.message));
      assert.match(ck.url(), /created-recipes\/de-DE/);
    });
    await check('Meine Kreationen: Doppelt-Warnung + Rezept anlegen', async () => {
      await ck.evaluate(js);
      const h = ck.locator('#petras-rezepte-helfer');
      assert.match(await h.locator('main').textContent(), /schon ein Rezept mit diesem Namen/);
      await Promise.all([ck.waitForURL(/\/edit$/), h.locator('#create').click()]);
    });
    await check('Editor: Weiter zu „Zutaten & Rezeptschritte“ (Portionen angezeigt)', async () => {
      await ck.evaluate(js);
      const h = ck.locator('#petras-rezepte-helfer');
      assert.match(await h.locator('main').textContent(), /Portionen: 4/);
      await Promise.all([ck.waitForURL(/ingredients-and-preparation-steps/), h.locator('#next').click()]);
    });
    await check('Zutaten & Schritte werden eingetragen – mit Thermomix-Knöpfen', async () => {
      await ck.evaluate(js);
      const h = ck.locator('#petras-rezepte-helfer');
      assert.match(await h.locator('main').textContent(), /5 Zutaten.*4 Schritte.*3 Thermomix-Einstellungen/s);
      await h.locator('#fill').click();
      await h.locator('text=Fertig eingetragen').waitFor({ timeout: 20000 });
      const saved = await ck.evaluate(() => window.__saved);
      const ingr = saved.filter((x) => x.kind === 'ingredients').map((x) => x.html);
      const steps = saved.filter((x) => x.kind === 'steps').map((x) => x.html);
      assert.deepEqual(ingr, ['– Für die Suppe –', '1 Zwiebel, halbiert', '20 g Öl', '200 g rote Linsen', '800 g Wasser']);
      assert.equal(steps.length, 4);
      assert.match(steps[0], /<cr-tts speed="5" time="5">5 Sek\. \| Stufe 5<\/cr-tts>/);
      assert.match(steps[1], /<cr-tts speed="1" temperature="120" temperature-unit="C" time="180">/);
      assert.match(steps[2], /<cr-tts speed="soft" temperature="100" temperature-unit="C" time="1200" direction="CCW">/);
      assert.ok(!steps[3].includes('<cr-tts'), 'Turbo als Text');
      assert.match(await h.locator('main').textContent(), /Schritt 4: 2 Sek\. \| Turbo/);
      await ck.screenshot({ path: join(tmp, 'ausfuellhilfe.png') });
    });
    await check('Keine Fehler', async () => assert.deepEqual(errs, []));
    console.log(`   Bildschirmfoto: ${tmp}/ausfuellhilfe.png`);
  } finally { await browser.close(); server.kill(); }
  console.log(failures ? `\n${failures} Test(s) fehlgeschlagen` : '\nAlle Ausfüllhilfe-Tests bestanden');
  process.exit(failures ? 1 : 0);
})();
