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

export interface StepHtml { html: string; text: string; buttons: number; manual: string[] }

/** Schritttext → HTML für das Cookidoo-Schrittfeld (Text escaped, Einstellungen als <cr-tts>). */
export function stepHtml(step: Step): StepHtml {
  const text = stepText(step);
  let html = '', last = 0, buttons = 0;
  const manual: string[] = [];
  for (const op of findSettings(text)) {
    html += esc(text.slice(last, op.offset));
    if (ttsSupported(op)) { html += ttsElement(op); buttons++; }
    else { html += esc(op.match); manual.push(op.match.trim()); }
    last = op.offset + op.length;
  }
  html += esc(text.slice(last));
  return { html, text, buttons, manual };
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
