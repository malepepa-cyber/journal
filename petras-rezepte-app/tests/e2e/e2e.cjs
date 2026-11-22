/**
 * Ende-zu-Ende-Test im echten Browser (Playwright/Chromium).
 *   npm run build && npm run test:e2e
 * Startet den gebauten Dienst mit leerem Datenordner, erzeugt Test-PDFs (mehrseitig, Tabelle, Scan)
 * und prüft Import → Editor → Speichern → Bibliothek → Assistent → Lesezeichen (Cookidoo nachgebaut).
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');

const PORT = 47611, TOKEN = 'e2e', B = `http://127.0.0.1:${PORT}`;
const tmp = mkdtempSync(join(tmpdir(), 'pra-e2e-'));
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); } catch (e) { failures++; console.log(`✗ ${name}\n   ${e.message.split('\n').slice(0, 4).join('\n   ')}`); }
}

const MULTI = `<style>body{font:15px Arial;margin:40px} li{margin:10px 0}</style><h1>Großer Gemüseeintopf</h1><p>6 Portionen</p><p>Arbeitszeit 25 Min.</p>
<h2>Zutaten</h2><ul>${['2 Zwiebeln, halbiert', '2 Knoblauchzehen', '30 g Olivenöl', '3 Karotten, in Scheiben', '2 Stangen Lauch, in Ringen', '500 g Kartoffeln, gewürfelt', '1 kg Gemüsebrühe', '200 g grüne Bohnen', '1 TL Majoran', 'Salz und Pfeffer'].map((x) => `<li>${x}</li>`).join('')}</ul>
<h2>Zubereitung</h2><ol>${['Zwiebeln und Knoblauch in den Mixtopf geben, 5 Sek./Stufe 5 zerkleinern.', 'Öl zugeben und 3 Min./120°C/Stufe 1 dünsten.',
  ...Array.from({ length: 10 }, (_, i) => `Zwischenschritt ${i + 1}: Gemüse vorbereiten und bereitstellen, dabei sorgfältig waschen, schälen und gleichmäßig schneiden, damit alles gleichzeitig gar wird.`),
  'Karotten, Lauch und Kartoffeln zugeben und 5 Min./120°C/Linkslauf/Stufe 1 andünsten.', 'Brühe und Bohnen zugeben und 25 Min./100°C/Linkslauf/Sanftrührstufe garen.', 'Mit Majoran, Salz und Pfeffer abschmecken.'].map((x) => `<li>${x}</li>`).join('')}</ol>`;
const TABLE = `<style>body{font:15px Arial;margin:40px} td{padding:4px 14px;border-bottom:1px solid #ccc}</style><h1>Pfannkuchenteig</h1><p>4 Portionen</p>
<h2>Zutaten</h2><table><tr><td>250 g</td><td>Mehl</td></tr><tr><td>500 ml</td><td>Milch</td></tr><tr><td>3</td><td>Eier</td></tr><tr><td>1 Prise</td><td>Salz</td></tr><tr><td>30 g</td><td>Butter, geschmolzen</td></tr></table>
<img src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120" fill="#e9c"/></svg>')}">
<h2>Zubereitung</h2><ol><li>Alle Zutaten in den Mixtopf geben und 20 Sek./Stufe 5 verrühren.</li><li>Teig 15 Minuten quellen lassen.</li><li>In einer Pfanne portionsweise ausbacken.</li></ol>`;
const SCAN = `<body style="font:22px Georgia,serif;padding:40px;background:#fbfaf6"><h1>Kürbissuppe</h1><p>4 Portionen</p><h2>Zutaten</h2><p>1 Zwiebel<br>800 g Hokkaido-Kürbis<br>20 g Butter<br>600 g Wasser<br>200 g Kokosmilch</p>
<h2>Zubereitung</h2><p>1. Zwiebel in den Mixtopf geben, 5 Sek./Stufe 5 zerkleinern.<br>2. Butter zugeben, 3 Min./120°C/Stufe 1 dünsten.<br>3. Kürbis und Wasser zugeben, 20 Min./100°C/Stufe 1 garen.<br>4. Kokosmilch zugeben, 1 Min./Stufe 8 pürieren.</p></body>`;

(async () => {
  const server = spawn(process.execPath, ['dist/server.cjs', '--no-browser'], { env: { ...process.env, PRA_DATA_DIR: tmp, PRA_PORT: String(PORT), PRA_TOKEN: TOKEN }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${B}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const browser = await chromium.launch();
  try {
    // Test-PDFs erzeugen
    const gen = await browser.newPage();
    const pdf = async (html, file, opts = {}) => { await gen.setContent(html); await gen.pdf({ path: join(tmp, file), format: 'A4', margin: { top: '50px', bottom: '50px' }, ...opts }); };
    await pdf(MULTI, 'mehrseitig.pdf', { displayHeaderFooter: true, headerTemplate: '<div style="font-size:8px;margin-left:20px">22.11.26, 10:15 Großer Gemüseeintopf | Zaubertopf Club</div>', footerTemplate: '<div style="font-size:8px;margin-left:20px">https://www.zaubertopf-club.de/rezept/eintopf.html <span class="pageNumber"></span>/<span class="totalPages"></span></div>' });
    await pdf(TABLE, 'tabelle.pdf');
    await gen.setViewportSize({ width: 900, height: 1100 }); await gen.setContent(SCAN);
    const png = await gen.screenshot({ fullPage: true });
    await pdf(`<body style="margin:0"><img src="data:image/png;base64,${png.toString('base64')}" style="width:100%"></body>`, 'scan.pdf');

    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto(`${B}/#t=${TOKEN}`); await p.waitForSelector('text=Was kochen wir heute?');

    const importFile = async (file) => {
      await p.goto(`${B}/#/importieren`); await p.waitForSelector('text=Datei hierher ziehen');
      await p.setInputFiles('input[type=file]', join(tmp, file));
      await p.waitForSelector('text=Neues Rezept prüfen', { timeout: 120000 }); await p.waitForTimeout(300);
      return {
        title: await p.inputValue('input[aria-label=Rezeptname]'),
        ings: await p.$$eval('input[aria-label=Zutat]', (e) => e.map((x) => x.value).filter(Boolean)),
        steps: await p.$$eval('ol li textarea', (e) => e.map((x) => x.value)),
        pills: await p.$$eval('ol li button.tm-pill', (e) => e.length),
      };
    };
    const discard = async () => { await p.click('button:has-text("Verwerfen")'); await p.click('dialog button:has-text("Verwerfen")'); };

    await check('Mehrseitige PDF mit Kopf-/Fußzeilen', async () => {
      const r = await importFile('mehrseitig.pdf');
      assert.equal(r.title, 'Großer Gemüseeintopf');
      assert.equal(r.ings.length, 10);
      assert.equal(r.steps.length, 15, `Schritte: ${r.steps.length}\n${r.steps.map((s, i) => `${i + 1}: ${s.slice(0, 70)}`).join('\n')}`);
      assert.equal(r.pills, 4);
      assert.ok(!r.steps.some((s) => /zaubertopf-club|Seite|\d+\/\d+$/.test(s)), 'keine Kopf-/Fußzeilen in Schritten');
      await discard();
    });
    await check('PDF mit Tabelle und Bild', async () => {
      const r = await importFile('tabelle.pdf');
      assert.equal(r.title, 'Pfannkuchenteig');
      assert.deepEqual(r.ings, ['Mehl', 'Milch', 'Eier', 'Salz', 'Butter']);
      assert.equal(r.steps.length, 3); assert.equal(r.pills, 1);
      await discard();
    });
    await check('Gescannte PDF (OCR)', async () => {
      const r = await importFile('scan.pdf');
      assert.equal(r.title, 'Kürbissuppe');
      assert.ok(r.ings.length >= 4, `Zutaten: ${r.ings.join(', ')}`);
      assert.equal(r.steps.length, 4); assert.ok(r.pills >= 3, `TM: ${r.pills}`);
      await discard();
    });
    await check('Text → Vorschlag bestätigen → Speichern → Bibliothek → Favorit', async () => {
      await p.goto(`${B}/#/importieren`);
      await p.fill('textarea[aria-label=Rezepttext]', 'Vanillepudding\n4 Portionen\nZutaten\n500 ml Milch\n40 g Speisestärke\n60 g Zucker\n1 Pck. Vanillezucker\nZubereitung\n1. Alle Zutaten in den Mixtopf geben.\n2. Unter Rühren aufkochen.\n3. In Schälchen füllen und abkühlen lassen.');
      await p.click('text=Rezept erkennen'); await p.waitForSelector('text=Neues Rezept prüfen');
      await p.locator('ol li button:has-text("Übernehmen")').first().click();
      assert.match(await p.locator('ol li textarea').nth(1).inputValue(), /100°C\/Linkslauf\/Stufe 1/);
      await p.click('button:has-text("Speichern") >> nth=0'); await p.waitForURL(/rezept\/\d+/);
      await p.goto(`${B}/#/rezepte`); await p.waitForSelector('text=Vanillepudding');
      assert.equal(await p.locator('article').count(), 1);
      await p.click('article button[aria-label="Als Favorit merken"]');
      await p.goto(`${B}/#/favoriten`); await p.waitForSelector('article >> text=Vanillepudding');
      await p.fill('input[aria-label="Rezepte suchen"]', 'speisestarke').catch(() => {});
    });
    await check('Assistent: alle Schritte bis „übertragen“', async () => {
      await p.goto(`${B}/#/cookidoo`); await p.click('text=Vanillepudding');
      await p.click('text=Cookidoo ist schon offen');
      for (let i = 0; i < 3; i++) await p.click('button:has-text("Weiter")');
      for (let i = 0; i < 2; i++) await p.click('button:has-text("Nächster Schritt")');
      await p.click('button:has-text("Alle Schritte erledigt")');
      await p.click('button:has-text("Als übertragen markieren")');
      await p.waitForSelector('text=Als „In Cookidoo“ markiert');
    });
    await check('Keine Fehler in der Browser-Konsole', async () => assert.deepEqual(errs, []));
  } finally {
    await browser.close(); server.kill();
  }
  console.log(failures ? `\n${failures} Test(s) fehlgeschlagen` : '\nAlle E2E-Tests bestanden');
  process.exit(failures ? 1 : 0);
})();
