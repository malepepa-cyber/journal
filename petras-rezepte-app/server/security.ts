/**
 * Schutz des lokalen Dienstes:
 * - lauscht nur auf 127.0.0.1 (kein Zugriff aus dem Netzwerk)
 * - Host-Prüfung gegen DNS-Rebinding
 * - Origin-Prüfung: fremde Webseiten im Browser dürfen keine Anfragen stellen
 * - zufälliger Sitzungsschlüssel pro Programmstart (wird beim Öffnen an Chrome übergeben)
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const SESSION_TOKEN = process.env.PRA_TOKEN || randomBytes(24).toString('base64url');

export function hostAllowed(req: IncomingMessage, port: number): boolean {
  const host = String(req.headers.host || '').toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function originAllowed(req: IncomingMessage, port: number): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // gleiche Herkunft (Navigation) oder kein Browser
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

export function tokenOk(given: string | undefined | null): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(SESSION_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self' data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};
