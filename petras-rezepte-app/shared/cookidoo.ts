/**
 * Cookidoo-Format für „Meine Kreationen“.
 *
 * Es gibt KEINE offizielle Cookidoo-API. Dieses Format entspricht dem, was die
 * Cookidoo-Webseite selbst beim Bearbeiten eigener Rezepte sendet (geprüft anhand der
 * MIT-lizenzierten Bibliothek @recode-software/cookidoo-api). Es wird nur für die
 * optionale, standardmäßig ausgeschaltete „Schnellübertragung“ verwendet.
 * Der geführte Assistent braucht es nicht.
 */
import type { Recipe, TmMatch } from './model.ts';
import { findSettings } from './tm.ts';
import { formatIngredient } from './ingredients.ts';
import { ACCESSORIES } from './model.ts';

export interface CookidooMeta {
  name: string;
  ingredients: { type: 'INGREDIENT'; text: string }[];
  yield?: { value: number; unitText: string };
  prepTime?: number;
  totalTime?: number;
}

export interface CookidooStep { type: 'STEP'; text: string; annotations?: unknown[] }

/** Ein Schritt für die Übertragung: Text inkl. Zubehör-Hinweis, ohne doppelte Leerzeichen. */
export function stepText(s: Recipe['steps'][number]): string {
  let t = s.text.replace(/\s+/g, ' ').trim();
  const acc = s.accessories.filter((a) => a !== 'varoma' || !/varoma/i.test(t)).map((a) => ACCESSORIES[a]);
  const missing = acc.filter((a) => !t.toLowerCase().includes(a.toLowerCase()));
  if (missing.length) t += ` (${missing.join(', ')})`;
  return t;
}

export function buildMeta(r: Recipe): CookidooMeta {
  let lastGroup = '';
  const lines: string[] = [];
  for (const i of r.ingredients) {
    if (i.group && i.group !== lastGroup) { lines.push(`– ${i.group} –`); lastGroup = i.group; }
    lines.push(formatIngredient(i));
  }
  const meta: CookidooMeta = { name: r.title.trim(), ingredients: lines.filter(Boolean).map((text) => ({ type: 'INGREDIENT', text })) };
  if (r.servings && r.servings > 0) meta.yield = { value: r.servings, unitText: 'portion' };
  if (r.prepTime) meta.prepTime = r.prepTime * 60;
  const total = r.totalTime ?? ((r.prepTime ?? 0) + (r.cookTime ?? 0) + (r.restTime ?? 0) || null);
  if (total) meta.totalTime = total * 60;
  return meta;
}

/**
 * level 0 = alle Knöpfe inkl. experimenteller Werte (Varoma, Sanftrührstufe, Teig, Turbo, Anbraten)
 * level 1 = nur sicher bekannte Zeit/Temperatur/Stufe-Knöpfe (Varoma → 120 °C)
 * level 2 = nur Text
 */
export function annotationFor(op: TmMatch, level: number): unknown | null {
  if (level >= 2) return null;
  const position = { offset: op.offset, length: op.length };
  if (op.mode === 'dough') return level > 0 ? null : { type: 'MODE', name: 'dough', data: { time: Math.round(op.time ?? 60) }, position };
  if (op.mode === 'turbo') return level > 0 ? null : { type: 'MODE', name: 'turbo', data: { time: op.time ?? 1, ...(op.pulses ? { pulseCount: op.pulses } : {}) }, position };
  if (op.mode === 'browning') {
    return level > 0 ? null : { type: 'MODE', name: 'browning', data: { time: Math.round(op.time ?? 300), temperature: { value: String(op.temp ?? 160), unit: 'C' }, power: 'Gentle' }, position };
  }
  const data: Record<string, unknown> = {};
  if (op.time != null) data.time = Math.max(1, Math.round(op.time));
  if (op.speed != null) {
    if (op.speed === 'soft') { if (level > 0) return null; data.speed = 'soft'; } else data.speed = op.speed;
  }
  if (op.temp != null) data.temperature = { value: op.temp === 'Varoma' ? (level === 0 ? 'Varoma' : '120') : String(op.temp), unit: 'C' };
  if (op.reverse) data.direction = 'CCW';
  if (level > 0 && (data.time == null || data.speed == null)) return null;
  return { type: 'TTS', data, position };
}

export function buildInstructions(r: Recipe, level = 0): { steps: CookidooStep[]; buttons: number } {
  let buttons = 0;
  const steps: CookidooStep[] = [];
  for (const s of r.steps) {
    const text = stepText(s);
    if (!text) continue;
    const annotations = findSettings(text).map((op) => annotationFor(op, level)).filter(Boolean);
    buttons += annotations.length;
    steps.push(annotations.length ? { type: 'STEP', text, annotations } : { type: 'STEP', text });
  }
  return { steps, buttons };
}
