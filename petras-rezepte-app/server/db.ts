/**
 * Lokale SQLite-Datenbank (in Node.js eingebaut: node:sqlite – keine Zusatzinstallation).
 * Mehrere Profile, Rezepte als JSON-Dokument + durchsuchbare Spalten, Papierkorb,
 * Entwürfe (automatische Zwischenspeicherung) und Einstellungen.
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { dataDir } from './paths.ts';
import { log } from './log.ts';
import { fingerprint } from '../shared/validate.ts';
import { CATEGORIES, type Category, type Profile, type Recipe, type RecipeSummary } from '../shared/model.ts';

let db: DatabaseSync | null = null;

export function dbPath(): string { return join(dataDir(), 'rezepte.db'); }

const MIGRATIONS: string[] = [
  // v1
  `CREATE TABLE profiles (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
   CREATE TABLE recipes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     category TEXT NOT NULL,
     favorite INTEGER NOT NULL DEFAULT 0,
     fingerprint TEXT NOT NULL,
     search TEXT NOT NULL,
     cookidoo_status TEXT NOT NULL DEFAULT 'offen',
     data TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deleted_at TEXT);
   CREATE INDEX recipes_profile ON recipes(profile_id, deleted_at, updated_at);
   CREATE INDEX recipes_fp ON recipes(profile_id, fingerprint);
   CREATE TABLE settings (
     profile_id INTEGER NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     PRIMARY KEY (profile_id, key));
   CREATE TABLE drafts (
     profile_id INTEGER PRIMARY KEY,
     data TEXT NOT NULL,
     updated_at TEXT NOT NULL);
   CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];

export function openDb(path = dbPath()): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  migrate(db);
  return db;
}

export function closeDb(): void {
  try { db?.close(); } catch { /* egal */ }
  db = null;
}

function migrate(d: DatabaseSync): void {
  const v = Number((d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  for (let i = v; i < MIGRATIONS.length; i++) {
    d.exec('BEGIN');
    try {
      d.exec(MIGRATIONS[i]);
      d.exec(`PRAGMA user_version = ${i + 1}`);
      d.exec('COMMIT');
      log('info', `Datenbank auf Version ${i + 1} aktualisiert`);
    } catch (e) { d.exec('ROLLBACK'); throw e; }
  }
  const count = (d.prepare('SELECT COUNT(*) AS n FROM profiles').get() as { n: number }).n;
  if (!count) d.prepare('INSERT INTO profiles (name) VALUES (?)').run(process.env.PRA_DEFAULT_PROFILE || 'Petra');
}

const now = () => new Date().toISOString();
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

// ---------------- Profile ----------------
export function listProfiles(): Profile[] {
  return (openDb().prepare('SELECT id, name, created_at AS createdAt FROM profiles ORDER BY id').all() as unknown as Profile[]);
}
export function createProfile(name: string): Profile {
  const r = openDb().prepare('INSERT INTO profiles (name) VALUES (?)').run(name.trim().slice(0, 60));
  return listProfiles().find((p) => p.id === Number(r.lastInsertRowid))!;
}
export function renameProfile(id: number, name: string): void {
  openDb().prepare('UPDATE profiles SET name = ? WHERE id = ?').run(name.trim().slice(0, 60), id);
}
export function deleteProfile(id: number): void {
  if (listProfiles().length <= 1) throw Object.assign(new Error('Das letzte Profil kann nicht gelöscht werden.'), { status: 400 });
  const d = openDb();
  d.prepare('DELETE FROM recipes WHERE profile_id = ?').run(id);
  d.prepare('DELETE FROM settings WHERE profile_id = ?').run(id);
  d.prepare('DELETE FROM drafts WHERE profile_id = ?').run(id);
  d.prepare('DELETE FROM profiles WHERE id = ?').run(id);
}
export function getMeta(key: string): string | null {
  const r = openDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value ?? null;
}
export function setMeta(key: string, value: string): void {
  openDb().prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
export function currentProfileId(): number {
  const id = Number(getMeta('currentProfile'));
  const profiles = listProfiles();
  return profiles.some((p) => p.id === id) ? id : profiles[0].id;
}

// ---------------- Rezepte ----------------
function summary(row: Record<string, unknown>): RecipeSummary {
  const data = JSON.parse(String(row.data)) as Recipe;
  return {
    id: Number(row.id), title: String(row.title), category: row.category as Category, favorite: Boolean(row.favorite),
    photo: data.photo ? `/api/recipes/${row.id}/photo?v=${encodeURIComponent(String(row.updated_at))}` : null,
    totalTime: data.totalTime ?? ((data.prepTime ?? 0) + (data.cookTime ?? 0) + (data.restTime ?? 0) || null),
    servings: data.servings, cookidooStatus: row.cookidoo_status as RecipeSummary['cookidooStatus'],
    updatedAt: String(row.updated_at), createdAt: String(row.created_at),
  };
}

function searchText(r: Recipe): string {
  return norm([r.title, r.description, r.category, r.notes, ...r.ingredients.map((i) => i.name), ...r.steps.map((s) => s.text)].join(' '));
}

export function sanitizeRecipe(input: Recipe, profileId: number): Recipe {
  const r: Recipe = JSON.parse(JSON.stringify(input));
  r.title = String(r.title ?? '').trim().slice(0, 200);
  if (!r.title) throw Object.assign(new Error('Das Rezept braucht einen Namen.'), { status: 400 });
  if (!CATEGORIES.includes(r.category)) r.category = 'Sonstiges';
  r.profileId = profileId;
  r.ingredients = Array.isArray(r.ingredients) ? r.ingredients.slice(0, 300) : [];
  r.steps = Array.isArray(r.steps) ? r.steps.slice(0, 300) : [];
  r.notes = String(r.notes ?? '').slice(0, 20000);
  r.description = String(r.description ?? '').slice(0, 5000);
  if (r.photo && (!/^data:image\/(jpeg|png|webp);base64,/.test(r.photo) || r.photo.length > 3_000_000)) r.photo = null;
  for (const k of ['servings', 'prepTime', 'cookTime', 'restTime', 'totalTime'] as const) {
    const v = r[k]; r[k] = v == null || v === ('' as unknown) || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v)));
  }
  r.cookidoo ??= { status: 'offen' };
  r.source ??= { type: 'manual', name: '' };
  return r;
}

