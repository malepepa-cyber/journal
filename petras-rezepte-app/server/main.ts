/**
 * Petras Rezepte App – lokaler Dienst.
 * Startet einen kleinen Webserver auf 127.0.0.1, öffnet die Oberfläche in Chrome und beendet sich
 * automatisch, wenn das App-Fenster länger geschlossen ist.
 * © Patrick S.
 */
import './quiet.ts';
import http from 'node:http';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleApi, HttpError, lastHeartbeat, shutdownRequested } from './api.ts';
import { readAsset, isPackaged } from './assets.ts';
import { autoBackupIfDue } from './backup.ts';
import { cleanupTrash, closeDb, getSettings, currentProfileId, openDb } from './db.ts';
import { openApp } from './launcher.ts';
import { log } from './log.ts';
import { APP_VERSION, dataDir } from './paths.ts';
import { hostAllowed, originAllowed, SECURITY_HEADERS, SESSION_TOKEN, tokenOk } from './security.ts';

const args = new Set(process.argv.slice(2));
const DEV = args.has('--dev');
const NO_BROWSER = args.has('--no-browser') || DEV || !!process.env.PRA_NO_BROWSER;
const IDLE_LIMIT_MS = Number(process.env.PRA_IDLE_MINUTES ?? 20) * 60_000;
const PORTS = process.env.PRA_PORT ? [Number(process.env.PRA_PORT)] : [47123, 47124, 47125, 47126, 47127, 0];
const LOCK = () => join(dataDir(), 'laeuft.json');

if (isPackaged()) process.env.PRA_PACKAGED = '1';

function appUrl(port: number, token: string) { return `http://127.0.0.1:${port}/#t=${token}`; }

/** Läuft die App schon? Dann nur das Fenster öffnen. */
async function existingInstance(): Promise<boolean> {
  if (!existsSync(LOCK())) return false;
  try {
    const { port, token } = JSON.parse(readFileSync(LOCK(), 'utf8'));
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (r.ok && (await r.json()).app === 'petras-rezepte-app') {
      if (!NO_BROWSER) openApp(appUrl(port, token));
      return true;
    }
  } catch { /* alte Sperrdatei */ }
  return false;
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: message }));
}

function createServer(getPort: () => number) {
  return http.createServer(async (req, res) => {
    const port = getPort();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    try {
      if (!hostAllowed(req, port)) return sendError(res, 403, 'Nicht erlaubt.');
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);

      if (url.pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ app: 'petras-rezepte-app', version: APP_VERSION }));
      }
      if (url.pathname.startsWith('/api/')) {
        if (!originAllowed(req, port)) return sendError(res, 403, 'Nicht erlaubt.');
        const token = (req.headers['x-pra-token'] as string | undefined) ?? (req.method === 'GET' ? url.searchParams.get('t') : null);
        if (!tokenOk(token)) return sendError(res, 401, 'Sitzung abgelaufen – bitte die App über das Desktop-Symbol neu öffnen.');
        return await handleApi(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'Nicht erlaubt.');
      let path = decodeURIComponent(url.pathname);
      if (path === '/' || !/\.[a-z0-9]+$/i.test(path)) path = '/index.html';
      const asset = readAsset(path);
      if (!asset) return sendError(res, 404, 'Nicht gefunden.');
      res.writeHead(200, {
        'Content-Type': asset.type,
        'Cache-Control': /\/assets\/.*-[\w-]{8,}\./.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : asset.data);
    } catch (e: any) {
      const status = e instanceof HttpError ? e.status : Number(e?.status) || 500;
      if (status >= 500) log('error', `Fehler bei ${req.method} ${req.url?.split('?')[0]}`, e);
      sendError(res, status, status >= 500 && !(e instanceof HttpError) && !e?.status ? 'Ein unerwarteter Fehler ist aufgetreten. Details stehen im Fehlerprotokoll.' : e.message);
    }
  });
}

async function listen(server: http.Server): Promise<number> {
  for (const p of PORTS) {
    try {
      await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(p, '127.0.0.1', () => { server.off('error', fail); ok(); }); });
      return (server.address() as { port: number }).port;
    } catch (e: any) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  throw new Error('Kein freier Port gefunden');
}

async function main() {
  if (await existingInstance()) return;
  openDb();
  cleanupTrash();
  if (getSettings(currentProfileId()).autoBackup) autoBackupIfDue();

  let port = 0;
  const server = createServer(() => port);
  port = await listen(server);
  writeFileSync(LOCK(), JSON.stringify({ port, token: SESSION_TOKEN, pid: process.pid }), { mode: 0o600 });
  log('info', `Petras Rezepte App ${APP_VERSION} gestartet auf Port ${port}`);
  if (DEV || !isPackaged()) console.log(`\n  Petras Rezepte App läuft:  ${appUrl(port, SESSION_TOKEN)}\n`);
  if (!NO_BROWSER) openApp(appUrl(port, SESSION_TOKEN));

  const stop = (why: string) => {
    log('info', `Beende (${why})`);
    try { rmSync(LOCK(), { force: true }); } catch { /* egal */ }
    server.close(); closeDb();
    setTimeout(() => process.exit(0), 300).unref();
  };
  // Automatisch beenden, wenn das Fenster lange geschlossen ist (spart Ressourcen)
  setInterval(() => {
    if (shutdownRequested.value) return stop('Beenden gewählt');
    if (!DEV && Date.now() - lastHeartbeat > IDLE_LIMIT_MS) stop('keine Verbindung zur Oberfläche');
  }, 5_000).unref();
  process.on('SIGINT', () => stop('Strg+C'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

process.on('uncaughtException', (e) => log('error', 'Unerwarteter Fehler', e));
process.on('unhandledRejection', (e) => log('error', 'Unbehandelter Fehler', e));
main().catch((e) => { log('error', 'Start fehlgeschlagen', e); console.error(e); process.exit(1); });
