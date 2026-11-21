// ==UserScript==
// @name         Petras Rezepte → Cookidoo
// @namespace    petras-rezepte-app
// @version      2026.11.21
// @description  Rezept einfügen und als eigenes Rezept in Cookidoo speichern
// @match        https://cookidoo.de/*
// @match        https://cookidoo.at/*
// @match        https://cookidoo.ch/*
// @grant        none
// ==/UserScript==
(() => {
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
function parseDuration(text) {
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
function findOperations(text) {
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
function describeOperation(op) {
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

function formatSeconds(sec) {
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

function parseMeta(line, meta) {
  let m;
  if ((m = line.match(/(\d+)\s*(?:Portion(?:en)?|Personen|Pers\.|Stück|Stk\.?)\b/i)) ||
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
function parseRecipeText(input) {
  const lines = String(input || '').split(/\r?\n/).map(cleanLine);
  const meta = { title: '', servings: null, servingsUnit: 'Portionen', prepTime: null, totalTime: null };
  const head = [], ingr = [], steps = [];
  let section = 'head';
  for (const line of lines) {
    if (!line) { if (section === 'steps') steps.push(''); continue; }
    if (H_INGR.test(line) && line.length < 40) {
      section = 'ingr';
      const n = line.match(/(\d+)\s*(Portion|Person|Stück)/i); if (n) parseMeta(line, meta);
      continue;
    }
    if (H_STEPS.test(line) && line.length < 40) { section = 'steps'; continue; }
    if (H_STOP.test(line)) { section = 'stop'; continue; }
    if (section === 'stop') continue;
    if (section !== 'steps' && parseMeta(line, meta)) continue;
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
    meta.title = head[0] || '';
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
    title: meta.title.replace(/\s+-\s+Zaubertopf.*$/i, '').trim(),
    ingredients: joinQuantityLines(ingr).filter((l) => !/^(?:drucken|teilen|merken|zur einkaufsliste)/i.test(l)),
    steps: splitSteps(stepLines),
  };
}

// Wandelt ein geprüftes Rezept in das Format der Cookidoo-"Meine Kreationen"-API um.

function validateRecipe(r) {
  const p = [];
  if (!r || typeof r !== 'object') return ['Ungültige Daten.'];
  if (!r.title || typeof r.title !== 'string' || !r.title.trim()) p.push('Titel fehlt.');
  if (!Array.isArray(r.ingredients)) p.push('Zutaten fehlen.');
  if (!Array.isArray(r.steps) || !r.steps.filter((s) => String(s).trim()).length) p.push('Arbeitsschritte fehlen.');
  if (r.title && r.title.length > 200) p.push('Titel ist zu lang.');
  return p;
}

function buildMeta(r) {
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
function annotationFor(op, level) {
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

function buildInstructions(stepTexts, level = 0) {
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

// Speichert ein Rezept direkt aus dem Browser – läuft AUF cookidoo.de
// (als Lesezeichen-Helfer), nutzt also die bestehende Anmeldung im Browser.
// Kein Passwort nötig, kein Server.

const FULL = 'application/vnd.vorwerk.customer-recipe.full+json';

/** Sprach-/Marktkennung aus der aktuellen Cookidoo-Adresse, z. B. "de-DE". */
function detectLanguage(loc = globalThis.location) {
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
async function saveRecipeInBrowser(recipe, lang = detectLanguage()) {
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

// Lesezeichen-Helfer: öffnet auf cookidoo.de ein kleines Fenster, in das man
// das Rezept einfügt (aus der PC-Seite kopiert ODER direkt aus dem Zaubertopf Club)
// und speichert es mit der bestehenden Cookidoo-Anmeldung.

const MARK = 'PETRAS-REZEPT:';

function openHelper() {
  if (!/(^|\.)cookidoo\.[a-z.]+$/.test(location.hostname)) {
    if (confirm('Petras Rezepte App:\nBitte zuerst cookidoo.de öffnen (und anmelden), dann das Lesezeichen erneut anklicken.\n\nJetzt cookidoo.de öffnen?')) {
      location.href = 'https://cookidoo.de/created-recipes/de-DE';
    }
    return;
  }
  const old = document.getElementById('petras-rezepte-helper');
  if (old) { old.remove(); return; }

  const host = document.createElement('div');
  host.id = 'petras-rezepte-helper';
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
    .box{width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#1d2420;
      border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);font-size:15px;line-height:1.45}
    header{background:#2E6B3F;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:8px;position:sticky;top:0}
    header b{flex:1;font-size:16px}
    header button{background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px}
    main{padding:14px 16px}
    textarea{width:100%;min-height:150px;border:1px solid #ccd5cc;border-radius:10px;padding:10px;font-size:14px;resize:vertical}
    .hint{color:#66706a;font-size:13px;margin:0 0 8px}
    .btn{border:0;border-radius:10px;padding:12px 16px;font-weight:600;font-size:15px;cursor:pointer;width:100%;margin-top:10px;background:#2E6B3F;color:#fff}
    .btn:disabled{opacity:.5;cursor:default}
    .preview{margin-top:10px;font-size:14px}
    .preview ol{padding-left:20px;margin:6px 0}
    .op{display:inline-block;font-size:12px;padding:2px 8px;border-radius:99px;background:#E3F3E6;color:#1E7B34;font-weight:600;margin:2px 4px 2px 0}
    .op.warn{background:#FFF1DF;color:#B25D0E}
    .msg{margin-top:12px;padding:10px 12px;border-radius:10px;font-size:14px}
    .ok{background:#E3F3E6}.err{background:#FCE8E6}
    a{color:#2E6B3F;font-weight:700}
    pre{white-space:pre-wrap;font-size:11px;max-height:160px;overflow:auto}
  </style>
  <div class="box">
    <header><b>🍲 Petras Rezepte → Cookidoo</b><button id="x" title="Schließen">✕</button></header>
    <main>
      <p class="hint">Strg + V drücken, um das Rezept einzufügen – aus der Petras-Rezepte-Seite oder direkt aus dem Zaubertopf Club kopiert.</p>
      <textarea id="in" placeholder="Hier einfügen (Strg + V) …"></textarea>
      <div id="pv" class="preview"></div>
      <button id="save" class="btn" disabled>☁️ In Cookidoo speichern</button>
      <div id="msg"></div>
    </main>
  </div>`;
  document.body.appendChild(host);

  const $ = (id) => root.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let recipe = null;

  function read(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (t.startsWith(MARK)) {
      try { return JSON.parse(t.slice(MARK.length)); } catch { return null; }
    }
    const r = parseRecipeText(t);
    return { title: r.title, servings: r.servings, prepTime: r.prepTime, totalTime: r.totalTime, ingredients: r.ingredients, steps: r.steps };
  }

  function update() {
    recipe = read($('in').value);
    $('msg').innerHTML = '';
    if (!recipe) { $('pv').innerHTML = ''; $('save').disabled = true; return; }
    const ok = recipe.title && recipe.steps?.length;
    $('pv').innerHTML = `<b>${esc(recipe.title || '⚠ Kein Titel erkannt')}</b><br>
      ${recipe.ingredients?.length || 0} Zutaten · ${recipe.steps?.length || 0} Schritte
      <ol>${(recipe.steps || []).map((s) => {
        const ops = findOperations(s.replace(/\s+/g, ' ').trim());
        return `<li>${esc(s.length > 70 ? s.slice(0, 70) + '…' : s)}<br>${ops.map((o) =>
          `<span class="op ${o.warnings.length ? 'warn' : ''}">⚙ ${esc(describeOperation(o))}</span>`).join('')}</li>`;
      }).join('')}</ol>`;
    $('save').disabled = !ok;
  }

  $('in').addEventListener('input', update);
  $('x').addEventListener('click', () => host.remove());
  $('save').addEventListener('click', async () => {
    if (!recipe) return;
    const btn = $('save');
    btn.disabled = true; btn.textContent = '⏳ Wird gespeichert …';
    try {
      const res = await saveRecipeInBrowser(recipe);
      const note = ['', '<br>Hinweis: Varoma/Sanftrührstufe/Teig/Turbo wurden vereinfacht übertragen – bitte am TM6 prüfen.',
        '<br>Hinweis: Einstellungs-Knöpfe wurden nicht angenommen – Schritte als Text gespeichert.'][res.level];
      $('msg').innerHTML = `<div class="msg ok">✅ <b>„${esc(recipe.title)}“ gespeichert!</b><br>
        ${res.stats.buttons} Thermomix-Knöpfe in ${res.stats.steps} Schritten.${note}<br>
        Auf dem TM6: <i>Meine Rezepte → Meine Kreationen</i><br>
        <a href="${esc(res.url)}">Rezept ansehen</a></div>`;
      btn.textContent = '✓ Gespeichert';
    } catch (e) {
      $('msg').innerHTML = `<div class="msg err">❌ <b>${esc(e.message)}</b>
        ${e.body ? `<details><summary>Technische Details</summary><pre>${esc(JSON.stringify(e.body, null, 2))}</pre></details>` : ''}</div>`;
      btn.disabled = false; btn.textContent = '☁️ Nochmal versuchen';
    }
  });

  $('in').focus();
  // Wenn der Browser es erlaubt: Zwischenablage direkt übernehmen
  navigator.clipboard?.readText?.().then((t) => {
    if (t && !$('in').value) { $('in').value = t; update(); }
  }).catch(() => {});
}

// Aufruf erfolgt durch das Build-Skript (Lesezeichen bzw. Userscript).

  const b = document.createElement('button');
  b.textContent = '🍲 Petras Rezepte';
  b.title = 'Rezept einfügen und speichern';
  b.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483646;background:#2E6B3F;color:#fff;border:0;border-radius:99px;padding:12px 18px;font:600 15px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer';
  b.addEventListener('click', openHelper);
  const add = () => document.body && !document.body.contains(b) && document.body.appendChild(b);
  add(); setInterval(add, 2000);
})();
