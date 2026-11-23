/**
 * Synchronisierung PC ↔ Notebook – Ende-zu-Ende-Test gegen die offiziellen Firebase-Emulatoren.
 * Zwei echte App-Dienste („PC“ und „Notebook“) mit getrennten Datenbanken; das Notebook hängt hinter
 * einer schaltbaren Verbindung, um „offline“ zu simulieren.
 *
 * Start:  npm run test:sync   (braucht Java 21 und firebase-tools; siehe docs/ARCHITEKTUR.md)
 */
import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AUTH = '127.0.0.1:9099', FS = '127.0.0.1:8085', PROJECT = 'demo-pra';
const API_KEY = 'demo-api-key-for-tests-1234';

// ---------- schaltbare Verbindung (simuliert offline) ----------
class Switch {
  online = true; server: Server; sockets = new Set<Socket>();
  constructor(public port: number, target: number) {
    this.server = createServer((c) => {
      if (!this.online) { c.destroy(); return; }
      const t = connect(target, '127.0.0.1');
      this.sockets.add(c); this.sockets.add(t);
      c.pipe(t); t.pipe(c);
      const end = () => { c.destroy(); t.destroy(); this.sockets.delete(c); this.sockets.delete(t); };
      c.on('error', end); t.on('error', end); c.on('close', end); t.on('close', end);
    }).listen(port, '127.0.0.1');
  }
  set(on: boolean) { this.online = on; if (!on) for (const s of this.sockets) s.destroy(); }
}

// ---------- App-Dienst ----------
class Device {
  proc!: ChildProcess; base: string; token = `tok-${Math.random().toString(36).slice(2)}`;
  constructor(public name: string, public port: number) { this.base = `http://127.0.0.1:${port}`; }
  async start() {
    this.proc = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts', '--no-browser'], {
      env: { ...process.env, PRA_DATA_DIR: mkdtempSync(join(tmpdir(), `pra-sync-${this.name}-`)), PRA_PORT: String(this.port), PRA_TOKEN: this.token,
        PRA_WEB_DIR: join(process.cwd(), 'tests', 'fixtures-web'), PRA_ALLOW_EMULATOR: '1', PRA_DEFAULT_PROFILE: 'Petra' },
      stdio: 'pipe',
    });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${this.base}/api/health`)).ok) return; } catch { /* noch nicht da */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${this.name} startet nicht`);
  }
  async api(path: string, method = 'GET', json?: unknown): Promise<any> {
    const r = await fetch(this.base + path, { method, headers: { 'Content-Type': 'application/json', 'x-pra-token': this.token }, body: json === undefined ? undefined : JSON.stringify(json) });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(`${this.name} ${method} ${path}: ${r.status} ${body?.error}`), { status: r.status });
    return body;
  }
  sync = () => this.api('/api/sync/now', 'POST');
  list = () => this.api('/api/recipes?sort=name') as Promise<{ id: number; title: string; conflict?: boolean; photo: string | null }[]>;
  byTitle = async (t: string) => { const r = (await this.list()).find((x) => x.title === t); assert.ok(r, `${this.name}: „${t}“ fehlt`); return this.api(`/api/recipes/${r.id}`); };
}

const pc = new Device('pc', 47511), nb = new Device('notebook', 47512);
const authSw = new Switch(19099, 9099), fsSw = new Switch(18085, 8085);
const offline = (on: boolean) => { authSw.set(!on); fsSw.set(!on); };

const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const recipe = (title: string, extra: object = {}) => ({
  id: null, profileId: null, title, description: '', category: 'Suppen', difficulty: null, servings: 4, servingsUnit: 'Portionen',
  prepTime: 10, cookTime: 20, restTime: null, totalTime: 30, photo: null, notes: '', favorite: false,
  ingredients: [{ id: 'i1', amount: 500, amountMax: null, unit: 'g', name: 'Kartoffeln', note: '', group: '' }],
  steps: [{ id: 's1', text: 'Kartoffeln in den Mixtopf geben und 5 Sek./Stufe 5 zerkleinern.', accessories: [], restMinutes: null, suggestions: [] }],
  source: { type: 'manual', name: '' }, cookidoo: { status: 'offen' }, ...extra,
});

