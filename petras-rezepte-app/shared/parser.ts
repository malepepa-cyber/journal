/**
 * Zerlegt einen beliebigen Rezepttext (eingefügt, aus PDF, OCR, Word, Webseite)
 * in ein strukturiertes Rezept.
 */
import { emptyRecipe, newId, type Category, type Difficulty, type Recipe, type SourceType, type Step, type Accessory } from './model.ts';
import { findSettings, findRestMinutes, parseDuration } from './tm.ts';
import { isGroupHeader, parseIngredient } from './ingredients.ts';
import { suggestForStep } from './suggest.ts';

const H_INGR = /^\s*(zutaten|zutatenliste|das brauchst du|du brauchst|einkaufsliste)\b.*$/i;
const H_STEPS = /^\s*(zubereitung|zubereitungsschritte|arbeitsschritte|anleitung|so geht'?s|so wird'?s gemacht|schritte|und so geht'?s)\b.*$/i;
const H_STOP = /^\s*(tipps?|tipp & tricks|hinweis|hinweise|nährwerte|naehrwerte|nährwerte pro.*|kommentare|bewertungen|das könnte dir auch gefallen|ähnliche rezepte|weitere rezepte|utensilien)\s*:?\s*$/i;
const H_DESC = /^\s*(beschreibung|einleitung|über dieses rezept)\s*:?\s*$/i;

const UNIT_WORDS = String.raw`(?:g|kg|mg|ml|l|cl|dl|EL|TL|Msp\.?|Prise[n]?|Pck\.?|Päckchen|Packung(?:en)?|Pkg\.?|Dose[n]?|Becher|Bund|Stück|Stk\.?|Zehe[n]?|Scheibe[n]?|Tasse[n]?|Handvoll|Spritzer|Würfel|Blatt|Blätter|Glas|Gläser|Tropfen|Zweig(?:e)?|Stange[n]?|Knolle[n]?|Kopf|Köpfe|Tafel[n]?)`;
const QTY_ONLY = new RegExp(String.raw`^\s*(?:ca\.\s*)?(?:\d+(?:[,./]\d+)?(?:\s*[-–]\s*\d+(?:[,./]\d+)?)?|[½¼¾⅓⅔])\s*${UNIT_WORDS}?\.?\s*$`, 'iu');

/** Kopf-/Fußzeilen aus gedruckten PDFs und Seitenreste */
const NOISE = [
  /^https?:\/\/\S+(\s+\d+\s*\/\s*\d+)?$/i,
  /^www\.\S+$/i,
  /^\d{1,2}\.\d{1,2}\.\d{2,4},?\s+\d{1,2}\D?\d{2}\b/,
  /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\b/,
  /^\d+\s*\/\s*\d+$/,
  /^Seite\s+\d+(\s*(von|\/)\s*\d+)?$/i,
  /^©/,
  /^(drucken|teilen|merken|bewerten|speichern|pdf|zur einkaufsliste|auf die einkaufsliste|rezept drucken|jetzt bewerten|zum rezept|anmelden|registrieren|werbung|anzeige)$/i,
];
export const isNoise = (l: string) => NOISE.some((re) => re.test(l));
const NOT_TITLE = /[›»]|\s>\s.*\s>\s|⭐|★|Bewertung|^\d+([,.]\d)?\s*(von 5|\/\s*5)|^(Startseite|Home|Rezepte)\b/i;

function cleanLine(l: string): string {
  return l.replace(/ /g, ' ').replace(/[\t ]+/g, ' ').replace(/^\s*[•●▪◦\-–*·✓☐□]\s*/, '').trim();
}

interface Meta {
  title: string; description: string; servings: number | null; servingsUnit: string;
  prepTime: number | null; cookTime: number | null; restTime: number | null; totalTime: number | null;
  difficulty: Difficulty | null;
}

const minutes = (s: string) => { const d = parseDuration(s); return d ? Math.round(d / 60) : null; };

function parseMeta(line: string, meta: Meta, section: string): boolean {
  let m: RegExpMatchArray | null;
  if (section === 'ingr' && !/^(?:\d+\s*(?:Portion(?:en)?|Personen)\s*$|(?:Portionen|Personen|Arbeitszeit|Vorbereitungszeit|Zubereitungszeit|Gesamtzeit|Backzeit|Kochzeit|Ruhezeit|Gehzeit)\b)/i.test(line)) return false;
  if ((m = line.match(/(\d+)\s*(?:Portion(?:en)?|Personen|Pers\.)\b/i)) ||
      (section === 'head' && (m = line.match(/^(\d+)\s*(Stück|Brote?|Laib(?:e)?|Kuchen|Torten?|Bleche?|Gläser|Glas|Muffins|Brötchen|Kugeln|Waffeln|Pfannkuchen|Zöpfe|Zopf|Kranz|Gläser|Flaschen?|Stangen?|Pizzen|Pizza|Tartes?|Springform)\s*$/i))) ||
      (m = line.match(/^(?:Portionen|Personen|Menge|Ergibt|Für)\s*:?\s*(\d+)/i))) {
    if (!meta.servings) {
      meta.servings = parseInt(m[1], 10);
      const unit = line.match(/\d+\s*([A-Za-zÄÖÜäöüß]+)/)?.[1] ?? '';
      meta.servingsUnit = /^(Portion|Person|Pers)/i.test(unit) || !unit ? 'Portionen' : unit;
    }
    return true;
  }
  if ((m = line.match(/^(?:Arbeitszeit|Vorbereitungszeit|Vorbereitung|Aktive Zeit|Arbeit|Zubereitungszeit)\s*:?\s*(.+)$/i))) {
    const v = minutes(m[1]); if (v) meta.prepTime = v; return true;
  }
  if ((m = line.match(/^(?:Gesamtzeit|Gesamt|Total|Fertig in)\s*:?\s*(.+)$/i))) {
    const v = minutes(m[1]); if (v) meta.totalTime = v; return true;
  }
  if ((m = line.match(/^(?:Backzeit|Kochzeit|Garzeit|Back- ?\/ ?Kochzeit)\s*:?\s*(.+)$/i))) {
    const v = minutes(m[1]); if (v) meta.cookTime = v; return true;
  }
  if ((m = line.match(/^(?:Ruhezeit|Gehzeit|Wartezeit|Kühlzeit|Ruhe- ?\/ ?Gehzeit)\s*:?\s*(.+)$/i))) {
    const v = minutes(m[1]); if (v) meta.restTime = (meta.restTime ?? 0) + v; return true;
  }
  if ((m = line.match(/^(?:Schwierigkeit(?:sgrad)?|Level)\s*:?\s*(einfach|leicht|mittel|aufwendig|schwer|anspruchsvoll)?/i))) {
    if (m[1]) meta.difficulty = toDifficulty(m[1]);
    return true;
  }
  if (/^(einfach|leicht|mittel|aufwendig|schwer|anspruchsvoll)$/i.test(line)) { meta.difficulty = toDifficulty(line); return true; }
  return false;
}

function toDifficulty(s: string): Difficulty {
  if (/einfach|leicht/i.test(s)) return 'einfach';
  if (/mittel/i.test(s)) return 'mittel';
  return 'aufwendig';
}

/** Zutaten durch Leerzeilen getrennt (typisch PDF) → Zeilen eines Blocks gehören zusammen. */
function mergeIngredientBlocks(lines: string[]): string[] {
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (l === '') { if (cur.length) blocks.push(cur); cur = []; } else cur.push(l);
  }
  if (cur.length) blocks.push(cur);
  const nonEmpty = lines.filter(Boolean).length;
  const blankStructured = blocks.length >= 3 && blocks.length >= nonEmpty * 0.6;
  if (!blankStructured) return lines.filter(Boolean);
  // Gruppen-Überschriften nicht mit der ersten Zutat verschmelzen
  return blocks.flatMap((b) => (b.length > 1 && isGroupHeader(b[0]) ? [b[0], b.slice(1).join(' ')] : [b.join(' ')]));
}

function joinQuantityLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (QTY_ONLY.test(l) && i + 1 < lines.length && !QTY_ONLY.test(lines[i + 1]) && !isGroupHeader(lines[i + 1])) {
      out.push(`${l} ${lines[i + 1]}`); i++;
    } else out.push(l);
  }
  return out;
}

const NUMBERED = /^\s*(?:Schritt\s*)?\d{1,2}\s*[.):]\s*\S/i;

function splitSteps(lines: string[]): string[] {
  const steps: string[] = [];
  const numbered = lines.filter((l) => NUMBERED.test(l)).length >= 2;
  for (const raw of lines) {
    if (raw === '') { if (!numbered && steps.length && steps[steps.length - 1] !== '') steps.push(''); continue; }
    if (/^\s*(?:Schritt\s*)?\d{1,2}\s*[.):]?\s*$/i.test(raw)) { steps.push(''); continue; }
    const isNew = NUMBERED.test(raw);
    const text = raw.replace(/^\s*(?:Schritt\s*)?\d{1,2}\s*[.):]\s*/i, '').trim();
    if (!text) continue;
    if (numbered && !isNew && steps.length) steps[steps.length - 1] = `${steps[steps.length - 1]} ${text}`.trim();
    else if (steps.length && steps[steps.length - 1] === '') steps[steps.length - 1] = text;
    else if (!numbered && steps.length && !/[.!?:)]$/.test(steps[steps.length - 1]) && /^[a-zäöüß]/.test(text)) {
      // Zeilenumbruch mitten im Satz (PDF) → anhängen
      steps[steps.length - 1] += ` ${text}`;
    } else steps.push(text);
  }
  return steps.filter(Boolean);
}

