/**
 * Synchronisierung PC ↔ Notebook („lokal zuerst“).
 *
 * Jedes Gerät arbeitet mit seiner eigenen lokalen Datenbank. Die Cloud dient nur als Abgleichstelle.
 * Ablauf eines Abgleichs:
 *   1. Anmeldung auffrischen, Gerät melden (wurde es entfernt? → abmelden)
 *   2. Holen: alle Rezepte, die sich in der Cloud seit dem letzten Abgleich geändert haben
 *      - lokal unverändert → Cloud-Fassung übernehmen (alte Fassung in den Versionsverlauf)
 *      - lokal AUCH geändert → Konflikt: Cloud-Fassung übernehmen, eigene Fassung als „Konflikt-Kopie“ behalten
 *   3. Senden: alle lokal geänderten Rezepte – nur wenn die Cloud noch die zuletzt bekannte Fassung hat
 *      (Vorbedingung). Sonst Konflikt wie oben. Bilder nur, wenn sich ihr Fingerabdruck geändert hat.
 *   4. Endgültige Löschungen und Kategorien abgleichen.
 * Es geht nie etwas unbemerkt verloren: Überschriebenes landet im Versionsverlauf, Gleichzeitiges als Kopie.
 */
import { hostname, platform } from 'node:os';
import { randomUUID } from 'node:crypto';
import * as db from '../db.ts';
import { encrypt, decrypt } from '../secrets.ts';
import { log } from '../log.ts';
import { APP_VERSION } from '../paths.ts';
import { cleanCategories, type Recipe } from '../../shared/model.ts';
import { Firestore, SyncError, refresh, signIn, signUp, sendPasswordReset, validateConfig, type Doc, type FirebaseConfig, type Tokens } from './firebase.ts';

export type SyncState = 'aus' | 'abgemeldet' | 'bereit' | 'läuft' | 'ok' | 'offline' | 'fehler' | 'entfernt';
export interface SyncStatus {
  configured: boolean; signedIn: boolean; email: string | null; profileId: number | null;
  state: SyncState; message: string; lastSync: string | null; lastError: string | null;
  pending: number; conflicts: number; deviceId: string; deviceName: string; nextTry: string | null;
}
export interface DeviceInfo { id: string; name: string; platform: string; appVersion: string; lastSeen: string | null; removed: boolean; current: boolean }

const MAX_PHOTO = 1_000_000; // Firestore erlaubt max. 1 MiB je Dokument

// ---------------- Gespeicherter Zustand (lokal, in der Tabelle meta) ----------------
const meta = {
  get: (k: string) => db.getMeta(`sync.${k}`),
  set: (k: string, v: string | null) => { if (v == null) db.openDb().prepare('DELETE FROM meta WHERE key = ?').run(`sync.${k}`); else db.setMeta(`sync.${k}`, v); },
};

export function getConfig(): FirebaseConfig | null {
  const raw = meta.get('config') ?? process.env.PRA_FIREBASE_CONFIG ?? null;
  if (!raw) return null;
  try { return validateConfig(JSON.parse(raw)); } catch { return null; }
}
export function setConfig(c: Partial<FirebaseConfig> | null): FirebaseConfig | null {
  if (!c) { meta.set('config', null); return null; }
  const v = validateConfig(c);
  meta.set('config', JSON.stringify(v));
  return v;
}

