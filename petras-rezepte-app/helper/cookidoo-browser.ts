/**
 * EXPERIMENTELL – nur wenn in der App ausdrücklich eingeschaltet.
 * Läuft auf cookidoo.de in Petras angemeldetem Browser und nutzt dieselbe Schnittstelle wie die
 * Cookidoo-Webseite selbst. Kein Passwort, kein fremder Server, 3–5 Anfragen pro Rezept.
 */
import type { Recipe } from '../shared/model.ts';
import { buildInstructions, buildMeta } from '../shared/cookidoo.ts';

const FULL = 'application/vnd.vorwerk.customer-recipe.full+json';

export function detectLanguage(loc: Location = location): string {
  const m = loc.pathname.match(/\/([a-z]{2}-[A-Z]{2})(?:\/|$)/);
  if (m) return m[1];
  if (loc.hostname.endsWith('.at')) return 'de-AT';
  if (loc.hostname.endsWith('.ch')) return 'de-CH';
  return 'de-DE';
}

async function req(method: string, path: string, body?: unknown, accept = FULL) {
  const headers: Record<string, string> = { Accept: accept };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(path, { method, credentials: 'include', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  let j: any; try { j = t ? JSON.parse(t) : undefined; } catch { j = t; }
  if (!r.ok) {
    const e: any = new Error(r.status === 401 || r.status === 403 ? 'Bitte zuerst bei Cookidoo anmelden.' : `Cookidoo hat mit Fehler ${r.status} geantwortet.`);
    e.status = r.status; e.body = j; throw e;
  }
  return j;
}

export async function saveInCookidoo(recipe: Recipe, lang = detectLanguage()) {
  const base = `/created-recipes/${lang}`;
  const created = await req('POST', base, { recipeName: recipe.title.trim() }, 'application/json');
  const id = created?.recipeId;
  if (!id) throw Object.assign(new Error('Cookidoo hat kein Rezept angelegt.'), { body: created });
  const path = `${base}/${encodeURIComponent(id)}`;
  await req('PATCH', path, buildMeta(recipe));
  let previous = '';
  const attempts: unknown[] = [];
  for (const level of [0, 1, 2]) {
    const { steps, buttons } = buildInstructions(recipe, level);
    const json = JSON.stringify(steps);
    if (json === previous) continue;
    previous = json;
    try {
      await req('PATCH', path, { instructions: steps });
      return { url: `${location.origin}${path}`, level, buttons, steps: steps.length };
    } catch (e: any) {
      attempts.push({ level, status: e.status });
      if (e.status && e.status !== 400 && e.status !== 422) break;
    }
  }
  throw Object.assign(new Error('Das Rezept wurde angelegt, aber die Schritte konnten nicht gespeichert werden. Bitte im Cookidoo-Editor ergänzen.'), { body: attempts });
}