export interface ListQuery { q?: string; category?: string; favorite?: boolean; sort?: 'neu' | 'name' | 'geändert'; limit?: number }

export function listRecipes(profileId: number, q: ListQuery = {}): RecipeSummary[] {
  const where = ['profile_id = ?', 'deleted_at IS NULL'];
  const args: (string | number)[] = [profileId];
  if (q.category) { where.push('category = ?'); args.push(q.category); }
  if (q.favorite) where.push('favorite = 1');
  const order = q.sort === 'name' ? 'title COLLATE NOCASE ASC' : q.sort === 'geändert' ? 'updated_at DESC' : 'created_at DESC';
  let rows = openDb().prepare(`SELECT * FROM recipes WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(...args) as Record<string, unknown>[];
  if (q.q?.trim()) {
    const words = norm(q.q).split(/\s+/).filter(Boolean);
    rows = rows.filter((r) => words.every((w) => String(r.search).includes(w)));
  }
  if (q.limit) rows = rows.slice(0, q.limit);
  return rows.map(summary);
}

function rowById(profileId: number, id: number, includeDeleted = false) {
  const row = openDb().prepare(`SELECT * FROM recipes WHERE id = ? AND profile_id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`).get(id, profileId) as Record<string, unknown> | undefined;
  if (!row) throw Object.assign(new Error('Rezept nicht gefunden.'), { status: 404 });
  return row;
}

export function getRecipe(profileId: number, id: number): Recipe {
  const row = rowById(profileId, id);
  const r = JSON.parse(String(row.data)) as Recipe;
  return { ...r, id: Number(row.id), favorite: Boolean(row.favorite), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function findDuplicates(profileId: number, r: Pick<Recipe, 'title' | 'ingredients'>, exceptId?: number | null): RecipeSummary[] {
  const fp = fingerprint(r);
  const titleKey = fp.split('#')[0];
  const rows = openDb().prepare('SELECT * FROM recipes WHERE profile_id = ? AND deleted_at IS NULL').all(profileId) as Record<string, unknown>[];
  return rows
    .filter((row) => Number(row.id) !== exceptId && (row.fingerprint === fp || String(row.fingerprint).split('#')[0] === titleKey))
    .map(summary);
}

export function saveRecipe(profileId: number, input: Recipe): Recipe {
  const r = sanitizeRecipe(input, profileId);
  const d = openDb();
  const t = now();
  const data = JSON.stringify({ ...r, id: undefined, createdAt: undefined, updatedAt: undefined });
  const cols = [r.title, r.category, r.favorite ? 1 : 0, fingerprint(r), searchText(r), r.cookidoo?.status ?? 'offen', data];
  if (r.id) {
    rowById(profileId, r.id);
    d.prepare('UPDATE recipes SET title=?, category=?, favorite=?, fingerprint=?, search=?, cookidoo_status=?, data=?, updated_at=? WHERE id=? AND profile_id=?')
      .run(...cols, t, r.id, profileId);
    return getRecipe(profileId, r.id);
  }
  const res = d.prepare('INSERT INTO recipes (profile_id, title, category, favorite, fingerprint, search, cookidoo_status, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(profileId, ...cols, t, t);
  return getRecipe(profileId, Number(res.lastInsertRowid));
}

export function setFavorite(profileId: number, id: number, favorite: boolean): void {
  const r = getRecipe(profileId, id);
  saveRecipe(profileId, { ...r, favorite });
}

export function deleteRecipe(profileId: number, id: number): void {
  rowById(profileId, id);
  openDb().prepare('UPDATE recipes SET deleted_at = ? WHERE id = ? AND profile_id = ?').run(now(), id, profileId);
}
export function restoreRecipe(profileId: number, id: number): void {
  rowById(profileId, id, true);
  openDb().prepare('UPDATE recipes SET deleted_at = NULL WHERE id = ? AND profile_id = ?').run(id, profileId);
}
export function purgeRecipe(profileId: number, id: number): void {
  openDb().prepare('DELETE FROM recipes WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL').run(id, profileId);
}
export function listTrash(profileId: number): RecipeSummary[] {
  return (openDb().prepare('SELECT * FROM recipes WHERE profile_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC').all(profileId) as Record<string, unknown>[]).map(summary);
}
/** Papierkorb nach 30 Tagen leeren */
export function cleanupTrash(days = 30): void {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  openDb().prepare('DELETE FROM recipes WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff);
}

export function duplicateRecipe(profileId: number, id: number): Recipe {
  const r = getRecipe(profileId, id);
  return saveRecipe(profileId, { ...r, id: null, title: `${r.title} (Kopie)`, favorite: false, cookidoo: { status: 'offen' } });
}

export function stats(profileId: number) {
  const d = openDb();
  const byCat = d.prepare('SELECT category, COUNT(*) AS n FROM recipes WHERE profile_id = ? AND deleted_at IS NULL GROUP BY category').all(profileId) as { category: string; n: number }[];
  const total = byCat.reduce((s, c) => s + Number(c.n), 0);
  const fav = (d.prepare('SELECT COUNT(*) AS n FROM recipes WHERE profile_id = ? AND deleted_at IS NULL AND favorite = 1').get(profileId) as { n: number }).n;
  const transferred = (d.prepare(`SELECT COUNT(*) AS n FROM recipes WHERE profile_id = ? AND deleted_at IS NULL AND cookidoo_status = 'übertragen'`).get(profileId) as { n: number }).n;
  return { total, favorites: Number(fav), transferred: Number(transferred), byCategory: Object.fromEntries(byCat.map((c) => [c.category, Number(c.n)])) };
}

export function getPhoto(profileId: number, id: number): string | null {
  return getRecipe(profileId, id).photo;
}

// ---------------- Entwurf (Autosave) ----------------
export function saveDraft(profileId: number, data: unknown): void {
  const json = JSON.stringify(data);
  if (json.length > 4_000_000) throw Object.assign(new Error('Entwurf zu groß'), { status: 413 });
  openDb().prepare('INSERT INTO drafts (profile_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(profileId, json, now());
}
export function getDraft(profileId: number): { data: unknown; updatedAt: string } | null {
  const r = openDb().prepare('SELECT data, updated_at FROM drafts WHERE profile_id = ?').get(profileId) as { data: string; updated_at: string } | undefined;
  return r ? { data: JSON.parse(r.data), updatedAt: r.updated_at } : null;
}
export function clearDraft(profileId: number): void {
  openDb().prepare('DELETE FROM drafts WHERE profile_id = ?').run(profileId);
}

// ---------------- Einstellungen ----------------
export interface Settings {
  experimentalTransfer: boolean;
  cookidooUrl: string;
  aiEnabled: boolean;
  aiModel: string;
  autoBackup: boolean;
  onboardingDone: boolean;
  bookmarkletInstalled: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  experimentalTransfer: false,
  cookidooUrl: 'https://cookidoo.de/created-recipes/de-DE',
  aiEnabled: false,
  aiModel: 'claude-opus-5-5',
  autoBackup: true,
  onboardingDone: false,
  bookmarkletInstalled: false,
};

export function getSettings(profileId: number): Settings {
  const rows = openDb().prepare('SELECT key, value FROM settings WHERE profile_id = ?').all(profileId) as { key: string; value: string }[];
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) { try { s[r.key] = JSON.parse(r.value); } catch { /* ignorieren */ } }
  return s as unknown as Settings;
}

export function updateSettings(profileId: number, patch: Partial<Settings>): Settings {
  const d = openDb();
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS) || typeof v !== typeof DEFAULT_SETTINGS[k as keyof Settings]) continue;
    if (k === 'cookidooUrl' && !/^https:\/\/cookidoo\.[a-z.]+\//i.test(String(v))) continue;
    d.prepare('INSERT INTO settings (profile_id, key, value) VALUES (?, ?, ?) ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value')
      .run(profileId, k, JSON.stringify(v));
  }
  return getSettings(profileId);
}

/** Geheimnisse (verschlüsselt) – global, nicht pro Profil */
export function getSecret(key: string): string | null { return getMeta(`secret:${key}`); }
export function setSecret(key: string, value: string | null): void {
  if (value == null) openDb().prepare('DELETE FROM meta WHERE key = ?').run(`secret:${key}`);
  else setMeta(`secret:${key}`, value);
}
