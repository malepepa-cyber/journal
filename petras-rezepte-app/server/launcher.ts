/**
 * Öffnet die App als eigenes Fenster in Google Chrome (--app). Fallback: Microsoft Edge, dann Standardbrowser.
 * Chrome wird mit dem normalen Profil gestartet – so ist Petra dort weiterhin bei Cookidoo angemeldet.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log.ts';

function regAppPath(exe: string): string | null {
  for (const hive of ['HKCU', 'HKLM']) {
    try {
      const out = execFileSync('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, '/ve'],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const m = out.match(/REG_SZ\s+(.+\.exe)/i);
      if (m && existsSync(m[1].trim().replace(/^"|"$/g, ''))) return m[1].trim().replace(/^"|"$/g, '');
    } catch { /* nicht vorhanden */ }
  }
  return null;
}

export function findChrome(): string | null {
  if (process.platform !== 'win32') return null;
  const env = process.env;
  const candidates = [
    regAppPath('chrome.exe'),
    env.PROGRAMFILES && join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['PROGRAMFILES(X86)'] && join(env['PROGRAMFILES(X86)']!, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

function findEdge(): string | null {
  if (process.platform !== 'win32') return null;
  const env = process.env;
  const candidates = [
    regAppPath('msedge.exe'),
    env['PROGRAMFILES(X86)'] && join(env['PROGRAMFILES(X86)']!, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    env.PROGRAMFILES && join(env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

export function openApp(url: string): void {
  const detached = { detached: true, stdio: 'ignore' as const, windowsHide: false };
  try {
    const browser = findChrome() ?? findEdge();
    if (browser) {
      spawn(browser, [`--app=${url}`, '--window-size=1280,860'], detached).unref();
      log('info', `App geöffnet mit ${browser.includes('chrome') ? 'Chrome' : 'Edge'}`);
      return;
    }
    // cmd braucht für „start“ einen (leeren) Fenstertitel; Argumente wörtlich übergeben
    if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], { ...detached, windowsHide: true, windowsVerbatimArguments: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], detached).unref();
    else spawn('xdg-open', [url], detached).unref();
  } catch (e) {
    log('error', 'Browser konnte nicht geöffnet werden', e);
  }
}

/** Erlaubte externe Seiten (werden im normalen Chrome geöffnet, nicht im App-Fenster) */
const EXTERNAL_OK = /^https:\/\/([a-z0-9-]+\.)*(zaubertopf-club\.de|zaubertopf\.de|cookidoo\.(de|at|ch)|firebase\.google\.com|console\.firebase\.google\.com)(\/|$)/i;

export function openExternal(url: string): boolean {
  if (!EXTERNAL_OK.test(url)) return false;
  if (process.env.PRA_NO_BROWSER) return false; // Tests: die Oberfläche öffnet dann selbst
  const detached = { detached: true, stdio: 'ignore' as const };
  try {
    const chrome = findChrome();
    if (chrome) { spawn(chrome, [url], detached).unref(); return true; }
    if (process.platform === 'win32') { spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], { ...detached, windowsHide: true, windowsVerbatimArguments: true }).unref(); return true; }
    return false;
  } catch (e) { log('error', 'Externe Seite konnte nicht geöffnet werden', e); return false; }
}
