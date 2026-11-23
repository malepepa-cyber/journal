/**
 * Oberflächentest der Synchronisierung (PC + Notebook) gegen die Firebase-Emulatoren.
 * Start: FIREBASE_BIN=… node build/sync-test.mjs --ui   (oder innerhalb von „firebase emulators:exec“)
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');

const PROJECT = 'demo-pra';
const shots = mkdtempSync(join(tmpdir(), 'pra-sync-ui-'));
let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`✓ ${name}`); } catch (e) { failures++; console.log(`✗ ${name}\n   ${String(e.message).split('\n').slice(0, 4).join('\n   ')}`); }
}

function device(name, port) {
  const token = `t-${name}`;
  const proc = spawn(process.execPath, ['dist/server.cjs', '--no-browser'], {
    env: { ...process.env, PRA_DATA_DIR: mkdtempSync(join(tmpdir(), `pra-ui-${name}-`)), PRA_PORT: String(port), PRA_TOKEN: token, PRA_ALLOW_EMULATOR: '1' }, stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const api = async (path, method = 'GET', json) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-pra-token': token }, body: json === undefined ? undefined : JSON.stringify(json) });
    return r.json();
  };
  return { name, proc, base, token, api };
}

(async () => {
  await fetch(`http://127.0.0.1:8085/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  const pc = device('pc', 47621), nb = device('notebook', 47622);
  for (const d of [pc, nb]) for (let i = 0; i < 100; i++) { try { if ((await fetch(`${d.base}/api/health`)).ok) break; } catch { /* warten */ } await new Promise((r) => setTimeout(r, 100)); }
  const browser = await chromium.launch();
  const open = async (d) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const p = await ctx.newPage();
    p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && p.errs.push(m.text()));
    await p.goto(`${d.base}/#t=${d.token}`); await p.waitForSelector('text=Was kochen wir heute?');
    return p;
  };
  try {
    const a = await open(pc), b = await open(nb);

    await check('Ohne Einrichtung: „Nur auf diesem Gerät“', async () => {
      await a.waitForSelector('[data-testid=sync-badge] >> text=Nur auf diesem Gerät');
    });

    await check('PC: Konto erstellen über die Einstellungen → „Synchronisiert“', async () => {
      // Projektdaten der Testumgebung (in echt: Web-API-Schlüssel + Projekt-ID aus der Firebase-Konsole)
      await pc.api('/api/sync/config', 'PUT', { apiKey: 'demo-api-key-for-tests-1234', projectId: PROJECT, emulator: { auth: '127.0.0.1:9099', firestore: '127.0.0.1:8085' } });
      await pc.api('/api/recipes', 'POST', { title: 'Zucchini-Suppe', category: 'Suppen', ingredients: [], steps: [{ id: 's1', text: 'Alles 20 Sek./Stufe 5 zerkleinern.', accessories: [], restMinutes: null, suggestions: [] }], cookidoo: { status: 'offen' }, source: { type: 'manual', name: '' } });
      await a.goto(`${pc.base}/#/einstellungen`);
      await a.click('button:has-text("Konto erstellen")');
      await a.fill('input[type=email]', 'petra@example.com');
      await a.fill('input[type=password]', 'Geheim-Rezepte-1');
      await a.click('form button:has-text("Konto erstellen")');
      await a.waitForSelector('[data-testid=sync-badge] >> text=Synchronisiert', { timeout: 15000 });
      await a.waitForSelector('text=Verbundene Geräte');
      await a.screenshot({ path: join(shots, '1-pc-angemeldet.png'), fullPage: true });
    });

    let code = '';
    await check('PC: Verbindungscode für das Notebook', async () => {
      await a.click('summary:has-text("Weiteres Gerät verbinden")');
      code = await a.locator('details code').innerText();
      assert.match(code, /^PRA1-/);
    });

    await check('Notebook: Code eingeben, anmelden → Rezept vom PC ist da', async () => {
      await b.goto(`${nb.base}/#/einstellungen`);
      await b.fill('input[aria-label=Verbindungscode]', code);
      await b.click('button:has-text("Verbinden")');
      await b.fill('input[type=email]', 'petra@example.com');
      await b.fill('input[type=password]', 'Geheim-Rezepte-1');
      await b.click('form button:has-text("Anmelden")');
      await b.waitForSelector('[data-testid=sync-badge] >> text=Synchronisiert', { timeout: 15000 });
      await b.goto(`${nb.base}/#/rezepte`);
      await b.waitForSelector('article >> text=Zucchini-Suppe');
      await b.goto(`${nb.base}/#/einstellungen`); await b.waitForSelector('text=Verbundene Geräte');
      await b.waitForSelector('li:has-text("(dieses Gerät)")');
      assert.equal(await b.locator('li:has-text("zuletzt aktiv")').count(), 2, 'zwei Geräte');
      await b.screenshot({ path: join(shots, '1b-notebook-geraete.png'), fullPage: true });
    });

    await check('Gleichzeitige Änderung → Konflikt-Kopie anzeigen und behalten', async () => {
      const [ra] = await pc.api('/api/recipes'); const [rb] = await nb.api('/api/recipes');
      const fa = await pc.api(`/api/recipes/${ra.id}`); const fb = await nb.api(`/api/recipes/${rb.id}`);
      await pc.api(`/api/recipes/${fa.id}`, 'PUT', { ...fa, notes: 'PC-Notiz' });
      await nb.api(`/api/recipes/${fb.id}`, 'PUT', { ...fb, notes: 'Notebook-Notiz' });
      await pc.api('/api/sync/now', 'POST');
      await b.click('[data-testid=sync-badge] >> button:has-text("Jetzt synchronisieren")');
      await b.waitForSelector('text=1 Konflikt-Kopie prüfen', { timeout: 15000 });
      await b.click('text=1 Konflikt-Kopie prüfen');
      await b.waitForSelector('text=Es werden nur Konflikt-Kopien angezeigt');
      await b.click('article >> text=Konflikt-Kopie');
      await b.waitForSelector('text=Das ist die Fassung von');
      await b.screenshot({ path: join(shots, '2-konflikt.png'), fullPage: true });
      await b.click('button:has-text("Diese Fassung behalten")');
      await b.click('dialog button:has-text("Behalten")');
      await b.waitForSelector('text=Fassung übernommen');
      await b.waitForFunction(() => !document.body.innerText.includes('Das ist die Fassung von'));
      assert.equal(await b.inputValue('input[aria-label=Rezeptname]'), 'Zucchini-Suppe');
    });

    await check('Versionsverlauf: frühere Fassung wiederherstellen', async () => {
      await b.click('button:has-text("Versionen")');
      await b.waitForSelector('dialog >> text=Versionsverlauf');
      assert.ok(await b.locator('dialog li').count() >= 2);
      await b.screenshot({ path: join(shots, '3-versionen.png') });
      await b.click('dialog li >> nth=0 >> button:has-text("Wiederherstellen")');
      await b.waitForSelector('text=Version wiederhergestellt');
    });

    await check('PC übernimmt die Entscheidung automatisch', async () => {
      await nb.api('/api/sync/now', 'POST'); await pc.api('/api/sync/now', 'POST');
      const list = await pc.api('/api/recipes');
      assert.equal(list.filter((r) => r.conflict).length, 0);
    });

    await check('Keine Fehler in der Browser-Konsole', async () => assert.deepEqual([...a.errs, ...b.errs], []));
  } finally {
    await browser.close(); pc.proc.kill(); nb.proc.kill();
  }
  console.log(`   Bildschirmfotos: ${shots}`);
  console.log(failures ? `\n${failures} Test(s) fehlgeschlagen` : '\nAlle Sync-Oberflächentests bestanden');
  process.exit(failures ? 1 : 0);
})();
