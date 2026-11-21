// Liest ein Rezept direkt aus der geöffneten Webseite (z. B. Zaubertopf Club).
// Reihenfolge: 1) markierter Text  2) schema.org-Rezeptdaten (JSON-LD)
//              3) bekannte Rezept-Bausteine (itemprop / WP Recipe Maker / Tasty)
//              4) Text des Hauptbereichs → Text-Erkennung
import { parseRecipeText, parseDuration } from '../public/parser.js';

const clean = (s) => String(s ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;| /g, ' ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();

/** "PT1H10M" → 70 (Minuten) */
export function isoMinutes(v) {
  const m = String(v || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!m) { const s = parseDuration(String(v || '')); return s ? Math.round(s / 60) : null; }
  const min = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + Math.round((+m[4] || 0) / 60);
  return min || null;
}

function flattenInstructions(x, out = []) {
  if (!x) return out;
  if (typeof x === 'string') {
    // manchmal alle Schritte in einem String mit Zeilenumbrüchen
    x.split(/\n+/).map(clean).filter(Boolean).forEach((s) => out.push(s));
  } else if (Array.isArray(x)) {
    x.forEach((i) => flattenInstructions(i, out));
  } else if (typeof x === 'object') {
    if (x.itemListElement) flattenInstructions(x.itemListElement, out);
    else if (x.text || x.name) out.push(clean(x.text || x.name));
  }
  return out;
}

function findRecipeNode(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipeNode(n); if (r) return r; } return null; }
  const t = node['@type'];
  if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return node;
  return findRecipeNode(node['@graph']) || findRecipeNode(node.mainEntity) || null;
}

export function fromJsonLd(doc) {
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data; try { data = JSON.parse(s.textContent); } catch { continue; }
    const r = findRecipeNode(data);
    if (!r) continue;
    const yieldRaw = Array.isArray(r.recipeYield) ? r.recipeYield.join(' ') : String(r.recipeYield ?? '');
    const servings = parseInt(yieldRaw.match(/\d+/)?.[0], 10) || null;
    return {
      source: 'Rezeptdaten (schema.org)',
      title: clean(r.name),
      servings,
      prepTime: isoMinutes(r.prepTime),
      totalTime: isoMinutes(r.totalTime),
      ingredients: (r.recipeIngredient || r.ingredients || []).map(clean).filter(Boolean),
      steps: flattenInstructions(r.recipeInstructions),
    };
  }
  return null;
}

const texts = (doc, sel) => [...doc.querySelectorAll(sel)].map((e) => clean(e.innerText ?? e.textContent)).filter(Boolean);

export function fromMarkup(doc) {
  const variants = [
    { ingr: '[itemprop="recipeIngredient"],[itemprop="ingredients"]', steps: '[itemprop="recipeInstructions"] li,[itemprop="recipeInstructions"] p,[itemprop="step"]' },
    { ingr: '.wprm-recipe-ingredient', steps: '.wprm-recipe-instruction-text' },
    { ingr: '.tasty-recipes-ingredients li', steps: '.tasty-recipes-instructions li' },
    { ingr: '[class*="ingredient"] li', steps: '[class*="instruction"] li, [class*="preparation"] li, [class*="step"] li' },
  ];
  for (const v of variants) {
    const ingredients = texts(doc, v.ingr);
    let steps = texts(doc, v.steps);
    if (!steps.length) steps = texts(doc, '[itemprop="recipeInstructions"]').flatMap((t) => t.split(/\n+/));
    if (ingredients.length >= 2 && steps.length >= 1) {
      const title = clean(doc.querySelector('[itemprop="name"], .wprm-recipe-name, h1')?.textContent) || clean(doc.title);
      const meta = parseRecipeText(`${title}\n${texts(doc, '[class*="servings"],[class*="portion"],[class*="time"]').join('\n')}`);
      return { source: 'Rezept-Bausteine der Seite', title, servings: meta.servings, prepTime: meta.prepTime, totalTime: meta.totalTime, ingredients, steps };
    }
  }
  return null;
}

export function fromText(doc) {
  const main = doc.querySelector('article, main, [role="main"]') || doc.body;
  const text = main.innerText ?? main.textContent ?? '';
  const r = parseRecipeText(text);
  const h1 = clean(doc.querySelector('h1')?.textContent);
  if (h1) r.title = h1;
  return { source: 'Text der Seite', ...r };
}

/** Bestes Ergebnis für die aktuelle Seite. */
export function extractRecipeFromDocument(doc = document, win = globalThis) {
  const sel = String(win.getSelection?.() || '').trim();
  if (sel.length > 80) return { source: 'markierter Text', ...parseRecipeText(sel) };
  const candidates = [fromJsonLd(doc), fromMarkup(doc)].filter(Boolean);
  const good = candidates.find((r) => r.ingredients.length && r.steps.length);
  if (good) return good;
  return fromText(doc);
}