const ACCESSORY_RULES: [RegExp, Accessory][] = [
  [/rühraufsatz|schmetterling/i, 'butterfly'],
  [/gareinsatz(?! als deckel)/i, 'basket'],
  [/gareinsatz als deckel|anstelle des messbechers/i, 'basketAsLid'],
  [/\bvaroma\b(?!\s*\/)/i, 'varoma'],
  [/ohne messbecher|messbecher (entfernen|abnehmen)/i, 'cupOff'],
  [/mit (dem )?spatel|spatel nach unten/i, 'spatula'],
];

export function detectAccessories(text: string): Accessory[] {
  const out = new Set<Accessory>();
  for (const [re, a] of ACCESSORY_RULES) if (re.test(text)) out.add(a);
  if (findSettings(text).some((s) => s.temp === 'Varoma')) out.add('varoma');
  return [...out];
}

export function makeStep(text: string): Step {
  const t = text.replace(/\s+/g, ' ').trim();
  return {
    id: newId(), text: t, accessories: detectAccessories(t),
    restMinutes: findSettings(t).length ? null : findRestMinutes(t),
    suggestions: suggestForStep(t),
  };
}

const CATEGORY_RULES: [RegExp, Category][] = [
  [/suppe(?!ngrün)|eintopf|eintöpfe|bouillon|chowder|gazpacho|minestrone/i, 'Suppen'],
  [/salat|dressing|vinaigrette/i, 'Salate'],
  [/brot|brötchen|baguette|ciabatta|focaccia|zopf|semmel|laugen|knäcke|fladen/i, 'Brot und Brötchen'],
  [/kuchen|torte|muffin|cupcake|brownie|plätzchen|kekse|cookies|waffel|stollen|strudel|gugelhupf|tarte\b|cheesecake/i, 'Kuchen'],
  [/dessert|mousse|pudding|\bcreme\b|crème|\beis\b|sorbet|tiramisu|panna cotta|kompott|grütze|parfait/i, 'Desserts'],
  [/soße|sauce|dip\b|pesto|aioli|mayonnaise|chutney|ketchup|hollandaise|gravy/i, 'Soßen'],
  [/smoothie|getränk|saft|limonade|likör|shake|tee\b|kakao|punsch|sirup|eistee|bowle/i, 'Getränke'],
  [/frühstück|müsli|porridge|marmelade|konfitüre|aufstrich|granola|overnight|nutella|brotaufstrich|rührei/i, 'Frühstück'],
  [/beilage|püree|reis\b|risotto|kartoffel|polenta|spätzle|knödel|gemüsebeilage|couscous|bulgur/i, 'Beilagen'],
  [/mit fleisch|mit geflügel|mit fisch|roulade|gyros|gulasch|braten|hähnchen|huhn|rind|schwein|fleisch|hack|lasagne|nudel|pasta|spaghetti|auflauf|curry|chili|geschnetzeltes|fisch|lachs|pizza|quiche|burger|bolognese|frikadelle|schnitzel|wrap|tacos/i, 'Hauptgerichte'],
];

export function guessCategory(title: string, rest = ''): Category {
  for (const [re, c] of CATEGORY_RULES) if (re.test(title)) return c;
  for (const [re, c] of CATEGORY_RULES) if (re.test(rest)) return c;
  return 'Sonstiges';
}

/**
 * Hauptfunktion: Text → Rezept.
 */
