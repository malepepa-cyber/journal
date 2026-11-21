// Petras Rezepte App – Parser für deutschsprachige Thermomix-Rezepte
// (z. B. kopiert aus dem Zaubertopf Club).
//
// Läuft im Browser und in Node (ES-Modul, keine Abhängigkeiten).

// ---------------------------------------------------------------------------
// 1) Einstellungen in einem Arbeitsschritt erkennen
//    z. B. "10 Sek./Stufe 5", "3 Min./120°C/Stufe 1",
//          "20 Min./100°C/Linkslauf/Sanftrührstufe", "25 Min./Varoma/Stufe 1",
//          "2 Min./Teigstufe", "Turbo/1 Sek./3 Mal"
// ---------------------------------------------------------------------------

const NUM = String.raw`\d+(?:[,.]\d+)?`;
const DUR_UNIT = String.raw`(?:Std\.?|Stunden?|Min\.?|Minuten?|Sek\.?|Sekunden?|sec\.?|s(?![a-zäöüß]))`;
const T_DUR = String.raw`${NUM}(?:\s*[-–]\s*${NUM})?\s*${DUR_UNIT}(?:\s*${NUM}\s*${DUR_UNIT})?`;
const T_TEMP = String.raw`(?:${NUM}\s*°\s*C?|Varoma)`;
const T_DIR = String.raw`(?:Linkslauf|Rückwärts(?:lauf)?|[⟲↺])`;
const T_SPEED = String.raw`(?:Sanftrührstufe|Sanftrühr-?stufe|Stufe\s*(?:${NUM}|🥄|sanft)|Rührstufe\s*🥄|🥄)`;
const T_DOUGH = String.raw`(?:Teigstufe|Teigknetstufe|Knetstufe|Teigmodus|Teig-Modus|Teigkneten)`;
const T_TURBO = String.raw`(?:Turbo)`;
const T_TIMES = String.raw`(?:\d+\s*(?:x|Mal|mal))`;
const TOKEN = `(?:${T_DUR}|${T_TEMP}|${T_DIR}|${T_SPEED}|${T_DOUGH}|${T_TURBO}|${T_TIMES})`;
const CHAIN_RE = new RegExp(`${TOKEN}(?:\\s*\\/\\s*${TOKEN})+`, 'giu');

const toNum = (s) => parseFloat(String(s).replace(',', '.'));

/** "1 Min. 30 Sek." → 90 ; "10-15 Sek." → 10 ; "1,5 Min." → 90 */
export function parseDuration(text) {
  const re = new RegExp(`(${NUM})(?:\\s*[-–]\\s*${NUM})?\\s*(${DUR_UNIT})`, 'giu');
  let total = 0, m, found = false;
  while ((m = re.exec(text))) {
    found = true;
    const n = toNum(m[1]);
    const u = m[2].toLowerCase();
    if (u.startsWith('std') || u.startsWith('stunde')) total += n * 3600;
    else if (u.startsWith('min')) total += n * 60;
    else total += n;
  }
  return found ? Math.round(total * 10) / 10 : null;
}

function classify(piece, op) {
  const p = piece.trim();
  if (new RegExp(`^${T_DUR}$`, 'iu').test(p)) { op.time = parseDuration(p); return true; }
  if (/^Varoma$/i.test(p)) { op.temp = 'Varoma'; return true; }
  if (new RegExp(`^${NUM}\\s*°\\s*C?$`, 'iu').test(p)) { op.temp = Math.round(toNum(p)); return true; }
  if (new RegExp(`^${T_DIR}$`, 'iu').test(p)) { op.reverse = true; return true; }
  if (new RegExp(`^${T_DOUGH}$`, 'iu').test(p)) { op.mode = 'dough'; return true; }
  if (/^Turbo$/i.test(p)) { op.mode = 'turbo'; return true; }
  if (new RegExp(`^${T_TIMES}$`, 'iu').test(p)) { op.pulses = parseInt(p, 10); return true; }
  if (new RegExp(`^${T_SPEED}$`, 'iu').test(p)) {
    const n = p.match(new RegExp(NUM));
    op.speed = n ? String(toNum(n[0])) : 'soft';
    return true;
  }
  return false;
}

/**
 * Findet alle Thermomix-Einstellungen in einem Schritt.
 * Liefert [{offset, length, match, mode, time, temp, speed, reverse, pulses, warnings}]
 */
