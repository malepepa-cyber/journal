import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRecipeText } from '../shared/parser.ts';

const PORT = 47391, TOKEN = 'test-token-123';
const DATA = mkdtempSync(join(tmpdir(), 'pra-'));
let proc: ChildProcess;
const base = `http://127.0.0.1:${PORT}`;
const api = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', 'x-pra-token': TOKEN, ...(init.headers || {}) } });
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  return { status: r.status, body };
};

before(async () => {
  proc = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts', '--no-browser'], {
    env: { ...process.env, PRA_DATA_DIR: DATA, PRA_PORT: String(PORT), PRA_TOKEN: TOKEN, PRA_WEB_DIR: join(process.cwd(), 'tests', 'fixtures-web') },
    stdio: 'pipe',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* noch nicht da */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server startet nicht');
});
after(() => { proc.kill(); });

test('Sicherheit: Token, Host, Origin', async () => {
  assert.equal((await fetch(`${base}/api/session`)).status, 401);
  assert.equal((await fetch(`${base}/api/session`, { headers: { 'x-pra-token': 'falsch' } })).status, 401);
  assert.equal((await fetch(`${base}/api/session`, { headers: { 'x-pra-token': TOKEN, Origin: 'https://boese.example' } })).status, 403);
  const r = await new Promise<number>((ok) => {
    import('node:http').then(({ request }) => {
      const q = request({ host: '127.0.0.1', port: PORT, path: '/api/health', headers: { Host: 'evil.example:80' } }, (res) => ok(res.statusCode!));
      q.end();
    });
  });
  assert.equal(r, 403, 'DNS-Rebinding: fremder Host wird abgewiesen');
  assert.equal((await api('/api/session')).status, 200);
});

test('Rezepte: anlegen, lesen, suchen, Favorit, Duplikat, Papierkorb', async () => {
  const s = await api('/api/session');
  assert.equal(s.body.profiles[0].name, 'Petra');
  const r = parseRecipeText('Kürbissuppe\n4 Portionen\nZutaten\n500 g Kürbis\n1 Zwiebel\nZubereitung\n1. Zwiebel 5 Sek./Stufe 5 zerkleinern.\n2. Kürbis 20 Min./100°C/Stufe 1 garen.');
  const created = await api('/api/recipes', { method: 'POST', body: JSON.stringify(r) });
  assert.equal(created.status, 200);
  assert.equal(created.body.category, 'Suppen');
  const id = created.body.id;
  assert.equal((await api(`/api/recipes/${id}`)).body.title, 'Kürbissuppe');
  assert.equal((await api('/api/recipes?q=kurbis')).body.length, 1, 'Suche ignoriert Umlaute');
  assert.equal((await api('/api/recipes?q=zwiebel')).body.length, 1, 'Suche in Zutaten');
  assert.equal((await api('/api/recipes?q=lasagne')).body.length, 0);
  await api(`/api/recipes/${id}/favorite`, { method: 'PATCH', body: JSON.stringify({ favorite: true }) });
  assert.equal((await api('/api/recipes?favorite=1')).body.length, 1);
  const dup = await api('/api/recipes/duplicates', { method: 'POST', body: JSON.stringify({ title: 'kürbissuppe', ingredients: r.ingredients }) });
  assert.equal(dup.body.length, 1, 'Duplikat erkannt');
  const copy = await api(`/api/recipes/${id}/duplicate`, { method: 'POST' });
  assert.equal(copy.body.title, 'Kürbissuppe (Kopie)');
  const current = (await api(`/api/recipes/${id}`)).body;
  const upd = await api(`/api/recipes/${id}`, { method: 'PUT', body: JSON.stringify({ ...current, notes: 'Mit Ingwer!' }) });
  assert.equal(upd.body.notes, 'Mit Ingwer!');
  await api(`/api/recipes/${copy.body.id}`, { method: 'DELETE' });
  assert.equal((await api('/api/recipes')).body.length, 1);
  assert.equal((await api('/api/trash')).body.length, 1);
  await api(`/api/trash/${copy.body.id}/restore`, { method: 'POST' });
  assert.equal((await api('/api/recipes')).body.length, 2);
  const st = await api('/api/stats');
  assert.deepEqual([st.body.total, st.body.favorites, st.body.byCategory.Suppen], [2, 1, 2]);
});

test('Eingabeprüfung', async () => {
  const bad = await api('/api/recipes', { method: 'POST', body: JSON.stringify({ title: '  ', ingredients: [], steps: [] }) });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Namen/);
  assert.equal((await api('/api/recipes/abc')).status, 400);
  assert.equal((await api('/api/recipes/9999')).status, 404);
  assert.equal((await api('/api/recipes', { method: 'POST', body: '{kaputt' })).status, 400);
  assert.equal((await api('/api/ai/key', { method: 'PUT', body: JSON.stringify({ key: 'falsch' }) })).status, 400);
});

