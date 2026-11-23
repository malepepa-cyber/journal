/**
 * Ruft eine ÖFFENTLICHE Rezeptseite ab (für „Link einfügen“).
 * - nur http/https, Standard-Ports, keine Adressen im eigenen Netz (Schutz vor Missbrauch: SSRF)
 * - folgt höchstens 5 Weiterleitungen und prüft jede erneut
 * - höchstens 5 MB, 15 Sekunden, nur HTML
 * - keine Cookies, keine Anmeldung: Inhalte hinter einem Login (z. B. ZauberTopf Club) bleiben
 *   unvollständig – dafür gibt es das Lesezeichen im angemeldeten Chrome.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { APP_VERSION } from './paths.ts';

export class FetchError extends Error { constructor(public status: number, message: string) { super(message); } }

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
    || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new FetchError(400, 'Das ist keine gültige Internetadresse.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchError(400, 'Nur Adressen mit http:// oder https:// sind möglich.');
  if (url.username || url.password) throw new FetchError(400, 'Adressen mit Zugangsdaten sind nicht erlaubt.');
  if (url.port && !['80', '443'].includes(url.port)) throw new FetchError(400, 'Diese Adresse ist nicht erlaubt.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.localhost|.*\.internal)$/i.test(host)) throw new FetchError(400, 'Adressen im eigenen Netz sind nicht erlaubt.');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new FetchError(502, 'Die Website wurde nicht gefunden.'); });
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) throw new FetchError(400, 'Adressen im eigenen Netz sind nicht erlaubt.');
  return url;
}

export async function fetchRecipePage(raw: string): Promise<{ html: string; url: string }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop <= 5; hop++) {
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: { 'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) PetrasRezepteApp/${APP_VERSION}`, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'de-DE,de;q=0.9' },
      });
    } catch {
      throw new FetchError(502, 'Die Seite konnte nicht geladen werden (keine Verbindung oder Zeitüberschreitung).');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location')!, url).toString());
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new FetchError(403, 'Die Website lässt den Abruf nicht zu (Anmeldung nötig oder gesperrt).');
    if (!res.ok) throw new FetchError(502, `Die Website antwortet mit Fehler ${res.status}.`);
    if (!/html/i.test(res.headers.get('content-type') ?? '')) throw new FetchError(415, 'Unter dieser Adresse ist keine Webseite (kein HTML).');
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5 * 1024 * 1024) { await reader.cancel(); throw new FetchError(413, 'Die Seite ist zu groß.'); }
      chunks.push(value);
    }
    return { html: Buffer.concat(chunks).toString('utf8'), url: url.toString() };
  }
  throw new FetchError(502, 'Zu viele Weiterleitungen.');
}

/** Rezeptbild einer öffentlichen Adresse laden (nur Bilder, max. 8 MB) – für die private Rezeptbibliothek. */
export async function fetchImage(raw: string): Promise<{ data: string; type: string }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop <= 5; hop++) {
    let res: Response;
    try {
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': `Mozilla/5.0 PetrasRezepteApp/${APP_VERSION}`, Accept: 'image/*' } });
    } catch { throw new FetchError(502, 'Das Bild konnte nicht geladen werden.'); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = await assertPublicUrl(new URL(res.headers.get('location')!, url).toString()); continue; }
    if (!res.ok) throw new FetchError(502, `Bild nicht verfügbar (${res.status}).`);
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) throw new FetchError(415, 'Unter dieser Adresse ist kein Bild.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new FetchError(413, 'Das Bild ist zu groß.');
    return { data: `data:${type};base64,${buf.toString('base64')}`, type };
  }
  throw new FetchError(502, 'Zu viele Weiterleitungen.');
}