/** Verbindungscode für das zweite Gerät (enthält nur die öffentlichen Projektdaten, KEIN Passwort) */
export function connectCode(): string | null {
  const c = getConfig(); if (!c) return null;
  return `PRA1-${Buffer.from(JSON.stringify({ k: c.apiKey, p: c.projectId, ...(c.emulator ? { e: c.emulator } : {}) })).toString('base64url')}`;
}
export function applyConnectCode(code: string): FirebaseConfig {
  const m = code.trim().match(/^PRA1-([\w-]+)$/);
  if (!m) throw new SyncError('Der Verbindungscode ist ungültig. Er beginnt mit „PRA1-“.', 'config');
  let o: any; try { o = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { throw new SyncError('Der Verbindungscode ist ungültig.', 'config'); }
  return setConfig({ apiKey: o.k, projectId: o.p, emulator: o.e ?? null })!;
}

export function deviceId(): string {
  let id = meta.get('deviceId');
  if (!id) { id = randomUUID(); meta.set('deviceId', id); }
  return id;
}
export function deviceName(): string { return meta.get('deviceName') ?? (hostname() || 'Mein PC'); }
export function setDeviceName(n: string): void { meta.set('deviceName', n.replace(/\s+/g, ' ').trim().slice(0, 50) || null); }

interface Account { uid: string; email: string }
const account = (): Account | null => { try { return JSON.parse(meta.get('account') ?? 'null'); } catch { return null; } };
const profileId = (): number | null => { const v = Number(meta.get('profileId')); return Number.isInteger(v) && v > 0 ? v : null; };

let tokens: Tokens | null = null;
let state: SyncState = 'bereit';
let message = '';
let lastError: string | null = null;
let running: Promise<void> | null = null;
let rerun = false;

function storeTokens(t: Tokens): void {
  tokens = t;
  meta.set('refresh', encrypt(t.refreshToken));
}

async function idToken(c: FirebaseConfig): Promise<string> {
  if (tokens && tokens.expiresAt > Date.now()) return tokens.idToken;
  const acc = account(); const stored = meta.get('refresh');
  if (!acc || !stored) throw new SyncError('Bitte anmelden.', 'auth');
  storeTokens(await refresh(c, decrypt(stored), acc.email));
  return tokens!.idToken;
}

function store(c: FirebaseConfig): Firestore {
  const acc = account();
  if (!acc) throw new SyncError('Bitte anmelden.', 'auth');
  return new Firestore(c, () => idToken(c), acc.uid);
}

// ---------------- Konto ----------------
function needConfig(): FirebaseConfig {
  const c = getConfig();
  if (!c) throw new SyncError('Die Synchronisierung ist noch nicht eingerichtet (Projektdaten fehlen).', 'config');
  return c;
}

async function afterLogin(t: Tokens, forProfile: number): Promise<void> {
  const before = meta.get('lastUid');
  storeTokens(t);
  meta.set('account', JSON.stringify({ uid: t.uid, email: t.email }));
  meta.set('profileId', String(forProfile));
  if (before !== t.uid) {
    // Anderes Konto als zuletzt: alles neu abgleichen (lokale Rezepte werden hochgeladen, nichts gelöscht)
    db.openDb().prepare('UPDATE recipes SET remote_time = NULL, photo_synced = NULL, dirty = 1 WHERE profile_id = ?').run(forProfile);
    db.openDb().prepare('DELETE FROM tombstones').run();
    meta.set('cursor', null); meta.set('categoriesRemote', null);
    db.setMeta(`categoriesChanged:${forProfile}`, new Date().toISOString());
  }
  meta.set('lastUid', t.uid);
  state = 'bereit'; lastError = null;
  await registerDevice(needConfig(), false);
  log('info', 'Synchronisierung: angemeldet');
  schedule(0);
}

export async function register(email: string, password: string, forProfile: number): Promise<void> {
  await afterLogin(await signUp(needConfig(), email.trim(), password), forProfile);
}
export async function login(email: string, password: string, forProfile: number): Promise<void> {
  await afterLogin(await signIn(needConfig(), email.trim(), password), forProfile);
}
export async function resetPassword(email: string): Promise<void> { await sendPasswordReset(needConfig(), email.trim()); }

/** Abmelden: lokale Rezepte bleiben vollständig erhalten. Nicht übertragene Änderungen werden beim nächsten Anmelden gesendet. */
export function logout(reason: SyncState = 'abgemeldet'): void {
  tokens = null;
  meta.set('refresh', null); meta.set('account', null);
  state = reason; lastError = null;
  message = reason === 'entfernt' ? 'Dieses Gerät wurde vom Konto getrennt. Die Rezepte auf diesem Gerät bleiben erhalten.' : '';
  log('info', `Synchronisierung: abgemeldet (${reason})`);
}

// ---------------- Geräte ----------------
async function registerDevice(c: FirebaseConfig, checkRemoved: boolean): Promise<boolean> {
  const fs = store(c);
  const id = deviceId();
  if (checkRemoved) {
    const d = await fs.get(`devices/${id}`);
    if (d?.fields.removed === true) return false;
  }
  await fs.write(`devices/${id}`, { name: deviceName(), platform: platform(), appVersion: APP_VERSION, removed: false });
  return true;
}

export async function listDevices(): Promise<DeviceInfo[]> {
  const fs = store(needConfig());
  return (await fs.list('devices')).map((d) => ({
    id: d.id, name: String(d.fields.name ?? 'Gerät'), platform: String(d.fields.platform ?? ''), appVersion: String(d.fields.appVersion ?? ''),
    lastSeen: (d.fields.updatedAt as { timestamp: string } | null)?.timestamp ?? null, removed: d.fields.removed === true, current: d.id === deviceId(),
  })).sort((a, b) => Number(b.current) - Number(a.current) || String(b.lastSeen).localeCompare(String(a.lastSeen)));
}

/** Gerät vom Konto trennen (es meldet sich beim nächsten Abgleich ab, seine lokalen Daten bleiben dort erhalten) */
export async function removeDevice(id: string): Promise<void> {
  if (!/^[\w-]{8,64}$/.test(id)) throw new SyncError('Ungültiges Gerät.', 'config');
  const fs = store(needConfig());
  const d = await fs.get(`devices/${id}`);
  if (!d) throw new SyncError('Gerät nicht gefunden.', 'notfound');
  await fs.write(`devices/${id}`, { name: String(d.fields.name ?? ''), platform: String(d.fields.platform ?? ''), appVersion: String(d.fields.appVersion ?? ''), removed: true });
  if (id === deviceId()) logout('entfernt');
}

// ---------------- Abgleich ----------------
interface Row { id: number; uuid: string; data: string; favorite: number; deleted_at: string | null; dirty: number; remote_time: string | null; photo_hash: string | null; photo_synced: string | null; version: number; created_at: string }
const rowByUuid = (pid: number, uuid: string) => db.openDb().prepare('SELECT * FROM recipes WHERE uuid = ? AND profile_id = ?').get(uuid, pid) as unknown as Row | undefined;

/** Rezept ohne Bild und ohne geräteabhängige Felder (so wird es in der Cloud gespeichert) */
function cloudData(row: Row): string {
  const r = JSON.parse(row.data) as Recipe;
  return JSON.stringify({ ...r, photo: null, favorite: !!row.favorite, profileId: null, createdAt: row.created_at });
}

async function fetchPhoto(fs: Firestore, uuid: string, hash: string): Promise<string | null> {
  const d = await fs.get(`photos/${uuid}`);
  return d && d.fields.hash === hash && typeof d.fields.data === 'string' ? d.fields.data : null;
}

/** Cloud-Fassung lokal übernehmen (vorherige lokale Fassung wandert in den Versionsverlauf) */
async function applyRemote(fs: Firestore, pid: number, doc: Doc, local: Row | undefined, reason: string): Promise<void> {
  const d = db.openDb();
  const f = doc.fields;
  if (f.purged === true) {
    if (local) {
      d.prepare('DELETE FROM recipes WHERE id = ?').run(local.id);
      d.prepare('DELETE FROM recipe_history WHERE uuid = ?').run(local.uuid);
    }
    return;
  }
  if (typeof f.data !== 'string') return;
  const remote = JSON.parse(f.data) as Recipe;
  const hash = typeof f.photoHash === 'string' ? f.photoHash : null;
  let photo: string | null = null;
  if (hash) {
    const localPhoto = local ? (JSON.parse(local.data) as Recipe).photo : null;
    photo = local?.photo_hash === hash ? localPhoto : await fetchPhoto(fs, doc.id, hash);
    if (!photo && localPhoto) photo = localPhoto; // Bild noch nicht da → vorhandenes behalten
  }
  const deletedAt = f.deleted === true ? (local?.deleted_at ?? new Date().toISOString()) : null;
  const rec: Recipe = { ...remote, photo, id: null, profileId: pid };
  const clean = db.sanitizeRecipe(rec, pid);
  const data = db.recipeData(clean);
  const cols = { title: clean.title, category: clean.category, favorite: remote.favorite ? 1 : 0, status: clean.cookidoo?.status ?? 'offen' };
  const createdAt = remote.createdAt ?? new Date().toISOString();
  const photoSynced = photo ? db.photoHash(photo) : null;
  if (local) {
    if (local.data !== data) db.addHistory(pid, local.uuid, local.data, reason);
    d.prepare(`UPDATE recipes SET title=?, category=?, favorite=?, fingerprint=?, search=?, cookidoo_status=?, data=?, photo_hash=?, photo_synced=?,
      deleted_at=?, dirty=0, remote_time=?, version=?, updated_at=? WHERE id=?`)
      .run(cols.title, cols.category, cols.favorite, db.fingerprintOf(clean), db.searchOf(clean), cols.status, data, photoSynced, photoSynced,
        deletedAt, doc.updateTime, Number(f.version ?? 1), new Date().toISOString(), local.id);
  } else {
    d.prepare(`INSERT INTO recipes (profile_id, uuid, title, category, favorite, fingerprint, search, cookidoo_status, data, photo_hash, photo_synced,
      deleted_at, dirty, remote_time, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)`)
      .run(pid, doc.id, cols.title, cols.category, cols.favorite, db.fingerprintOf(clean), db.searchOf(clean), cols.status, data, photoSynced, photoSynced,
        deletedAt, doc.updateTime, Number(f.version ?? 1), createdAt, new Date().toISOString());
  }
}

/** Beide Seiten haben geändert: Cloud gewinnt, die eigene Fassung bleibt als Konflikt-Kopie erhalten. */
async function resolveConflict(fs: Firestore, pid: number, doc: Doc, local: Row): Promise<boolean> {
  const remoteData = typeof doc.fields.data === 'string' ? JSON.parse(doc.fields.data) as Recipe : null;
  const mine = JSON.parse(local.data) as Recipe;
  const same = remoteData && cloudData(local) === JSON.stringify({ ...remoteData, createdAt: local.created_at })
    && (doc.fields.deleted === true) === !!local.deleted_at;
  if (same) { await applyRemote(fs, pid, doc, local, 'abgeglichen'); return false; }
  const localDeletedOnly = !!local.deleted_at;
  await applyRemote(fs, pid, doc, local, 'Konflikt (vor Übernahme)');
  if (localDeletedOnly && doc.fields.purged !== true) return false; // lokal gelöscht, woanders bearbeitet → bearbeitete Fassung bleibt
  const device = deviceName();
  const at = new Date().toISOString();
  db.saveRecipe(pid, {
    ...mine, id: null, favorite: !!local.favorite,
    title: `${mine.title} (Konflikt-Kopie ${device})`.slice(0, 200),
    conflict: { of: local.uuid, device, at },
  }, 'Konflikt-Kopie');
  log('info', 'Synchronisierung: Konflikt – Konflikt-Kopie angelegt');
  return true;
}

async function pull(fs: Firestore, pid: number): Promise<number> {
  let conflicts = 0;
  const cursor = meta.get('cursor');
  // 2 Minuten Überlappung: auch gleichzeitig übertragene Änderungen sicher erfassen (Doppeltes wird erkannt)
  let after = cursor ? new Date(Date.parse(cursor) - 120_000).toISOString() : '1970-01-01T00:00:00Z';
  let newest = cursor;
  for (let page = 0; page < 500; page++) {
    const docs = await fs.changedSince('recipes', after);
    for (const doc of docs) {
      const local = rowByUuid(pid, doc.id);
      if (local && local.remote_time === doc.updateTime) continue; // schon bekannt (z. B. eigene Änderung)
      if (local?.dirty) { if (await resolveConflict(fs, pid, doc, local)) conflicts++; }
      else if (!local && doc.fields.purged === true) continue;
      else await applyRemote(fs, pid, doc, local, 'vor Synchronisierung');
    }
    if (docs.length) {
      const last = (docs[docs.length - 1].fields.updatedAt as { timestamp: string }).timestamp;
      after = last;
      if (!newest || last > newest) newest = last;
    }
    if (docs.length < 200) break;
  }
  if (newest) meta.set('cursor', newest);
  return conflicts;
}

async function push(fs: Firestore, pid: number): Promise<number> {
  let conflicts = 0;
  const rows = db.openDb().prepare('SELECT * FROM recipes WHERE profile_id = ? AND dirty = 1 ORDER BY id').all(pid) as unknown as Row[];
  for (const row of rows) {
    const current = rowByUuid(pid, row.uuid);
    if (!current?.dirty) continue;
    // Bild nur übertragen, wenn neu oder geändert
    const photo = (JSON.parse(current.data) as Recipe).photo;
    let photoHash: string | null = current.photo_hash;
    if (photo && current.photo_hash !== current.photo_synced) {
      if (photo.length > MAX_PHOTO) { photoHash = null; log('warn', 'Synchronisierung: Bild zu groß, wird nicht übertragen'); }
      else await fs.write(`photos/${current.uuid}`, { hash: current.photo_hash, data: photo });
    }
    if (!photo) photoHash = null;
    try {
      const time = await fs.write(`recipes/${current.uuid}`, {
        data: cloudData(current), deleted: !!current.deleted_at, purged: false, version: current.version,
        photoHash, device: deviceName(),
      }, current.remote_time ?? null);
      // nur als übertragen markieren, wenn sich der Datensatz währenddessen nicht erneut geändert hat
      db.openDb().prepare('UPDATE recipes SET dirty = CASE WHEN data = ? AND IFNULL(deleted_at, \'\') = ? THEN 0 ELSE 1 END, remote_time = ?, photo_synced = ? WHERE id = ?')
        .run(current.data, current.deleted_at ?? '', time, photoHash ? current.photo_hash : current.photo_synced, current.id);
    } catch (e) {
      if (!(e instanceof SyncError && e.kind === 'conflict')) throw e;
      const doc = await fs.get(`recipes/${current.uuid}`);
      if (!doc) { db.openDb().prepare('UPDATE recipes SET remote_time = NULL WHERE id = ?').run(current.id); continue; }
      if (await resolveConflict(fs, pid, doc, current)) conflicts++;
    }
  }
  // endgültig gelöschte Rezepte
  const stones = db.openDb().prepare('SELECT uuid FROM tombstones WHERE profile_id = ?').all(pid) as { uuid: string }[];
  for (const { uuid } of stones) {
    await fs.write(`recipes/${uuid}`, { data: null, deleted: true, purged: true, version: 0, photoHash: null, device: deviceName() });
    await fs.remove(`photos/${uuid}`);
    db.openDb().prepare('DELETE FROM tombstones WHERE uuid = ?').run(uuid);
  }
  return conflicts;
}

/** Kategorien: zuletzt geänderte Liste gewinnt; bei gleichzeitiger Änderung werden beide Listen vereinigt */
async function syncCategories(fs: Firestore, pid: number): Promise<void> {
  const localChanged = db.getMeta(`categoriesChanged:${pid}`);
  const lastSent = meta.get('categoriesSent');
  const remote = await fs.get('meta/settings');
  const remoteList = remote && typeof remote.fields.categories === 'string' ? cleanCategories(JSON.parse(remote.fields.categories)) : null;
  const known = meta.get('categoriesRemote');
  const remoteNew = remote && remote.updateTime !== known;
  const localNew = !!localChanged && localChanged !== lastSent;
  const local = db.getSettings(pid).categories;
  let list = local;
  if (remoteNew && remoteList) {
    list = localNew ? cleanCategories([...remoteList, ...local.filter((c) => !remoteList.includes(c))]) : remoteList;
    if (JSON.stringify(list) !== JSON.stringify(local)) {
      db.openDb().prepare('INSERT INTO settings (profile_id, key, value) VALUES (?, ?, ?) ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value').run(pid, 'categories', JSON.stringify(list));
    }
  }
  if (localNew || (remoteNew && JSON.stringify(list) !== JSON.stringify(remoteList)) || !remote) {
    try {
      const t = await fs.write('meta/settings', { categories: JSON.stringify(list) }, remote ? remote.updateTime : null);
      meta.set('categoriesRemote', t);
    } catch (e) { if (!(e instanceof SyncError && e.kind === 'conflict')) throw e; return syncCategories(fs, pid); }
  } else if (remote) meta.set('categoriesRemote', remote.updateTime);
  if (localChanged) meta.set('categoriesSent', localChanged);
}

async function runOnce(): Promise<void> {
  const c = getConfig();
  const pid = profileId();
  if (!c) { state = 'aus'; return; }
  if (!account() || !pid) { if (state !== 'entfernt') state = 'abgemeldet'; return; }
  state = 'läuft'; message = 'Synchronisierung läuft …';
  try {
    if (!(await registerDevice(c, true))) { logout('entfernt'); return; }
    const fs = store(c);
    let conflicts = await pull(fs, pid);
    conflicts += await push(fs, pid);
    await syncCategories(fs, pid);
    meta.set('lastSync', new Date().toISOString());
    state = 'ok'; lastError = null; failures = 0;
    message = conflicts ? `${conflicts} gleichzeitige Änderung${conflicts > 1 ? 'en' : ''} – als Konflikt-Kopie gespeichert` : 'Synchronisiert';
  } catch (e) {
    const err = e instanceof SyncError ? e : new SyncError((e as Error).message);
    failures++;
    if (err.kind === 'offline') { state = 'offline'; message = 'Offline – Änderungen lokal gespeichert'; lastError = null; }
    else { state = 'fehler'; message = 'Synchronisierung fehlgeschlagen'; lastError = err.message; log('error', 'Synchronisierung fehlgeschlagen', err.message); }
    if (err.kind === 'auth' && /anmelden/.test(err.message)) { tokens = null; }
    throw err;
  }
}

/** Abgleich starten (läuft schon einer, wird danach noch einmal abgeglichen) */
export function syncNow(): Promise<void> {
  if (running) { rerun = true; return running; }
  running = (async () => {
    try {
      do { rerun = false; await runOnce(); } while (rerun);
    } finally { running = null; schedule(); }
  })();
  return running;
}

// ---------------- Automatik: beim Start, alle 2 Minuten, nach Änderungen; bei Fehlern mit wachsenden Pausen ----------------
let timer: NodeJS.Timeout | null = null;
let nextAt: number | null = null;
let failures = 0;
const BACKOFF = [15, 30, 60, 120, 300, 600];

function schedule(delayMs?: number): void {
  if (timer) clearTimeout(timer);
  if (!getConfig() || !account()) { nextAt = null; return; }
  const ms = delayMs ?? (failures ? BACKOFF[Math.min(failures - 1, BACKOFF.length - 1)] * 1000 : 120_000);
  nextAt = Date.now() + ms;
  timer = setTimeout(() => { syncNow().catch(() => { /* Status ist gesetzt */ }); }, ms);
  timer.unref?.();
}

export function startSync(): void {
  db.onLocalChange((pid) => { if (pid === profileId() && account()) schedule(failures ? undefined : 3000); });
  if (account()) schedule(1500);
}
export function stopSync(): void { if (timer) clearTimeout(timer); timer = null; db.onLocalChange(null); }

/** Nach dem Wiederherstellen einer Sicherung: Cloud-Stand vollständig neu einlesen */
export function resetCursor(): void { meta.set('cursor', null); meta.set('categoriesRemote', null); }

export function status(): SyncStatus {
  const pid = profileId();
  const acc = account();
  const d = db.openDb();
  const pending = pid ? Number((d.prepare('SELECT COUNT(*) AS n FROM recipes WHERE profile_id = ? AND dirty = 1').get(pid) as { n: number }).n)
    + Number((d.prepare('SELECT COUNT(*) AS n FROM tombstones WHERE profile_id = ?').get(pid) as { n: number }).n) : 0;
  const conflicts = pid ? (d.prepare('SELECT data FROM recipes WHERE profile_id = ? AND deleted_at IS NULL').all(pid) as { data: string }[])
    .filter((r) => r.data.includes('"conflict":{')).length : 0;
  const cfg = getConfig();
  const st: SyncState = !cfg ? 'aus' : !acc ? (state === 'entfernt' ? 'entfernt' : 'abgemeldet') : state;
  return {
    configured: !!cfg, signedIn: !!acc, email: acc?.email ?? null, profileId: pid,
    state: st, message: st === 'abgemeldet' ? 'Nicht angemeldet' : st === 'aus' ? 'Nicht eingerichtet' : message || (st === 'bereit' ? 'Bereit' : ''),
    lastSync: meta.get('lastSync'), lastError, pending, conflicts,
    deviceId: deviceId(), deviceName: deviceName(), nextTry: nextAt ? new Date(nextAt).toISOString() : null,
  };
}