export function parseRecipeText(input: string, source: { type: SourceType; name: string; url?: string } = { type: 'text', name: 'eingefügter Text' }): Recipe {
  const lines = String(input || '').split(/\r?\n/).map(cleanLine);
  const meta: Meta = { title: '', description: '', servings: null, servingsUnit: 'Portionen', prepTime: null, cookTime: null, restTime: null, totalTime: null, difficulty: null };
  const head: string[] = [], ingr: string[] = [], stepsRaw: string[] = [], desc: string[] = [];
  let section: 'head' | 'ingr' | 'steps' | 'stop' | 'desc' = 'head';

  const expanded: string[] = [];
  for (const line of lines) {
    if (/\s[·•|]\s/.test(line) && /(arbeitszeit|gesamtzeit|zubereitungszeit|backzeit|portion|personen|schwierigkeit)/i.test(line)) {
      expanded.push(...line.split(/\s[·•|]\s/).map((x) => x.trim()));
    } else expanded.push(line);
  }

  for (const line of expanded) {
    if (!line) { if (section === 'steps') stepsRaw.push(''); else if (section === 'ingr') ingr.push(''); continue; }
    if (isNoise(line)) continue;
    if (H_INGR.test(line) && line.length < 45) {
      section = 'ingr';
      if (/(\d+)\s*(Portion|Person|Stück)/i.test(line)) parseMeta(line.replace(/^.*?(\d+)/, '$1'), meta, 'head');
      continue;
    }
    if (H_STEPS.test(line) && line.length < 45) { section = 'steps'; continue; }
    // Ohne „Zutaten“-Überschrift: „Für den Teig:“ beginnt die Zutatenliste
    if (section === 'head' && head.length && isGroupHeader(line) && /^für\s/i.test(line)) { section = 'ingr'; ingr.push(line); continue; }
    if (H_DESC.test(line)) { section = 'desc'; continue; }
    if (H_STOP.test(line)) { section = 'stop'; continue; }
    if (section === 'stop') continue;
    if (section !== 'steps' && parseMeta(line, meta, section)) continue;
    if (section === 'head') head.push(line);
    else if (section === 'desc') desc.push(line);
    else if (section === 'ingr') ingr.push(line);
    else stepsRaw.push(line);
  }

  if (!ingr.filter(Boolean).length && !stepsRaw.filter(Boolean).length && head.length) {
    // Keine Überschriften → heuristisch trennen
    meta.title = head.shift() ?? '';
    for (const l of head) {
      if (findSettings(l).length || l.length > 70 || /[.!]$/.test(l)) stepsRaw.push(l);
      else ingr.push(l);
    }
  } else {
    const titleIdx = head.findIndex((l) => !NOT_TITLE.test(l) && l.length <= 100);
    meta.title = titleIdx >= 0 ? head[titleIdx] : head[0] ?? '';
    // Längere Sätze im Kopf nach dem Titel = Beschreibung
    if (titleIdx >= 0) desc.push(...head.slice(titleIdx + 1).filter((l) => l.length > 40 && !NOT_TITLE.test(l)));
  }

  // Zutaten mit Gruppen
  const ingredients = [];
  let group = '';
  for (const l of joinQuantityLines(mergeIngredientBlocks(ingr))) {
    if (/^(drucken|teilen|merken|zur einkaufsliste)/i.test(l)) continue;
    if (isGroupHeader(l)) { group = l.replace(/:$/, '').trim(); continue; }
    ingredients.push(parseIngredient(l, group));
  }

  const steps = splitSteps(stepsRaw).map(makeStep);
  const restFromSteps = steps.reduce((sum, s) => sum + (s.restMinutes ?? 0), 0);

  const r = emptyRecipe();
  const title = meta.title.replace(/\s+[-–|]\s+(Zaubertopf|Thermomix|Cookidoo|Rezept|Chefkoch).*$/i, '').trim();
  Object.assign(r, {
    title,
    description: desc.join(' ').slice(0, 1000),
    category: guessCategory(title, ingredients.map((i) => i.name).join(' ')),
    difficulty: meta.difficulty,
    servings: meta.servings,
    servingsUnit: meta.servingsUnit,
    prepTime: meta.prepTime,
    cookTime: meta.cookTime,
    restTime: meta.restTime ?? (restFromSteps || null),
    totalTime: meta.totalTime,
    ingredients,
    steps,
    source,
  });
  return r;
}
