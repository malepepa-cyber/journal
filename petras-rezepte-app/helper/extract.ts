/**
 * Liest ein Rezept direkt aus der geöffneten Webseite (z. B. Zaubertopf Club).
 * Reihenfolge: markierter Text → schema.org-Rezeptdaten (JSON-LD) → bekannte Rezept-Bausteine → Seitentext.
 * Ergebnis ist TEXT, der anschließend in der App mit derselben Erkennung verarbeitet wird.
 */
import { parseDuration } from '../shared/tm.ts';

const clean = (s: unknown) => String(s ?? '')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export function isoMinutes(v: unknown): number | null {
  const m = String(v || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!m) { const s = parseDuration(String(v || '')); return s ? Math.round(s / 60) : null; }
  return (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + Math.round((+m[4] || 0) / 60) || null;
}

function flatten(x: any, out: string[] = []): string[] {
  if (!x) return out;
  if (typeof x === 'string') x.split(/\n+/).map(clean).filter(Boolean).forEach((s) => out.push(s));
  else if (Array.isArray(x)) x.forEach((i) => flatten(i, out));
  else if (typeof x === 'object') {
    if (x['@type'] === 'HowToSection' && x.name) out.push(`${clean(x.name)}:`);
    if (x.itemListElement) flatten(x.itemListElement, out);
    else if (x.text || x.name) out.push(clean(x.text || x.name));
  }
  return out;
}

function findRecipe(node: any): any {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n); if (r) return r; } return null; }
  const t = node['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return node;
  return findRecipe(node['@graph']) || findRecipe(node.mainEntity) || null;
}

function toText(r: { title: string; servings?: string; prep?: number | null; total?: number | null; ingredients: string[]; steps: string[] }): string {
  return [r.title, r.servings ? `${r.servings}` : '', r.prep ? `Arbeitszeit ${r.prep} Min.` : '', r.total ? `Gesamtzeit ${r.total} Min.` : '',
    'Zutaten', ...r.ingredients, 'Zubereitung', ...r.steps.map((s, i) => `${i + 1}. ${s}`)].filter(Boolean).join('\n');
}

export function extractFromDocument(doc: Document, win: Window): { text: string; source: string } {
  const sel = String(win.getSelection?.() || '').trim();
  if (sel.length > 80) return { text: sel, source: 'markierter Text' };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data; try { data = JSON.parse(s.textContent || ''); } catch { continue; }
    const r = findRecipe(data);
    if (!r) continue;
    const y = Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield;
    const servings = y ? (/^\d+$/.test(String(y).trim()) ? `${y} Portionen` : clean(y)) : '';
    const ingredients = (r.recipeIngredient || r.ingredients || []).map(clean).filter(Boolean);
    const steps = flatten(r.recipeInstructions);
    if (ingredients.length && steps.length) {
      return { text: toText({ title: clean(r.name), servings, prep: isoMinutes(r.prepTime), total: isoMinutes(r.totalTime), ingredients, steps }), source: 'Rezeptdaten der Seite' };
    }
  }
  const texts = (sel: string) => [...doc.querySelectorAll(sel)].map((e) => clean((e as HTMLElement).innerText ?? e.textContent)).filter(Boolean);
  for (const v of [
    { i: '[itemprop="recipeIngredient"],[itemprop="ingredients"]', s: '[itemprop="recipeInstructions"] li,[itemprop="recipeInstructions"] p,[itemprop="step"]' },
    { i: '.wprm-recipe-ingredient', s: '.wprm-recipe-instruction-text' },
    { i: '.tasty-recipes-ingredients li', s: '.tasty-recipes-instructions li' },
    { i: '[class*="ingredient"] li', s: '[class*="instruction"] li, [class*="preparation"] li, [class*="step"] li' },
  ]) {
    const ingredients = texts(v.i), steps = texts(v.s);
    if (ingredients.length >= 2 && steps.length >= 1) {
      return { text: toText({ title: clean(doc.querySelector('h1')?.textContent) || doc.title, ingredients, steps }), source: 'Rezept-Bausteine der Seite' };
    }
  }
  const main = (doc.querySelector('article, main, [role="main"]') || doc.body) as HTMLElement;
  const h1 = clean(doc.querySelector('h1')?.textContent);
  return { text: `${h1}\n${main.innerText ?? main.textContent ?? ''}`, source: 'Text der Seite' };
}
