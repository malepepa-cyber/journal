/**
 * Technisches Fehlerprotokoll. Schreibt NIE Rezeptinhalte, Zugangsdaten oder Schlüssel –
 * nur Meldungen und Programmstellen. Datei wird bei 1 MB rotiert.
 */
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.ts';

const SECRET_RE = /(sk-ant-[\w-]+|api[_-]?key["'=:\s]+[\w-]+|password["'=:\s]+\S+|token["'=:\s]+\S+)/gi;

function file() { return join(dataDir(), 'logs', 'app.log'); }

export function log(level: 'info' | 'warn' | 'error', message: string, err?: unknown): void {
  try {
    const f = file();
    if (existsSync(f) && statSync(f).size > 1_000_000) renameSync(f, `${f}.1`);
    let line = `${new Date().toISOString()} [${level}] ${message}`;
    if (err instanceof Error) line += ` | ${err.name}: ${err.message}${err.stack ? ` | ${err.stack.split('\n').slice(1, 4).join(' ').trim()}` : ''}`;
    else if (err != null) line += ` | ${String(err)}`;
    line = line.replace(SECRET_RE, '[entfernt]').slice(0, 2000);
    appendFileSync(f, `${line}\n`);
    if (process.env.PRA_DEBUG || !process.env.PRA_PACKAGED) console[level === 'info' ? 'log' : level](line);
  } catch { /* Protokollieren darf nie die App stoppen */ }
}