export function findOperations(text) {
  const ops = [];
  CHAIN_RE.lastIndex = 0;
  let m;
  while ((m = CHAIN_RE.exec(text))) {
    const op = { offset: m.index, length: m[0].length, match: m[0], mode: 'tts' };
    for (const piece of m[0].split('/')) classify(piece, op);
    // Eine "Kette" ohne Zeit und ohne Stufe ist keine Einstellung (z. B. "100°C/Varoma")
    if (op.mode === 'tts' && op.time == null && op.speed == null) continue;
    if (op.mode === 'dough' && op.time == null) continue;
    op.warnings = [];
    if (op.mode === 'tts' && op.speed == null) op.warnings.push('Keine Stufe erkannt');
    if (op.mode === 'tts' && op.time == null) op.warnings.push('Keine Zeit erkannt');
    if (op.temp === 'Varoma') op.warnings.push('Varoma: wird ggf. als 120 °C übertragen');
    if (op.speed === 'soft') op.warnings.push('Sanftrührstufe: Übertragung experimentell');
    if (op.mode !== 'tts') op.warnings.push(`${op.mode === 'dough' ? 'Teigmodus' : 'Turbo'}: Übertragung experimentell`);
    if (op.speed != null && op.speed !== 'soft') {
      const s = toNum(op.speed);
      if (!(s >= 0.5 && s <= 10)) op.warnings.push('Stufe außerhalb 0,5–10');
    }
    if (typeof op.temp === 'number' && !(op.temp >= 37 && op.temp <= 160)) op.warnings.push('Ungewöhnliche Temperatur');
    ops.push(op);
  }
  return ops;
}

/** Kurzbeschreibung einer erkannten Einstellung für die Anzeige. */
export function describeOperation(op) {
  const parts = [];
  if (op.mode === 'dough') parts.push('Teigmodus');
  if (op.mode === 'turbo') parts.push('Turbo');
  if (op.time != null) parts.push(formatSeconds(op.time));
  if (op.temp != null) parts.push(op.temp === 'Varoma' ? 'Varoma' : `${op.temp} °C`);
  if (op.reverse) parts.push('Linkslauf');
  if (op.speed != null) parts.push(op.speed === 'soft' ? 'Sanftrührstufe' : `Stufe ${String(op.speed).replace('.', ',')}`);
  if (op.pulses) parts.push(`${op.pulses}×`);
  return parts.join(' · ');
}

