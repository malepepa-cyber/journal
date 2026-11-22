/**
 * Datensicherung: komplette Kopie der Datenbank (SQLite „VACUUM INTO“, konsistent auch im Betrieb).
 * Automatisch höchstens einmal pro Tag beim Start, manuell jederzeit. Die letzten 20 bleiben erhalten.
 * Wiederherstellen legt vorher selbst eine Sicherung an – es geht also nie etwas verloren.
 */
import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { closeDb, dbPath, getMeta, openDb, setMeta } from './db.ts';
import { dataDir } from './paths.ts';
import { log } from './log.ts';

const KEEP = 20;
const dir = () => join(dataDir(), 'backups');
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');

export interface BackupInfo { name: string; size: number; createdAt: string; kind: 'auto' | 'manuell' | 'vor-wiederherstellung' }

export function createBackup(kind: BackupInfo['kind'] = 'manuell'): BackupInfo {
  const name = `sicherung-${stamp()}-${kind}.db`;
  const target = join(dir(), name);
  openDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  setMeta('lastBackup', new Date().toISOString());
  prune();
  log('info', `Sicherung erstellt (${kind})`);
  return info(name)!;
}

function info(name: string): BackupInfo | null {
  const p = join(dir(), name);
  if (!existsSync(p)) return null;
  const st = statSync(p);
  const kind = (name.match(/-(auto|manuell|vor-wiederherstellung)\.db$/)?.[1] ?? 'manuell') as BackupInfo['kind'];
  return { name, size: st.size, createdAt: st.mtime.toISOString(), kind };
}

export function listBackups(): BackupInfo[] {
  return readdirSync(dir()).filter((f) => /^sicherung-.*\.db$/.test(f)).map(info).filter((x): x is BackupInfo => !!x)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function prune() {
  for (const b of listBackups().slice(KEEP)) rmSync(join(dir(), b.name), { force: true });
}

export function autoBackupIfDue(): void {
  try {
    const last = getMeta('lastBackup');
    if (!last || Date.now() - Date.parse(last) > 24 * 3600_000) createBackup('auto');
  } catch (e) { log('error', 'Automatische Sicherung fehlgeschlagen', e); }
}

export function restoreBackup(name: string): void {
  const safe = basename(name);
  const src = join(dir(), safe);
  if (!/^sicherung-.*\.db$/.test(safe) || !existsSync(src)) throw Object.assign(new Error('Sicherung nicht gefunden.'), { status: 404 });
  // Prüfen, ob die Datei eine gültige Datenbank ist
  const test = new DatabaseSync(src, { readOnly: true });
  try { test.prepare('SELECT COUNT(*) FROM recipes').get(); } finally { test.close(); }
  createBackup('vor-wiederherstellung');
  closeDb();
  for (const ext of ['-wal', '-shm']) rmSync(dbPath() + ext, { force: true });
  copyFileSync(src, dbPath());
  openDb();
  log('info', 'Sicherung wiederhergestellt');
}