async function uidOf(): Promise<string> {
  const r = await (await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'petra@example.com', password: 'Geheim-Rezepte-1', returnSecureToken: true }),
  })).json() as { localId: string };
  return r.localId;
}

before(async () => {
  try { await fetch(`http://${FS}/`); } catch { throw new Error('Firebase-Emulatoren laufen nicht (npm run test:sync verwenden).'); }
  await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  await Promise.all([pc.start(), nb.start()]);
});
after(() => { pc.proc?.kill(); nb.proc?.kill(); authSw.server.close(); fsSw.server.close(); });

test('1. PC: Projekt einrichten, Konto registrieren, Rezept mit Bild hochladen', async () => {
  let st = await pc.api('/api/sync/status');
  assert.equal(st.state, 'aus');
  st = await pc.api('/api/sync/config', 'PUT', { apiKey: API_KEY, projectId: PROJECT, emulator: { auth: AUTH, firestore: FS } });
  assert.equal(st.state, 'abgemeldet');
  await assert.rejects(pc.api('/api/sync/register', 'POST', { email: 'petra@example.com', password: 'kurz' }), /mindestens 8 Zeichen/);
  st = await pc.api('/api/sync/register', 'POST', { email: 'petra@example.com', password: 'Geheim-Rezepte-1' });
  assert.equal(st.signedIn, true);
  await pc.api('/api/recipes', 'POST', recipe('Kartoffelsuppe', { photo: PHOTO }));
  await pc.api('/api/recipes', 'POST', recipe('Linsencurry', { category: 'Hauptgerichte' }));
  st = await pc.sync();
  assert.equal(st.state, 'ok', st.lastError); assert.equal(st.pending, 0);
});

test('2. Notebook: mit Verbindungscode verbinden, anmelden → alle Rezepte inkl. Bild', async () => {
  const { code } = await pc.api('/api/sync/code');
  assert.match(code, /^PRA1-/);
  // Notebook hängt hinter der schaltbaren Verbindung
  const payload = JSON.parse(Buffer.from(code.slice(5), 'base64url').toString());
  payload.e = { auth: '127.0.0.1:19099', firestore: '127.0.0.1:18085' };
  await nb.api('/api/sync/config', 'PUT', { code: `PRA1-${Buffer.from(JSON.stringify(payload)).toString('base64url')}` });
  await assert.rejects(nb.api('/api/sync/login', 'POST', { email: 'petra@example.com', password: 'falsch-falsch' }), /stimmt nicht/);
  await nb.api('/api/sync/login', 'POST', { email: 'petra@example.com', password: 'Geheim-Rezepte-1' });
  const st = await nb.sync();
  assert.equal(st.state, 'ok', st.lastError);
  const list = await nb.list();
  assert.deepEqual(list.map((r) => r.title), ['Kartoffelsuppe', 'Linsencurry']);
  const soup = await nb.byTitle('Kartoffelsuppe');
  assert.equal(soup.photo, PHOTO, 'Bild übertragen');
  assert.equal(soup.steps[0].text, 'Kartoffeln in den Mixtopf geben und 5 Sek./Stufe 5 zerkleinern.');
  assert.equal(soup.ingredients[0].amount, 500);
});

