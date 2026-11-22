/**
 * Liefert die Oberfläche aus – in der Windows-EXE aus den eingebetteten Dateien (Node SEA),
 * in der Entwicklung aus web/dist.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sea from 'node:sea';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.json': 'application/json', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg',
};

const packaged = (() => { try { return sea.isSea(); } catch { return false; } })();

function devRoot(): string {
  if (process.env.PRA_WEB_DIR) return process.env.PRA_WEB_DIR;
  // dist/server.cjs → ../web/dist ; server/assets.ts → ../web/dist
  const here = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'web', 'dist');
}

export function isPackaged(): boolean { return packaged; }

export function readAsset(path: string): { data: Buffer; type: string } | null {
  const clean = normalize(path).replace(/^([/\\])+/, '').replace(/\\/g, '/');
  if (clean.startsWith('..')) return null;
  const type = MIME[extname(clean).toLowerCase()] ?? 'application/octet-stream';
  if (packaged) {
    try { return { data: Buffer.from(sea.getAsset(`web/${clean}`) as ArrayBuffer), type }; } catch { return null; }
  }
  const file = join(devRoot(), clean);
  if (!existsSync(file)) return null;
  try { return { data: readFileSync(file), type }; } catch { return null; }
}
