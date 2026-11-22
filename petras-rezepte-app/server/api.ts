/** HTTP-Schnittstelle des lokalen Dienstes (nur für die eigene Oberfläche). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as db from './db.ts';
import { createBackup, listBackups, restoreBackup } from './backup.ts';
import { hasApiKey, storeApiKey } from './secrets.ts';
import { structureWithAi } from './ai.ts';
import { log } from './log.ts';
import { APP_VERSION, dataDir } from './paths.ts';
import { bookmarkletSource } from './bookmarklet.ts';
import type { Recipe } from '../shared/model.ts';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

type Handler = (ctx: Ctx) => unknown | Promise<unknown>;
interface Ctx { req: IncomingMessage; res: ServerResponse; params: Record<string, string>; query: URLSearchParams; body: () => Promise<any>; profileId: number }
interface Route { method: string; re: RegExp; keys: string[]; handler: Handler }

const routes: Route[] = [];
function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  routes.push({ method, re, keys, handler });
}

const MAX_BODY = 8 * 1024 * 1024;
async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Die Daten sind zu groß.');
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Ungültige Daten.'); }
}

const id = (p: Record<string, string>) => {
  const n = Number(p.id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Ungültige Nummer.');
  return n;
};

// ---------- Heartbeat (für automatisches Beenden) ----------
export let lastHeartbeat = Date.now();
export const shutdownRequested = { value: false };

// ---------- Sitzung & Profile ----------
route('GET', '/api/session', ({ profileId }) => ({
  version: APP_VERSION, dataDir: dataDir(), profileId,
  profiles: db.listProfiles(), settings: db.getSettings(profileId), aiKey: hasApiKey(),
}));
route('POST', '/api/heartbeat', () => { lastHeartbeat = Date.now(); return { ok: true }; });
route('POST', '/api/shutdown', () => { shutdownRequested.value = true; return { ok: true }; });
route('POST', '/api/profiles', async ({ body }) => {
  const { name } = await body();
  if (!String(name ?? '').trim()) throw new HttpError(400, 'Bitte einen Namen angeben.');
  return db.createProfile(String(name));
});
route('POST', '/api/profiles/:id/select', ({ params }) => {
  const pid = id(params);
  if (!db.listProfiles().some((p) => p.id === pid)) throw new HttpError(404, 'Profil nicht gefunden.');
  db.setMeta('currentProfile', String(pid)); return { ok: true };
});
route('PATCH', '/api/profiles/:id', async ({ params, body }) => { db.renameProfile(id(params), String((await body()).name ?? '')); return { ok: true }; });
route('DELETE', '/api/profiles/:id', ({ params }) => { db.deleteProfile(id(params)); return { ok: true }; });

// ---------- Rezepte ----------
route('GET', '/api/recipes', ({ profileId, query }) => db.listRecipes(profileId, {
  q: query.get('q') ?? undefined, category: query.get('category') ?? undefined,
  favorite: query.get('favorite') === '1', sort: (query.get('sort') as db.ListQuery['sort']) ?? 'neu',
  limit: query.get('limit') ? Number(query.get('limit')) : undefined,
}));
route('GET', '/api/stats', ({ profileId }) => db.stats(profileId));
route('POST', '/api/recipes/duplicates', async ({ profileId, body }) => {
  const b = await body();
  return db.findDuplicates(profileId, { title: String(b.title ?? ''), ingredients: Array.isArray(b.ingredients) ? b.ingredients : [] }, b.id ?? null);
});
route('GET', '/api/recipes/:id', ({ profileId, params }) => db.getRecipe(profileId, id(params)));
route('GET', '/api/recipes/:id/photo', ({ profileId, params, res }) => {
  const photo = db.getPhoto(profileId, id(params));
  if (!photo) throw new HttpError(404, 'Kein Foto.');
  const m = photo.match(/^data:(image\/[a-z]+);base64,(.*)$/)!;
  res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=86400' });
  res.end(Buffer.from(m[2], 'base64'));
  return undefined;
});
route('POST', '/api/recipes', async ({ profileId, body }) => db.saveRecipe(profileId, { ...(await body() as Recipe), id: null }));
route('PUT', '/api/recipes/:id', async ({ profileId, params, body }) => db.saveRecipe(profileId, { ...(await body() as Recipe), id: id(params) }));
route('PATCH', '/api/recipes/:id/favorite', async ({ profileId, params, body }) => { db.setFavorite(profileId, id(params), Boolean((await body()).favorite)); return { ok: true }; });
route('PATCH', '/api/recipes/:id/cookidoo', async ({ profileId, params, body }) => {
  const b = await body();
  const r = db.getRecipe(profileId, id(params));
  const status = ['offen', 'in Arbeit', 'übertragen'].includes(b.status) ? b.status : 'offen';
  return db.saveRecipe(profileId, { ...r, cookidoo: { status, at: new Date().toISOString(), url: typeof b.url === 'string' ? b.url.slice(0, 300) : r.cookidoo?.url ?? null } });
});
route('POST', '/api/recipes/:id/duplicate', ({ profileId, params }) => db.duplicateRecipe(profileId, id(params)));
route('DELETE', '/api/recipes/:id', ({ profileId, params }) => { db.deleteRecipe(profileId, id(params)); return { ok: true }; });
route('GET', '/api/trash', ({ profileId }) => db.listTrash(profileId));
route('POST', '/api/trash/:id/restore', ({ profileId, params }) => { db.restoreRecipe(profileId, id(params)); return { ok: true }; });
route('DELETE', '/api/trash/:id', ({ profileId, params }) => { db.purgeRecipe(profileId, id(params)); return { ok: true }; });

// ---------- Export / Import ----------
route('GET', '/api/export', ({ profileId, query, res }) => {
  const ids = query.get('ids')?.split(',').map(Number).filter(Boolean);
  const list = (ids?.length ? ids : db.listRecipes(profileId).map((r) => r.id)).map((rid) => db.getRecipe(profileId, rid));
  const payload = JSON.stringify({ format: 'petras-rezepte-app', version: 1, exportedAt: new Date().toISOString(), recipes: list }, null, 2);
  const name = list.length === 1 ? list[0].title.replace(/[^\wäöüÄÖÜß -]+/g, '').slice(0, 60) || 'rezept' : `rezepte-${new Date().toISOString().slice(0, 10)}`;
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}.json` });
  res.end(payload);
  return undefined;
});
route('POST', '/api/import', async ({ profileId, body }) => {
  const b = await body();
  const list: Recipe[] = Array.isArray(b?.recipes) ? b.recipes : Array.isArray(b) ? b : [];
  if (!list.length) throw new HttpError(400, 'Die Datei enthält keine Rezepte.');
  let imported = 0, skipped = 0;
  for (const r of list.slice(0, 2000)) {
    try {
      if (db.findDuplicates(profileId, r).some((d) => d.title.toLowerCase() === String(r.title).toLowerCase()) && !b.allowDuplicates) { skipped++; continue; }
      db.saveRecipe(profileId, { ...r, id: null }); imported++;
    } catch { skipped++; }
  }
  return { imported, skipped };
});

// ---------- Entwurf ----------
route('GET', '/api/draft', ({ profileId }) => db.getDraft(profileId));
route('PUT', '/api/draft', async ({ profileId, body }) => { db.saveDraft(profileId, await body()); return { ok: true }; });
route('DELETE', '/api/draft', ({ profileId }) => { db.clearDraft(profileId); return { ok: true }; });

// ---------- Einstellungen ----------
route('PUT', '/api/settings', async ({ profileId, body }) => db.updateSettings(profileId, await body()));
route('PUT', '/api/ai/key', async ({ body }) => {
  const k = String((await body()).key ?? '').trim();
  if (k && !/^sk-ant-[\w-]{20,}$/.test(k)) throw new HttpError(400, 'Das sieht nicht wie ein Claude-API-Schlüssel aus (beginnt mit „sk-ant-“).');
  storeApiKey(k || null);
  return { aiKey: !!k };
});
route('POST', '/api/ai/structure', async ({ profileId, body }) => {
  const s = db.getSettings(profileId);
  if (!s.aiEnabled) throw new HttpError(400, 'Die KI-Unterstützung ist ausgeschaltet.');
  return structureWithAi(String((await body()).text ?? ''), s.aiModel);
});

// ---------- Sicherungen ----------
route('GET', '/api/backups', () => listBackups());
route('POST', '/api/backups', () => createBackup('manuell'));
route('POST', '/api/backups/restore', async ({ body }) => { restoreBackup(String((await body()).name ?? '')); return { ok: true }; });

// ---------- Cookidoo-Helfer (Lesezeichen) ----------
route('GET', '/api/bookmarklet', () => ({ code: bookmarkletSource() }));

// ---------- Fehler aus der Oberfläche protokollieren ----------
route('POST', '/api/log', async ({ body }) => {
  const b = await body();
  log('error', `Oberfläche: ${String(b.message ?? '').slice(0, 300)}`, b.where ? String(b.where).slice(0, 200) : undefined);
  return { ok: true };
});

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const r = routes.find((x) => x.method === method && x.re.test(url.pathname));
  if (!r) throw new HttpError(404, 'Unbekannte Anfrage.');
  const m = url.pathname.match(r.re)!;
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  let cached: Promise<any> | null = null;
  const result = await r.handler({ req, res, params, query: url.searchParams, body: () => (cached ??= readJson(req)), profileId: db.currentProfileId() });
  if (result === undefined && res.headersSent) return;
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(result ?? null));
}
