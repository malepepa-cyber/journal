/**
 * Thermomix-Einstellungen in deutschem Rezepttext erkennen, prüfen und schreiben.
 * Beispiele: „10 Sek./Stufe 5“, „3 Min./120°C/Stufe 1“, „20 Min./100°C/Linkslauf/Sanftrührstufe“,
 * „25 Min./Varoma/Stufe 1“, „2 Min./Teigstufe“, „Turbo/1 Sek./3 Mal“, „Anbraten/5 Min./160°C“.
 */
import type { TmMatch, TmSetting } from './model.ts';

const NUM = String.raw`\d+(?:[,.]\d+)?`;
const DUR_UNIT = String.raw`(?:Std\.?|Stunden?|Min\.?|Minuten?|Sek\.?|Sekunden?|sec\.?|s(?![a-zäöüß]))`;
const T_DUR = String.raw`${NUM}(?:\s*[-–]\s*${NUM})?\s*${DUR_UNIT}(?:\s*${NUM}\s*${DUR_UNIT})?`;
const T_TEMP = String.raw`(?:${NUM}\s*°\s*C?|Varoma(?:®|\(R\))?)`;
const T_DIR = String.raw`(?:Linkslauf|Rückwärts(?:lauf)?|[⟲↺])`;
const T_SPEED = String.raw`(?:Sanftrührstufe|Sanftrühr-?stufe|Stufe\s*(?:${NUM}(?:\s*[-–]\s*${NUM})?|🥄|sanft)|Rührstufe\s*🥄|🥄)`;
const T_DOUGH = String.raw`(?:Teigstufe|Teigknetstufe|Knetstufe|Teigmodus|Teig-Modus|Teigkneten|Kneten)`;
const T_TURBO = String.raw`(?:Turbo)`;
const T_BROWN = String.raw`(?:Anbraten|Anbratmodus|Anbrat-Modus)`;
const T_TIMES = String.raw`(?:\d+\s*(?:x|Mal|mal))`;
const TOKEN = `(?:${T_DUR}|${T_TEMP}|${T_DIR}|${T_SPEED}|${T_DOUGH}|${T_TURBO}|${T_BROWN}|${T_TIMES})`;
// Trenner: „/“ (Vorwerk-Schreibweise) oder „|“ (Zaubertopf Club: „10 Sek. | Stufe 4“)
const CHAIN_RE = new RegExp(`${TOKEN}(?:\\s*[\\/|]\\s*${TOKEN})+`, 'giu');

export const DUR_ONLY_RE = new RegExp(`(${NUM})(?:\\s*[-–]\\s*(${NUM}))?\\s*(${DUR_UNIT})`, 'giu');

const toNum = (s: string | number): number => parseFloat(String(s).replace(',', '.'));
const full = (re: string) => new RegExp(`^${re}$`, 'iu');

/** „1 Min. 30 Sek.“ → 90 · „10-15 Sek.“ → 10 · „1,5 Min.“ → 90 · „1 Std. 10 Min.“ → 4200 (Sekunden) */
export function parseDuration(text: string): number | null {
  const re = new RegExp(`(${NUM})(?:\\s*[-–]\\s*${NUM})?\\s*(${DUR_UNIT})`, 'giu');
  let total = 0, found = false;
  for (const m of String(text).matchAll(re)) {
    found = true;
    const n = toNum(m[1]);
    const u = m[2].toLowerCase();
    if (u.startsWith('std') || u.startsWith('stunde')) total += n * 3600;
    else if (u.startsWith('min')) total += n * 60;
    else total += n;
  }
  return found ? Math.round(total * 10) / 10 : null;
}

function classify(piece: string, op: TmSetting): void {
  const p = piece.trim();
  if (full(T_DUR).test(p)) { op.time = parseDuration(p); return; }
  if (/^Varoma(®|\(R\))?$/i.test(p)) { op.temp = 'Varoma'; return; }
  if (full(`${NUM}\\s*°\\s*C?`).test(p)) { op.temp = Math.round(toNum(p)); return; }
  if (full(T_DIR).test(p)) { op.reverse = true; return; }
  if (full(T_DOUGH).test(p)) { op.mode = 'dough'; return; }
  if (/^Turbo$/i.test(p)) { op.mode = 'turbo'; return; }
  if (full(T_BROWN).test(p)) { op.mode = 'browning'; return; }
  if (full(T_TIMES).test(p)) { op.pulses = parseInt(p, 10); return; }
  if (full(T_SPEED).test(p)) {
    const n = p.match(new RegExp(NUM));
    op.speed = n ? String(toNum(n[0])) : 'soft';
  }
}

/** Prüft eine Einstellung auf Plausibilität (TM6). Liefert verständliche Hinweise. */
export function checkSetting(op: TmSetting): string[] {
  const w: string[] = [];
  if (op.mode === 'manual') {
    if (op.speed == null) w.push('Keine Stufe angegeben');
    if (op.time == null) w.push('Keine Zeit angegeben');
    if (op.speed != null && op.speed !== 'soft') {
      const s = toNum(op.speed);
      if (!(s >= 0.5 && s <= 10)) w.push('Stufe muss zwischen 0,5 und 10 liegen');
      if (op.temp != null && s > 6) w.push('Mit Hitze sind am TM6 höchstens Stufe 6 sinnvoll');
    }
    if (typeof op.temp === 'number') {
      if (op.temp < 37) w.push('Temperatur unter 37 °C');
      if (op.temp > 120) w.push('TM6 heizt manuell bis 120 °C (Anbraten bis 160 °C)');
    }
    if (op.time != null && op.time > 99 * 60) w.push('TM6: höchstens 99 Minuten pro Einstellung');
  }
  if (op.mode === 'dough' && op.time != null && op.time > 6 * 60) w.push('Teigkneten: höchstens 6 Minuten');
  if (op.mode === 'turbo' && op.time != null && op.time > 2) w.push('Turbo-Impulse dauern 0,5–2 Sekunden');
  if (op.mode === 'browning') {
    if (typeof op.temp === 'number' && (op.temp < 120 || op.temp > 160)) w.push('Anbraten: 120–160 °C');
  }
  return w;
}

