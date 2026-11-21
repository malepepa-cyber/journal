// Rezept-Brücke – kleiner Server
// * liefert die Web-App (Ordner public/) aus
// * nimmt ein geprüftes Rezept entgegen und speichert es über die
//   (inoffizielle) Cookidoo-Schnittstelle unter "Meine Kreationen".
//
// Start:  COOKIDOO_EMAIL=... COOKIDOO_PASSWORD=... APP_PIN=1234 node server.js

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { CookidooClient } from '@recode-software/cookidoo-api';
import { buildInstructions, buildMeta, validateRecipe } from './lib/cookidoo-format.js';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const APP_PIN = process.env.APP_PIN || '';
const COUNTRY = process.env.COOKIDOO_COUNTRY || 'de';
const LANGUAGE = process.env.COOKIDOO_LANGUAGE || 'de-DE';
const BASE_URL = process.env.COOKIDOO_BASE_URL || `https://cookidoo.${COUNTRY}`;
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

if (!process.env.COOKIDOO_EMAIL || !process.env.COOKIDOO_PASSWORD) {
  console.warn('⚠  COOKIDOO_EMAIL / COOKIDOO_PASSWORD fehlen – Hochladen ist deaktiviert.');
}
if (!APP_PIN) console.warn('⚠  APP_PIN ist nicht gesetzt – jeder mit Zugriff auf den Server kann hochladen.');

let client = null;
function getClient() {
  if (!client) {
    client = new CookidooClient({
      email: process.env.COOKIDOO_EMAIL,
      password: process.env.COOKIDOO_PASSWORD,
      country: COUNTRY,
      language: LANGUAGE,
      baseUrl: BASE_URL,
    });
  }
  return client;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function pinOk(req) {
  if (!APP_PIN) return true;
  const given = Buffer.from(String(req.headers['x-app-pin'] || ''));
  const want = Buffer.from(APP_PIN);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function readJson(req, limit = 512 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Anfrage zu groß'), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function errInfo(e) {
  return {
    message: e?.message || String(e),
    status: e?.status,
    body: typeof e?.body === 'string' ? e.body.slice(0, 500) : e?.body,
  };
}

// Speichert das Rezept. Die Thermomix-Einstellungen werden stufenweise
// "vorsichtiger" übertragen, falls Cookidoo eine Variante ablehnt:
//   Stufe 0: alles (inkl. experimenteller Werte: Varoma, Sanftrührstufe, Teig, Turbo)
//   Stufe 1: nur sicher bekannte Werte (Varoma → 120 °C, Rest ohne Knopf)
//   Stufe 2: nur Text (keine Knöpfe) – das Rezept ist dann trotzdem gespeichert
async function uploadRecipe(recipe) {
  const c = getClient();
  const created = await c.recipes.create(recipe.title);
  const id = created.recipeId;
  await c.recipes.patchMeta(id, buildMeta(recipe));
  const attempts = [];
  let previous = null;
  for (const level of [0, 1, 2]) {
    const { steps, stats } = buildInstructions(recipe.steps, level);
    const json = JSON.stringify(steps);
    if (json === previous) continue; // gleiche Variante nicht doppelt senden
    previous = json;
    try {
      await c.recipes.patchInstructions(id, steps);
      attempts.push({ level, ok: true, stats });
      return { recipeId: id, level, stats, attempts, url: `${BASE_URL}/created-recipes/${LANGUAGE}/${id}` };
    } catch (e) {
      attempts.push({ level, ok: false, error: errInfo(e), stats });
      if (e?.status && e.status !== 400 && e.status !== 422) break;
    }
  }
  const err = new Error('Rezept wurde angelegt, aber die Arbeitsschritte konnten nicht gespeichert werden.');
  err.status = 502; err.details = { recipeId: id, attempts };
  throw err;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');

    if (url.pathname === '/api/status' && req.method === 'GET') {
      return send(res, 200, {
        ok: true,
        configured: Boolean(process.env.COOKIDOO_EMAIL && process.env.COOKIDOO_PASSWORD),
        pinRequired: Boolean(APP_PIN),
        market: `${BASE_URL} (${LANGUAGE})`,
      });
    }

    if (url.pathname === '/api/check' && req.method === 'POST') {
      if (!pinOk(req)) return send(res, 401, { error: 'Falsche PIN' });
      try {
        const list = await getClient().recipes.list();
        return send(res, 200, { ok: true, recipes: list.length });
      } catch (e) {
        client = null;
        return send(res, 502, { error: 'Anmeldung bei Cookidoo fehlgeschlagen', details: errInfo(e) });
      }
    }

    if (url.pathname === '/api/recipes' && req.method === 'POST') {
      if (!pinOk(req)) return send(res, 401, { error: 'Falsche PIN' });
      if (!process.env.COOKIDOO_EMAIL) return send(res, 503, { error: 'Server hat keine Cookidoo-Zugangsdaten' });
      const recipe = await readJson(req);
      const problems = validateRecipe(recipe);
      if (problems.length) return send(res, 400, { error: problems.join(' ') });
      try {
        const result = await uploadRecipe(recipe);
        console.log(`✓ "${recipe.title}" gespeichert (${result.recipeId}, Stufe ${result.level})`);
        return send(res, 200, result);
      } catch (e) {
        if (e?.status === 401 || e?.name === 'CookidooAuthError') client = null;
        console.error('✗ Upload fehlgeschlagen:', errInfo(e), e.details ? JSON.stringify(e.details) : '');
        return send(res, e.status && e.status >= 400 && e.status < 600 ? e.status : 502,
          { error: e.message, details: e.details || errInfo(e) });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Methode nicht erlaubt');

    // Statische Dateien
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(PUBLIC_DIR, p));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Verboten');
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      return res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      return send(res, 404, 'Nicht gefunden');
    }
  } catch (e) {
    console.error(e);
    return send(res, e.status || 500, { error: e.message || 'Serverfehler' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Rezept-Brücke läuft auf http://localhost:${PORT}  →  ${BASE_URL} (${LANGUAGE})`);
});