test('3. Änderung am Notebook (Favorit, Notiz, Zutat) → PC; alte Fassung im Versionsverlauf', async () => {
  const soup = await nb.byTitle('Kartoffelsuppe');
  await nb.api(`/api/recipes/${soup.id}`, 'PUT', { ...soup, notes: 'Mit Majoran!', ingredients: [...soup.ingredients, { id: 'i2', amount: 1, amountMax: null, unit: 'TL', name: 'Majoran', note: '', group: '' }] });
  await nb.api(`/api/recipes/${soup.id}/favorite`, 'PATCH', { favorite: true });
  assert.equal((await nb.sync()).pending, 0);
  await pc.sync();
  const onPc = await pc.byTitle('Kartoffelsuppe');
  assert.equal(onPc.notes, 'Mit Majoran!'); assert.equal(onPc.favorite, true); assert.equal(onPc.ingredients.length, 2);
  assert.equal(onPc.photo, PHOTO, 'Bild bleibt');
  const hist = await pc.api(`/api/recipes/${onPc.id}/history`);
  assert.ok(hist.some((h: any) => h.reason === 'vor Synchronisierung'), 'Versionsverlauf');
});

test('4. Offline am Notebook: Änderungen bleiben lokal, werden später automatisch übertragen', async () => {
  offline(true);
  const curry = await nb.byTitle('Linsencurry');
  await nb.api(`/api/recipes/${curry.id}`, 'PUT', { ...curry, servings: 6 });
  await nb.api('/api/recipes', 'POST', recipe('Offline-Brot', { category: 'Brot und Brötchen' }));
  let st = await nb.sync();
  assert.equal(st.state, 'offline'); assert.equal(st.pending, 2);
  assert.match(st.message, /Offline – Änderungen lokal gespeichert/);
  offline(false);
  st = await nb.sync();
  assert.equal(st.state, 'ok', st.lastError); assert.equal(st.pending, 0);
  await pc.sync();
  assert.equal((await pc.byTitle('Linsencurry')).servings, 6);
  await pc.byTitle('Offline-Brot');
});