/** Findet alle Thermomix-Einstellungen in einem Schritt (mit Position im Text). */
export function findSettings(text: string): TmMatch[] {
  const ops: TmMatch[] = [];
  for (const m of String(text).matchAll(CHAIN_RE)) {
    const op: TmMatch = { mode: 'manual', offset: m.index ?? 0, length: m[0].length, match: m[0], warnings: [] };
    for (const piece of m[0].split(/[/|]/)) classify(piece, op);
    // „100°C/Varoma“ ohne Zeit und Stufe ist keine Einstellung
    if (op.mode === 'manual' && op.time == null && op.speed == null) continue;
    if (op.mode === 'dough' && op.time == null) continue;
    if (op.mode === 'browning' && op.time == null && op.temp == null) continue;
    op.warnings = checkSetting(op);
    ops.push(op);
  }
  return ops;
}

export function formatSeconds(sec: number | null | undefined): string {
  if (sec == null) return '';
  if (sec < 60) return `${String(sec).replace('.', ',')} Sek.`;
  // Thermomix-Schreibweise: bis 99 Minuten in Minuten (wie am TM6-Display)
  if (sec < 100 * 60) {
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return s ? `${m} Min. ${s} Sek.` : `${m} Min.`;
  }
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return [h ? `${h} Std.` : '', m ? `${m} Min.` : '', s ? `${s} Sek.` : ''].filter(Boolean).join(' ');
}

const speedText = (s: string) => (s === 'soft' ? 'Sanftrührstufe' : `Stufe ${s.replace('.', ',')}`);

/** Schreibt eine Einstellung in der üblichen Thermomix-Schreibweise. */
export function formatSetting(op: TmSetting): string {
  const parts: string[] = [];
  if (op.mode === 'turbo') {
    parts.push('Turbo');
    if (op.time != null) parts.push(formatSeconds(op.time));
    if (op.pulses) parts.push(`${op.pulses} Mal`);
    return parts.join('/');
  }
  if (op.mode === 'browning') {
    parts.push('Anbraten');
    if (op.time != null) parts.push(formatSeconds(op.time));
    if (op.temp != null) parts.push(`${op.temp}°C`);
    return parts.join('/');
  }
  if (op.time != null) parts.push(formatSeconds(op.time));
  if (op.mode === 'dough') { parts.push('Teigstufe'); return parts.join('/'); }
  if (op.temp != null) parts.push(op.temp === 'Varoma' ? 'Varoma' : `${op.temp}°C`);
  if (op.reverse) parts.push('Linkslauf');
  if (op.speed != null) parts.push(speedText(op.speed));
  return parts.join('/');
}

/** Kurzbeschreibung für Anzeige-Knöpfe, z. B. ['3 Min.', '120 °C', 'Linkslauf', 'Stufe 1']. */
export function describeSetting(op: TmSetting): string[] {
  const parts: string[] = [];
  if (op.mode === 'dough') parts.push('Teig');
  if (op.mode === 'turbo') parts.push('Turbo');
  if (op.mode === 'browning') parts.push('Anbraten');
  if (op.time != null) parts.push(formatSeconds(op.time));
  if (op.temp != null) parts.push(op.temp === 'Varoma' ? 'Varoma' : `${op.temp} °C`);
  if (op.reverse) parts.push('Linkslauf');
  if (op.speed != null) parts.push(op.speed === 'soft' ? 'Sanft' : `Stufe ${op.speed.replace('.', ',')}`);
  if (op.pulses) parts.push(`${op.pulses}×`);
  return parts;
}

/** Ersetzt eine erkannte Einstellung im Text durch eine geänderte. */
export function replaceSetting(text: string, m: Pick<TmMatch, 'offset' | 'length'>, op: TmSetting): string {
  return text.slice(0, m.offset) + formatSetting(op) + text.slice(m.offset + m.length);
}

/** Fügt eine (bestätigte) Einstellung in einen Schritttext ein. */
export function insertSetting(text: string, op: TmSetting): string {
  const t = text.trim();
  const s = formatSetting(op);
  if (!t) return `${s}.`;
  const m = t.match(/^(.*?)([.!]?)$/s)!;
  return `${m[1]} – ${s}${m[2] || '.'}`;
}

/** Einfache (Nicht-Thermomix-)Wartezeit im Text, z. B. „60 Minuten gehen lassen“ → Minuten. */
export function findRestMinutes(text: string): number | null {
  if (!/(gehen|ruhen|quellen|ziehen|abkühlen|auskühlen|kühl|kalt stellen|marinieren|einweichen|durchziehen|fest werden|gären)/i.test(text)) return null;
  // Thermomix-Angaben ausblenden, damit nur die Wartezeit zählt
  let rest = text;
  for (const m of findSettings(text)) rest = rest.replace(m.match, ' ');
  const sec = parseDuration(rest.replace(/(\d)\s*[-–]\s*\d+/g, '$1'));
  return sec ? Math.round(sec / 60) : null;
}