test('Export / Import', async () => {
  const ex = await api('/api/export');
  assert.equal(ex.body.format, 'petras-rezepte-app');
  assert.equal(ex.body.recipes.length, 2);
  const im = await api('/api/import', { method: 'POST', body: JSON.stringify(ex.body) });
  assert.deepEqual(im.body, { imported: 0, skipped: 2 }, 'Duplikate werden übersprungen');
  const im2 = await api('/api/import', { method: 'POST', body: JSON.stringify({ ...ex.body, allowDuplicates: true }) });
  assert.equal(im2.body.imported, 2);
});

test('Entwurf (Autosave), Einstellungen, Profile', async () => {
  await api('/api/draft', { method: 'PUT', body: JSON.stringify({ recipe: { title: 'Halb fertig' } }) });
  assert.equal((await api('/api/draft')).body.data.recipe.title, 'Halb fertig');
  const st = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ experimentalTransfer: true, cookidooUrl: 'https://evil.example/', unbekannt: 1 }) });
  assert.equal(st.body.experimentalTransfer, true);
  assert.equal(st.body.cookidooUrl, 'https://cookidoo.de/created-recipes/de-DE', 'fremde URL abgelehnt');
  const p = await api('/api/profiles', { method: 'POST', body: JSON.stringify({ name: 'Patrick' }) });
  await api(`/api/profiles/${p.body.id}/select`, { method: 'POST' });
  assert.equal((await api('/api/recipes')).body.length, 0, 'Profile sind getrennt');
  await api('/api/profiles/1/select', { method: 'POST' });
  assert.ok((await api('/api/recipes')).body.length > 0);
});

test('API-Schlüssel wird verschlüsselt gespeichert', async () => {
  const key = 'sk-ant-api03-TESTTESTTESTTESTTESTTEST';
  assert.equal((await api('/api/ai/key', { method: 'PUT', body: JSON.stringify({ key }) })).body.aiKey, true);
  assert.equal((await api('/api/session')).body.aiKey, true);
  // WAL-Datei/DB enthalten den Schlüssel nicht im Klartext
  for (const f of ['rezepte.db', 'rezepte.db-wal']) {
    if (existsSync(join(DATA, f))) assert.ok(!readFileSync(join(DATA, f)).includes(key), `${f} enthält Klartext`);
  }
  await api('/api/ai/key', { method: 'PUT', body: JSON.stringify({ key: '' }) });
  assert.equal((await api('/api/session')).body.aiKey, false);
});

test('Sicherungen: erstellen und wiederherstellen', async () => {
  const before = (await api('/api/recipes')).body.length;
  const b = await api('/api/backups', { method: 'POST' });
  assert.match(b.body.name, /^sicherung-.*-manuell\.db$/);
  await api(`/api/recipes/${(await api('/api/recipes')).body[0].id}`, { method: 'DELETE' });
  assert.equal((await api('/api/recipes')).body.length, before - 1);
  assert.equal((await api('/api/backups/restore', { method: 'POST', body: JSON.stringify({ name: b.body.name }) })).status, 200);
  assert.equal((await api('/api/recipes')).body.length, before, 'nach Wiederherstellung wieder da');
  assert.ok((await api('/api/backups')).body.some((x: any) => x.kind === 'vor-wiederherstellung'));
  assert.equal((await api('/api/backups/restore', { method: 'POST', body: JSON.stringify({ name: '../../etc/passwd' }) })).status, 404);
});

test('Protokoll enthält keine Geheimnisse', async () => {
  await api('/api/log', { method: 'POST', body: JSON.stringify({ message: 'Test mit sk-ant-api03-GEHEIMGEHEIM und password=abc' }) });
  const logText = readFileSync(join(DATA, 'logs', 'app.log'), 'utf8');
  assert.ok(!logText.includes('GEHEIMGEHEIM') && !logText.includes('password=abc'));
});

test('Link abrufen: Schutz vor Adressen im eigenen Netz', async () => {
  for (const url of ['http://127.0.0.1:47391/api/session', 'http://localhost/', 'http://192.168.178.1/', 'http://10.0.0.5/', 'file:///etc/passwd', 'http://[::1]/', 'https://user:pw@example.com/', 'http://example.com:8080/']) {
    const r = await api('/api/fetch-url', { method: 'POST', body: JSON.stringify({ url }) });
    assert.equal(r.status, 400, `${url} → ${r.status} ${JSON.stringify(r.body)}`);
  }
  assert.equal((await api('/api/fetch-url', { method: 'POST', body: JSON.stringify({ url: 'kein link' }) })).status, 400);
});