export function formatSeconds(sec) {
  if (sec == null) return '';
  if (sec < 60) return `${String(sec).replace('.', ',')} Sek.`;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return [h ? `${h} Std.` : '', m ? `${m} Min.` : '', s ? `${s} Sek.` : ''].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// 2) Kompletten eingefügten Rezepttext zerlegen
// ---------------------------------------------------------------------------

const H_INGR = /^\s*(zutaten|zutatenliste|das brauchst du|du brauchst)\b.*$/i;
const H_STEPS = /^\s*(zubereitung|zubereitungsschritte|arbeitsschritte|anleitung|so geht'?s|so wird'?s gemacht|schritte)\b.*$/i;
const H_STOP = /^\s*(tipps?|hinweis|nährwerte|naehrwerte|nährwerte pro|kommentare|bewertungen|das könnte dir auch gefallen|ähnliche rezepte)\s*:?\s*$/i;
const UNIT = String.raw`(?:g|kg|mg|ml|l|cl|dl|EL|TL|Msp\.?|Prise[n]?|Pck\.?|Päckchen|Packung(?:en)?|Pkg\.?|Dose[n]?|Becher|Bund|Stück|Stk\.?|Zehe[n]?|Scheibe[n]?|Tasse[n]?|Handvoll|Spritzer|Würfel|Blatt|Blätter|Glas|Gläser|Tropfen|Zweig(?:e)?|Stange[n]?|Knolle[n]?|Kopf|Köpfe)`;
const QTY_ONLY = new RegExp(String.raw`^\s*(?:ca\.\s*)?(?:\d+(?:[,./]\d+)?(?:\s*[-–]\s*\d+(?:[,./]\d+)?)?|[½¼¾⅓⅔]|etwas|einige|n\.\s*B\.)\s*${UNIT}?\.?\s*$`, 'iu');

function cleanLine(l) {
  return l
    .replace(/ /g, ' ')
    .replace(/[\t ]+/g, ' ')
    .replace(/^\s*[•●▪◦\-–*·✓☐□]\s*/, '')
    .trim();
}

// Kopf-/Fußzeilen aus gedruckten PDFs (Browser-Druck) und Seitenreste
const NOISE = [
  /^https?:\/\/\S+(\s+\d+\s*\/\s*\d+)?$/i,
  /^www\.\S+$/i,
  /^\d{1,2}\.\d{1,2}\.\d{2,4},?\s+\d{1,2}[:\s]\d{2}\b/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\b/,
  /^\d+\s*\/\s*\d+$/,
  /^Seite\s+\d+(\s*(von|\/)\s*\d+)?$/i,
  /^©/,
  /^(drucken|teilen|merken|bewerten|speichern|pdf|zur einkaufsliste|auf die einkaufsliste|rezept drucken|jetzt bewerten)$/i,
];
export const isNoise = (l) => NOISE.some((re) => re.test(l));
// Zeilen im Kopfbereich, die kein Titel sind
const NOT_TITLE = /[›»]|\s>\s.*\s>\s|⭐|★|Bewertung|^\d+([,.]\d)?\s*(von 5|\/\s*5)|^(Startseite|Home|Rezepte)\b/i;

function parseMeta(line, meta, section = 'head') {
  let m;
  // In der Zutatenliste nur eindeutige Zeilen wie "4 Portionen" (nicht "4 Stück Eier")
  if (section === 'ingr' && !/^(?:\d+\s*(?:Portion(?:en)?|Personen)\s*$|(?:Portionen|Personen|Arbeitszeit|Vorbereitungszeit|Zubereitungszeit|Gesamtzeit)\b)/i.test(line)) return false;
  if ((m = line.match(/(\d+)\s*(?:Portion(?:en)?|Personen|Pers\.|Stück|Stk\.?)\b/i)) ||
      (section === 'head' && (m = line.match(/^(\d+)\s*(?:Brote?|Laib(?:e)?|Kuchen|Torten?|Bleche?|Gläser|Glas|Muffins|Brötchen)\s*$/i))) ||
      (m = line.match(/^(?:Portionen|Personen|Menge|Ergibt)\s*:?\s*(\d+)/i))) {
    if (!meta.servings) {
      meta.servings = parseInt(m[1], 10);
      const u = line.match(/\d+\s*(Portion(?:en)?|Personen|Stück)/i);
      if (u) meta.servingsUnit = /stück/i.test(u[1]) ? 'Stück' : 'Portionen';
    }
    return true;
  }
  if ((m = line.match(/^(?:Arbeitszeit|Vorbereitungszeit|Zubereitungszeit|Aktive Zeit|Arbeit)\s*:?\s*(.+)$/i))) {
    const s = parseDuration(m[1]); if (s) meta.prepTime = Math.round(s / 60); return true;
  }
  if ((m = line.match(/^(?:Gesamtzeit|Gesamt|Total)\s*:?\s*(.+)$/i))) {
    const s = parseDuration(m[1]); if (s) meta.totalTime = Math.round(s / 60); return true;
  }
  if (/^(?:Schwierigkeit|Schwierigkeitsgrad|Level)\b/i.test(line)) return true;
  if (/^(?:einfach|mittel|aufwendig|leicht|schwer)$/i.test(line)) return true;
  return false;
}

// Wenn Zutaten durch Leerzeilen getrennt sind (typisch für PDFs), gehören
// direkt aufeinanderfolgende Zeilen zur selben Zutat (Zeilenumbruch).
function mergeIngredientBlocks(lines) {
  const blocks = [];
  let cur = [];
  for (const l of lines) {
    if (l === '') { if (cur.length) blocks.push(cur); cur = []; } else cur.push(l);
  }
  if (cur.length) blocks.push(cur);
  const nonEmpty = lines.filter(Boolean).length;
  const blankStructured = blocks.length >= 3 && blocks.length >= nonEmpty * 0.6;
  return blankStructured ? blocks.map((b) => b.join(' ')) : lines.filter(Boolean);
}

function joinQuantityLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (QTY_ONLY.test(l) && i + 1 < lines.length && !QTY_ONLY.test(lines[i + 1])) {
      out.push(`${l} ${lines[i + 1]}`);
      i++;
    } else out.push(l);
  }
  return out;
}

