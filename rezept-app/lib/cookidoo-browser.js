// Speichert ein Rezept direkt aus dem Browser – läuft AUF cookidoo.de
// (als Lesezeichen-Helfer), nutzt also die bestehende Anmeldung im Browser.
// Kein Passwort nötig, kein Server.
import { buildInstructions, buildMeta } from './cookidoo-format.js';

const FULL = 'application/vnd.vorwerk.customer-recipe.full+json';

/** Sprach-/Marktkennung aus der aktuellen Cookidoo-Adresse, z. B. "de-DE". */
export function detectLanguage(loc = globalThis.location) {
  const m = String(loc?.pathname || '').match(/\/([a-z]{2}-[A-Z]{2})(?:\/|$)/);
  if (m) return m[1];
  const host = String(loc?.hostname || '');
  if (host.endsWith('.at')) return 'de-AT';
  if (host.endsWith('.ch')) return 'de-CH';
  return 'de-DE';
}

async function req(method, path, body, accept = FULL) {
  const headers = { Accept: accept };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(path, {
    method, credentials: 'include', headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : undefined; } catch { j = t; }
  if (!r.ok) {
    const e = new Error(r.status === 401 || r.status === 403
      ? 'Nicht bei Cookidoo angemeldet – bitte erst auf cookidoo.de einloggen.'
      : `Cookidoo-Fehler ${r.status}`);
    e.status = r.status; e.body = j;
    throw e;
  }
  return j;
}

/**
 * Legt das Rezept unter "Meine Kreationen" an. Thermomix-Einstellungen werden
 * stufenweise vorsichtiger übertragen, falls Cookidoo eine Variante ablehnt.
 */
export async function saveRecipeInBrowser(recipe, lang = detectLanguage()) {
  const base = `/created-recipes/${lang}`;
  const created = await req('POST', base, { recipeName: recipe.title.trim() }, 'application/json');
  const id = created?.recipeId;
  if (!id) throw Object.assign(new Error('Cookidoo hat keine Rezept-ID geliefert'), { body: created });
  const path = `${base}/${encodeURIComponent(id)}`;
  await req('PATCH', path, buildMeta(recipe));
  const attempts = [];
  let previous = null;
  for (const level of [0, 1, 2]) {
    const { steps, stats } = buildInstructions(recipe.steps, level);
    const json = JSON.stringify(steps);
    if (json === previous) continue;
    previous = json;
    try {
      await req('PATCH', path, { instructions: steps });
      return { recipeId: id, level, stats, attempts, url: `${location.origin}${path}` };
    } catch (e) {
      attempts.push({ level, status: e.status, body: e.body });
      if (e.status && e.status !== 400 && e.status !== 422) break;
    }
  }
  const err = new Error('Rezept wurde angelegt, aber die Arbeitsschritte konnten nicht gespeichert werden.');
  err.body = { recipeId: id, attempts };
  throw err;
}
