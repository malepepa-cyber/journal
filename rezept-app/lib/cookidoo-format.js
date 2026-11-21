// Wandelt ein geprüftes Rezept in das Format der Cookidoo-"Meine Kreationen"-API um.
import { findOperations } from '../public/parser.js';

export function validateRecipe(r) {
  const p = [];
  if (!r || typeof r !== 'object') return ['Ungültige Daten.'];
  if (!r.title || typeof r.title !== 'string' || !r.title.trim()) p.push('Titel fehlt.');
  if (!Array.isArray(r.ingredients)) p.push('Zutaten fehlen.');
  if (!Array.isArray(r.steps) || !r.steps.filter((s) => String(s).trim()).length) p.push('Arbeitsschritte fehlen.');
  if (r.title && r.title.length > 200) p.push('Titel ist zu lang.');
  return p;
}

export function buildMeta(r) {
  const meta = {
    name: r.title.trim(),
    ingredients: r.ingredients.map((t) => String(t).trim()).filter(Boolean)
      .map((text) => ({ type: 'INGREDIENT', text })),
  };
  const servings = parseInt(r.servings, 10);
  if (servings > 0) meta.yield = { value: servings, unitText: 'portion' };
  const prep = Number(r.prepTime), total = Number(r.totalTime);
  if (prep > 0) meta.prepTime = Math.round(prep * 60);
  if (total > 0) meta.totalTime = Math.round(total * 60);
  else if (prep > 0) meta.totalTime = Math.round(prep * 60);
  return meta;
}

/**
 * Baut die Annotation für eine erkannte Einstellung.
 * level 0 = inkl. experimenteller Werte, 1 = nur sichere TTS-Knöpfe, 2 = keine.
 * Liefert null, wenn auf diesem Level kein Knopf erzeugt werden soll.
 */
export function annotationFor(op, level) {
  if (level >= 2) return null;
  const position = { offset: op.offset, length: op.length };
  if (op.mode === 'dough') {
    if (level > 0) return null;
    return { type: 'MODE', name: 'dough', data: { time: Math.round(op.time) }, position };
  }
  if (op.mode === 'turbo') {
    if (level > 0) return null;
    const data = { time: op.time ?? 1 };
    if (op.pulses) data.pulseCount = op.pulses;
    return { type: 'MODE', name: 'turbo', data, position };
  }
  const data = {};
  if (op.time != null) data.time = Math.max(1, Math.round(op.time));
  if (op.speed != null) {
    if (op.speed === 'soft') { if (level > 0) return null; data.speed = 'soft'; }
    else data.speed = String(op.speed);
  }
  if (op.temp != null) {
    const value = op.temp === 'Varoma' ? (level === 0 ? 'Varoma' : '120') : String(op.temp);
    data.temperature = { value, unit: 'C' };
  }
  if (op.reverse) data.direction = 'CCW';
  if (level > 0 && (data.time == null || data.speed == null)) return null;
  return { type: 'TTS', data, position };
}

export function buildInstructions(stepTexts, level = 0) {
  const stats = { steps: 0, buttons: 0, skipped: 0 };
  const steps = [];
  for (const raw of stepTexts) {
    const text = String(raw).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    stats.steps++;
    const annotations = [];
    for (const op of findOperations(text)) {
      const a = annotationFor(op, level);
      if (a) { annotations.push(a); stats.buttons++; } else stats.skipped++;
    }
    const step = { type: 'STEP', text };
    if (annotations.length) step.annotations = annotations;
    steps.push(step);
  }
  return { steps, stats };
}