function splitSteps(lines) {
  const steps = [];
  const numbered = lines.filter((l) => /^\s*(?:Schritt\s*)?\d{1,2}\s*[.):]\s*\S/i.test(l)).length >= 2;
  for (let raw of lines) {
    // Reine Nummern-Zeilen ("1", "2.") überspringen – Nummer kommt oft separat.
    if (/^\s*(?:Schritt\s*)?\d{1,2}\s*[.):]?\s*$/i.test(raw)) { steps.push(''); continue; }
    const isNew = /^\s*(?:Schritt\s*)?\d{1,2}\s*[.):]\s*\S/i.test(raw);
    const text = raw.replace(/^\s*(?:Schritt\s*)?\d{1,2}\s*[.):]\s*/i, '').trim();
    if (!text) continue;
    if (numbered && !isNew && steps.length) {
      steps[steps.length - 1] = `${steps[steps.length - 1]} ${text}`.trim();
    } else if (steps.length && steps[steps.length - 1] === '') {
      steps[steps.length - 1] = text;
    } else {
      steps.push(text);
    }
  }
  return steps.filter(Boolean);
}

/**
 * Zerlegt einen kompletten eingefügten Text in
 * { title, servings, servingsUnit, prepTime, totalTime, ingredients[], steps[] }.
 * prepTime/totalTime in Minuten.
 */
export function parseRecipeText(input) {
  const lines = String(input || '').split(/\r?\n/).map(cleanLine);
  const meta = { title: '', servings: null, servingsUnit: 'Portionen', prepTime: null, totalTime: null };
  const head = [], ingr = [], steps = [];
  let section = 'head';
  const expanded = [];
  for (const line of lines) {
    // "Arbeitszeit 10 Min. · Gesamtzeit 1 Std. · 4 Portionen" in Teile zerlegen
    if (/\s[·•|]\s/.test(line) && /(arbeitszeit|gesamtzeit|zubereitungszeit|portion|personen)/i.test(line)) {
      expanded.push(...line.split(/\s[·•|]\s/).map((x) => x.trim()));
    } else expanded.push(line);
  }
  for (const line of expanded) {
    if (!line) { if (section === 'steps' || section === 'ingr') (section === 'steps' ? steps : ingr).push(''); continue; }
    if (isNoise(line)) continue;
    if (H_INGR.test(line) && line.length < 40) {
      section = 'ingr';
      const n = line.match(/(\d+)\s*(Portion|Person|Stück)/i); if (n) parseMeta(line, meta);
      continue;
    }
    if (H_STEPS.test(line) && line.length < 40) { section = 'steps'; continue; }
    if (H_STOP.test(line)) { section = 'stop'; continue; }
    if (section === 'stop') continue;
    if (section !== 'steps' && parseMeta(line, meta, section)) continue;
    if (section === 'head') head.push(line);
    else if (section === 'ingr') ingr.push(line);
    else steps.push(line);
  }

  // Kein "Zutaten"/"Zubereitung" gefunden → heuristisch trennen
  if (!ingr.length && !steps.length && head.length) {
    meta.title = head.shift();
    for (const l of head) {
      if (findOperations(l).length || l.length > 70 || /[.!]$/.test(l)) steps.push(l);
      else ingr.push(l);
    }
  } else {
    meta.title = head.find((l) => !NOT_TITLE.test(l) && l.length <= 100) || head[0] || '';
  }

  // Leerzeilen in Schritten: Absätze bilden, wenn keine Nummerierung
  const stepLines = [];
  let buf = '';
  const hasNumbers = steps.filter((l) => /^\s*(?:Schritt\s*)?\d{1,2}\s*[.):]/i.test(l)).length >= 2;
  for (const l of steps) {
    if (l === '') { if (buf) { stepLines.push(buf); buf = ''; } continue; }
    if (hasNumbers) { stepLines.push(l); continue; }
    // Ohne Nummerierung: jede Zeile ist ein Schritt
    stepLines.push(l);
  }
  if (buf) stepLines.push(buf);

  return {
    ...meta,
    title: meta.title.replace(/\s+[-–|]\s+(Zaubertopf|Thermomix|Cookidoo|Rezept).*$/i, '').trim(),
    ingredients: joinQuantityLines(mergeIngredientBlocks(ingr)).filter((l) => !/^(?:drucken|teilen|merken|zur einkaufsliste)/i.test(l)),
    steps: splitSteps(stepLines),
  };
}
