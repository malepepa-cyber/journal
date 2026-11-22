/**
 * Sichere Ablage von Geheimnissen (z. B. KI-API-Schlüssel).
 * Windows: Windows-Datenschutz-API (DPAPI, an das Windows-Benutzerkonto gebunden) über PowerShell.
 * Andere Systeme (nur Entwicklung): AES-256-GCM mit zufälligem Schlüssel in einer nur für den
 * Benutzer lesbaren Datei.
 * Der Klartext verlässt den lokalen Dienst nie Richtung Oberfläche.
 */
import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.ts';
import { getSecret, setSecret } from './db.ts';

function ps(script: string, input: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { input, encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
}

const PS_PROTECT = `Add-Type -AssemblyName System.Security; $t=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($t); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))`;
const PS_UNPROTECT = `Add-Type -AssemblyName System.Security; $t=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($t); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))`;

function localKey(): Buffer {
  const f = join(dataDir(), '.schluessel');
  if (!existsSync(f)) { writeFileSync(f, randomBytes(32).toString('base64'), { mode: 0o600 }); try { chmodSync(f, 0o600); } catch { /* Windows */ } }
  return Buffer.from(readFileSync(f, 'utf8'), 'base64');
}

export function encrypt(plain: string): string {
  if (process.platform === 'win32') return `dpapi:${ps(PS_PROTECT, plain)}`;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', localKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `aes:${Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')}`;
}

export function decrypt(stored: string): string {
  if (stored.startsWith('dpapi:')) return ps(PS_UNPROTECT, stored.slice(6));
  if (stored.startsWith('aes:')) {
    const b = Buffer.from(stored.slice(4), 'base64');
    const d = createDecipheriv('aes-256-gcm', localKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  }
  throw new Error('Unbekanntes Format');
}

export function storeApiKey(key: string | null): void {
  setSecret('aiKey', key ? encrypt(key.trim()) : null);
}
export function hasApiKey(): boolean { return !!getSecret('aiKey'); }
export function readApiKey(): string | null {
  const s = getSecret('aiKey');
  return s ? decrypt(s) : null;
}