test('5. Gleichzeitige Bearbeitung → Konflikt-Kopie, nichts geht verloren; Kopie behalten', async () => {
  const a = await pc.byTitle('Linsencurry');
  const b = await nb.byTitle('Linsencurry');
  await pc.api(`/api/recipes/${a.id}`, 'PUT', { ...a, description: 'Fassung vom PC' });
  await nb.api(`/api/recipes/${b.id}`, 'PUT', { ...b, description: 'Fassung vom Notebook' });
  await pc.sync();
  const st = await nb.sync();
  assert.equal(st.conflicts, 1);
  assert.match(st.message, /Konflikt-Kopie/);
  assert.equal((await nb.byTitle('Linsencurry')).description, 'Fassung vom PC');
  const copy = (await nb.list()).find((r) => r.conflict)!;
  assert.match(copy.title, /^Linsencurry \(Konflikt-Kopie /);
  assert.equal((await nb.api(`/api/recipes/${copy.id}`)).description, 'Fassung vom Notebook');
  await pc.sync();
  assert.ok((await pc.list()).some((r) => r.conflict), 'Kopie auch auf dem PC sichtbar');
  // Notebook-Fassung behalten → ersetzt das Original, Kopie verschwindet
  await nb.api(`/api/recipes/${copy.id}/conflict/keep`, 'POST');
  await nb.sync(); await pc.sync();
  for (const d of [pc, nb]) {
    const titles = (await d.list()).map((r) => r.title);
    assert.deepEqual(titles.filter((t) => t.startsWith('Linsencurry')), ['Linsencurry'], d.name);
    assert.equal((await d.byTitle('Linsencurry')).description, 'Fassung vom Notebook', d.name);
  }
});

test('6. Löschen: Papierkorb auf beiden Geräten, endgültig löschen überall', async () => {
  const brot = await pc.byTitle('Offline-Brot');
  await pc.api(`/api/recipes/${brot.id}`, 'DELETE');
  await pc.sync(); await nb.sync();
  assert.ok(!(await nb.list()).some((r) => r.title === 'Offline-Brot'));
  const trash = await nb.api('/api/trash');
  assert.ok(trash.some((r: any) => r.title === 'Offline-Brot'), 'im Papierkorb des Notebooks');
  await pc.api(`/api/trash/${brot.id}`, 'DELETE');
  await pc.sync(); await nb.sync();
  assert.ok(!(await nb.api('/api/trash')).some((r: any) => r.title === 'Offline-Brot'), 'endgültig gelöscht');
});

test('7. Kategorien und Bilder: nur Geändertes wird übertragen', async () => {
  const cats = await pc.api('/api/categories', 'PUT', { list: ['Weihnachten', 'Suppen', 'Hauptgerichte', 'Sonstiges'] });
  assert.equal(cats[0], 'Weihnachten');
  await pc.sync(); await nb.sync();
  const s = await nb.api('/api/session');
  assert.deepEqual(s.settings.categories, ['Weihnachten', 'Suppen', 'Hauptgerichte', 'Sonstiges']);
  // Bild unverändert → beim Bearbeiten wird nur das Rezept übertragen (Fingerabdruck gleich)
  const soup = await pc.byTitle('Kartoffelsuppe');
  const photoDoc = async () => {
    const users = await (await fetch(`http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${await uidOf()}/photos/${soup.uuid}`, { headers: { Authorization: 'Bearer owner' } })).json();
    return users.updateTime as string;
  };
  const t1 = await photoDoc();
  assert.ok(t1, 'Bild liegt in der Cloud');
  await pc.api(`/api/recipes/${soup.id}`, 'PUT', { ...soup, servings: 5 });
  await pc.sync(); await nb.sync();
  assert.equal(await photoDoc(), t1, 'Bild wurde nicht erneut übertragen');
  const nbSoup = await nb.byTitle('Kartoffelsuppe');
  assert.equal(nbSoup.servings, 5); assert.equal(nbSoup.photo, PHOTO);
});

test('8. Sicherheitsregeln: fremde Benutzer und Unangemeldete haben keinen Zugriff', async () => {
  const signIn = async (email: string, password: string, op = 'signInWithPassword') => (await (await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:${op}?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  })).json()) as { localId: string; idToken: string };
  const petra = await signIn('petra@example.com', 'Geheim-Rezepte-1');
  const other = await signIn('fremd@example.com', 'Anderes-Passwort-2', 'signUp');
  const url = `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users/${petra.localId}/recipes`;
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${petra.idToken}` } })).status, 200);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${other.idToken}` } })).status, 403);
  assert.equal((await fetch(url)).status, 403);
  const w = await fetch(`${url}?documentId=hack`, { method: 'POST', headers: { Authorization: `Bearer ${other.idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: {} }) });
  assert.equal(w.status, 403);
});

test('9. Geräte: Liste, Gerätename, Notebook entfernen → dort abgemeldet, Rezepte bleiben', async () => {
  await nb.api('/api/sync/device-name', 'PUT', { name: 'Petras Notebook' });
  await nb.sync();
  const devs = await pc.api('/api/sync/devices');
  assert.equal(devs.length, 2);
  assert.ok(devs[0].current);
  const nbDev = devs.find((d: any) => d.name === 'Petras Notebook');
  assert.ok(nbDev);
  await pc.api(`/api/sync/devices/${nbDev.id}`, 'DELETE');
  const st = await nb.sync();
  assert.equal(st.state, 'entfernt'); assert.equal(st.signedIn, false);
  assert.ok((await nb.list()).length >= 2, 'lokale Rezepte bleiben erhalten');
  // erneut anmelden verbindet das Gerät wieder
  await nb.api('/api/sync/login', 'POST', { email: 'petra@example.com', password: 'Geheim-Rezepte-1' });
  assert.equal((await nb.sync()).state, 'ok');
  assert.ok(!(await pc.api('/api/sync/devices')).find((d: any) => d.id === nbDev.id).removed);
});

test('10. Abmelden: Daten bleiben, Passwort-zurücksetzen-Anfrage funktioniert', async () => {
  const n = (await pc.list()).length;
  const st = await pc.api('/api/sync/logout', 'POST');
  assert.equal(st.signedIn, false);
  assert.equal((await pc.list()).length, n);
  assert.deepEqual(await pc.api('/api/sync/reset', 'POST', { email: 'petra@example.com' }), { ok: true });
});
