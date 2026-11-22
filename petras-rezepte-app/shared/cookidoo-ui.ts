/**
 * Ausfüllhilfe für den Cookidoo-Editor („Meine Kreationen → Zutaten & Rezeptschritte“).
 *
 * Der Editor stellt eine Thermomix-Einstellung als Element im Schritttext dar, z. B.
 *   <cr-tts speed="soft" temperature="100" temperature-unit="C" time="600">10 Min./100°C/Stufe</cr-tts>
 * (geprüft an einer gespeicherten Editor-Seite). Werte des offiziellen Dialogs:
 *   temperature: 37 … 120, 140 … 160, „varoma“ · speed: „soft“, 0.5 … 10 · direction: CW / CCW
 * Diese Datei erzeugt genau dieses HTML aus einem Schritt der App. Modi (Teig, Turbo, Anbraten)
 * werden als Text übernommen und im Editor über „Koch-Einstellungen“ ergänzt (Hinweis an Petra).
 */
import type { Recipe, Step, TmMatch } from './model.ts';
import { findSettings } from './tm.ts';
import { formatIngredient } from './ingredients.ts';
import { stepText } from './cookidoo.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Kann diese Einstellung als fertiger Knopf eingesetzt werden? */
export function ttsSupported(op: TmMatch): boolean {
  return op.mode === 'manual' && op.time != null && op.time > 0 && op.speed != null;
}

/** <cr-tts …> für eine manuelle Einstellung (Zeit/Temperatur/Stufe/Linkslauf). */
export function ttsElement(op: TmMatch): string {
  const attrs: string[] = [];
  attrs.push(`speed="${esc(op.speed === 'soft' ? 'soft' : String(op.speed))}"`);
  if (op.temp != null) {
    attrs.push(`temperature="${op.temp === 'Varoma' ? 'varoma' : String(op.temp)}"`, 'temperature-unit="C"');
  }
  attrs.push(`time="${Math.max(1, Math.round(op.time ?? 0))}"`);
  if (op.reverse) attrs.push('direction="CCW"');
  return `<cr-tts ${attrs.join(' ')}>${esc(op.match.trim())}</cr-tts>`;
}

export interface StepHtml { html: string; text: string; buttons: number; ingredients: number; manual: string[] }

/**
 * Schritttext → HTML für das Cookidoo-Schrittfeld:
 * Text escaped, Einstellungen als <cr-tts>, Zutaten des Schritts als <cr-ingredient description="…">
 * (wie im Editor: „<cr-ingredient description="500ml Wasser">500ml Wasser</cr-ingredient>“).
 */
export function stepHtml(step: Step): StepHtml {
  const text = stepText(step);
  type Part = { start: number; end: number; html: string; kind: 'tts' | 'ingr' | 'text' };
  const parts: Part[] = [];
  const manual: string[] = [];
  for (const op of findSettings(text)) {
    if (ttsSupported(op)) parts.push({ start: op.offset, end: op.offset + op.length, html: ttsElement(op), kind: 'tts' });
    else manual.push(op.match.trim());
  }
  for (const ing of step.ingredients ?? []) {
    const at = text.indexOf(ing);
    if (at < 0 || parts.some((p) => at < p.end && at + ing.length > p.start)) continue;
    parts.push({ start: at, end: at + ing.length, html: `<cr-ingredient description="${esc(ing)}">${esc(ing)}</cr-ingredient>`, kind: 'ingr' });
  }
  parts.sort((a, b) => a.start - b.start);
  let html = '', last = 0;
  for (const p of parts) { html += esc(text.slice(last, p.start)) + p.html; last = p.end; }
  html += esc(text.slice(last));
  return { html, text, buttons: parts.filter((p) => p.kind === 'tts').length, ingredients: parts.filter((p) => p.kind === 'ingr').length, manual };
}

/** Zutatenzeilen für Cookidoo (Gruppen als eigene Zeile „– Für die Soße –“). */
export function ingredientLines(r: Recipe): string[] {
  const out: string[] = [];
  let group = '';
  for (const i of r.ingredients) {
    if (i.group && i.group !== group) { out.push(`– ${i.group} –`); group = i.group; }
    const line = formatIngredient(i).trim();
    if (line) out.push(line.slice(0, 500));
  }
  return out;
}
