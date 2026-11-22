/** Plausibilitätsprüfung eines ganzen Rezepts – liefert verständliche Hinweise. */
import type { Recipe } from './model.ts';
import { checkIngredient } from './ingredients.ts';
import { findSettings } from './tm.ts';

export interface Issue {
  level: 'fehler' | 'hinweis';
  where: 'rezept' | 'zutat' | 'schritt';
  index?: number;
  message: string;
}

export function validateRecipe(r: Recipe): Issue[] {
  const out: Issue[] = [];
  if (!r.title.trim()) out.push({ level: 'fehler', where: 'rezept', message: 'Das Rezept braucht einen Namen.' });
  if (r.title.length > 200) out.push({ level: 'fehler', where: 'rezept', message: 'Der Name ist zu lang (max. 200 Zeichen).' });
  if (!r.ingredients.length) out.push({ level: 'hinweis', where: 'rezept', message: 'Es sind keine Zutaten eingetragen.' });
  if (!r.steps.filter((s) => s.text.trim()).length) out.push({ level: 'fehler', where: 'rezept', message: 'Es ist kein Arbeitsschritt eingetragen.' });
  if (r.servings != null && (r.servings < 1 || r.servings > 100)) out.push({ level: 'hinweis', where: 'rezept', message: 'Portionen bitte zwischen 1 und 100 angeben.' });
  for (const k of ['prepTime', 'cookTime', 'restTime', 'totalTime'] as const) {
    const v = r[k];
    if (v != null && (v < 0 || v > 7 * 24 * 60)) out.push({ level: 'hinweis', where: 'rezept', message: 'Eine Zeitangabe ist ungewöhnlich.' });
  }
  if (r.totalTime != null && r.prepTime != null && r.totalTime < r.prepTime) {
    out.push({ level: 'hinweis', where: 'rezept', message: 'Die Gesamtzeit ist kürzer als die Arbeitszeit.' });
  }
  r.ingredients.forEach((i, index) => {
    for (const m of checkIngredient(i)) out.push({ level: m === 'Menge fehlt' ? 'hinweis' : 'hinweis', where: 'zutat', index, message: `${i.name || 'Zutat'}: ${m}` });
  });
  r.steps.forEach((s, index) => {
    for (const set of findSettings(s.text)) {
      for (const w of set.warnings) out.push({ level: 'hinweis', where: 'schritt', index, message: `Schritt ${index + 1}: ${w}` });
    }
    if (s.suggestions.length) out.push({ level: 'hinweis', where: 'schritt', index, message: `Schritt ${index + 1}: Vorschlag noch nicht bestätigt` });
  });
  return out;
}

/** Normalisierter Fingerabdruck zur Erkennung doppelter Rezepte. */
export function fingerprint(r: Pick<Recipe, 'title' | 'ingredients'>): string {
  const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9äöüß]+/g, ' ').trim();
  const ingr = r.ingredients.map((i) => norm(i.name)).filter(Boolean).sort().join('|');
  return `${norm(r.title)}#${ingr}`;
}
