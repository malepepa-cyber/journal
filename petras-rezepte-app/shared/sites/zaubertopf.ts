/**
 * Leser für Rezeptseiten des „mein ZauberTopf-Club“ (zaubertopf-club.de).
 * Arbeitet mit dem Seitenaufbau (DOM) – im Browser (Lesezeichen, gespeicherte HTML-Datei)
 * und in Tests (linkedom). Liest:
 *  - Titel, Einleitung, Portionen, Zubereitungszeit
 *  - Zutaten-Tabellen mit Gruppen („Für das Blech“, „Außerdem“ …)
 *  - Zubereitungsschritte (Schreibweise „10 Sek. | Stufe 4“)
 *  - den „Kochmodus“ (strukturierte Thermomix-Werte) zum Abgleich
 *  - Links zu Teilrezepten in Zutaten/Schritten (nicht: Empfehlungen, Fußzeile)
 *
 * Hinweis: Ohne Anmeldung zeigt der Club nur eine Vorschau (Schritte enden mit „…“).
 */
import { emptyRecipe, type Ingredient, type Recipe, type TmSetting } from '../model.ts';
import { parseIngredient, parseAmount, normalizeUnit } from '../ingredients.ts';
import { makeStep, guessCategory } from '../parser.ts';
import { findSettings, formatSetting, parseDuration } from '../tm.ts';

export interface SiteResult {
  recipe: Recipe;
  /** Hinweise für die Prüfung (z. B. Kochmodus-Abgleich) */
  notes: string[];
  /** Verlinkte Teilrezepte (gleiche Website) */
  subRecipes: { title: string; url: string }[];
  /** false = Seite zeigt nur eine Vorschau (nicht angemeldet) */
  complete: boolean;
}

const clean = (s: string | null | undefined) =>
  String(s ?? '').replace(/­/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

export function isZaubertopf(doc: Document): boolean {
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '';
  const site = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ?? '';
  return /zaubertopf/i.test(canonical) || /zaubertopf/i.test(site)
    || (!!doc.querySelector('.stepcounter') && !!doc.querySelector('.ingredients table'));
}

/** Kochmodus-Folien mit Thermomix-Werten */
export function readCookingMode(doc: Document): { label: string; setting: TmSetting }[] {
  const out: { label: string; setting: TmSetting }[] = [];
  for (const slide of Array.from(doc.querySelectorAll('.swiper-slide'))) {
    const time = slide.querySelector('.cooking_wizard_icon_time');
    if (!time) continue;
    const mm = Number(clean(time.querySelector('.value.left')?.textContent)) || 0;
    const ss = Number(clean(time.querySelector('.value.right')?.textContent)) || 0;
    const tempBox = slide.querySelector('.cooking_wizard_icon_temperature');
    // Nur den Dateinamen prüfen – der Ordner einer gespeicherten Seite kann z. B. „…Varoma…_files“ heißen
    const file = (el: Element | null | undefined) => (el?.querySelector('img')?.getAttribute('src') ?? '').split(/[/\\]/).pop() ?? '';
    const tempImg = file(tempBox);
    const tempVal = Number(clean(tempBox?.querySelector('.value')?.textContent)) || 0;
    const power = slide.querySelector('.cooking_wizard_icon_power');
    const powerImg = file(power);
    const speedRaw = clean(power?.querySelector('.value')?.textContent).replace(/\s/g, '');
    const s: TmSetting = { mode: 'manual', time: mm * 60 + ss || null };
    if (/varoma/i.test(tempImg)) s.temp = 'Varoma';
    else if (tempVal > 0) s.temp = tempVal;
    if (/turbo/i.test(powerImg)) { s.mode = 'turbo'; s.temp = null; }
    else {
      if (/links/i.test(powerImg)) s.reverse = true;
      const first = speedRaw.split(/[-–]/)[0];
      const n = parseFloat(first);
      if (Number.isFinite(n)) s.speed = n < 0.5 ? 'soft' : String(Math.round(n * 2) / 2);
    }
    out.push({ label: clean(slide.querySelector('.instrumentaction')?.textContent) || 'Einstellung', setting: s });
  }
  return out;
}

const same = (a: TmSetting, b: TmSetting) =>
  a.mode === b.mode && (a.time ?? 0) === (b.time ?? 0) && String(a.temp ?? '') === String(b.temp ?? '')
  && (a.mode === 'turbo' || (String(a.speed ?? '') === String(b.speed ?? '') && !!a.reverse === !!b.reverse));

export function extractZaubertopf(doc: Document, url = ''): SiteResult | null {
  if (!isZaubertopf(doc)) return null;
  const notes: string[] = [];
  const pageUrl = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || url;
  const r = emptyRecipe();

  r.title = clean(doc.querySelector('h1')?.textContent);
  r.description = clean(doc.querySelector('.steps .text-wrapper:not(.body) p, .stepwrapper .text-wrapper p')?.textContent).slice(0, 1000);
  const portion = clean(doc.querySelector('li.portion')?.textContent || doc.querySelector('.calculator .info')?.textContent);
  const pm = portion.match(/(\d+)\s*([A-Za-zÄÖÜäöüß]+)?/);
  if (pm) { r.servings = Number(pm[1]); r.servingsUnit = !pm[2] || /person|portion/i.test(pm[2]) ? 'Portionen' : pm[2]; }
  const t = parseDuration(clean(doc.querySelector('li.time')?.textContent));
  if (t) r.totalTime = Math.round(t / 60);

  // ---- Zutaten (Tabellen mit Gruppen) ----
  const subRecipes: SiteResult['subRecipes'] = [];
  const addLink = (a: Element) => {
    const href = a.getAttribute('href') ?? '';
    if (/\/rezept\/[^/]+\.html/.test(href) && !href.startsWith(pageUrl) && !subRecipes.some((x) => x.url === href)) {
      subRecipes.push({ title: clean(a.textContent) || href, url: href });
    }
  };
  const ingredients: Ingredient[] = [];
  for (const table of Array.from(doc.querySelectorAll('.ingredients table'))) {
    let group = '';
    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const th = row.querySelector('th');
      if (th) { group = clean(th.textContent); continue; }
      const cells = row.querySelectorAll('td');
      if (cells.length < 2) continue;
      const qty = cells[0], nameCell = cells[1];
      const raw = clean(qty.querySelector('.vueoffshow')?.textContent);
      // Einheit = Text der Mengenspalte ohne die Zahlen-Elemente
      let unitText = '';
      for (const n of Array.from(qty.childNodes)) if (n.nodeType === 3) unitText += n.textContent ?? '';
      const name = clean(nameCell.textContent).replace(/,\s*,/g, ',');
      nameCell.querySelectorAll('a').forEach(addLink);
      if (!name) continue;
      const parsed = parseIngredient(name, group); // trennt Name und Zusatz („…, in Stücken“)
      const amount = raw ? parseAmount(raw.replace(',', '.')) : null;
      ingredients.push({ ...parsed, amount, amountMax: null, unit: normalizeUnit(clean(unitText)), group });
    }
  }
  r.ingredients = ingredients;

  // ---- Schritte ----
  const seen = new Set<Element>();
  const steps: string[] = [];
  for (const counter of Array.from(doc.querySelectorAll('.stepcounter'))) {
    const box = counter.closest('.step');
    if (!box || seen.has(box)) continue;
    seen.add(box);
    const paras = Array.from(box.querySelectorAll('p'));
    paras.forEach((p) => p.querySelectorAll('a').forEach(addLink));
    const text = clean(paras.map((p) => p.textContent).join(' '));
    if (text) steps.push(text);
  }
  r.steps = steps.map(makeStep);
  r.restTime = r.steps.reduce((s, x) => s + (x.restMinutes ?? 0), 0) || null;
  // Schlagworte der Seite („Mit Fleisch“, „Suppen & Eintöpfe“ …) helfen bei der Kategorie
  const tags = Array.from(doc.querySelectorAll('a[href*="/rezepte?filter"]')).map((a) => clean(a.textContent)).join(' ');
  r.category = guessCategory(r.title, `${tags} ${r.ingredients.map((i) => i.name).join(' ')}`);
  r.source = { type: 'web', name: 'ZauberTopf Club', url: pageUrl || undefined };

  // ---- Vollständig? ----
  let complete = steps.length > 0;
  if (!complete) {
    // Nur Vorschau: Rezeptdaten der Seite nutzen (Schritte meist abgeschnitten)
    for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const d = JSON.parse(s.textContent ?? '');
        if (d['@type'] !== 'Recipe') continue;
        const ins: string[] = (d.recipeInstructions ?? []).map((x: { text?: string }) => clean(x.text)).filter((x: string) => x && x !== '...');
        r.steps = ins.map(makeStep);
        if (!r.title) r.title = clean(d.name);
      } catch { /* ignorieren */ }
    }
    notes.push('Die Seite zeigt nur eine Vorschau – die Zubereitung ist unvollständig. Bitte angemeldet im Club öffnen und das Lesezeichen verwenden oder die Seite angemeldet speichern (Strg + S).');
  }

  // ---- Abgleich mit dem Kochmodus ----
  const cm = readCookingMode(doc);
  if (cm.length && complete) {
    const textSettings = r.steps.flatMap((s, i) => findSettings(s.text).map((o) => ({ step: i, o })));
    const unmatched = cm.filter((c) => !textSettings.some((t) => same(t.o, c.setting)));
    for (const t of textSettings) {
      if (t.o.time == null) {
        const hint = cm.find((c) => !c.setting.time && String(c.setting.temp ?? '') === String(t.o.temp ?? ''));
        notes.push(`Schritt ${t.step + 1}: Keine feste Zeit (${t.o.match.trim()}).${hint ? ` Kochmodus: „${hint.label}“.` : ''} Zeit bitte selbst einstellen.`);
      }
    }
    const extra = unmatched.filter((c) => c.setting.time);
    if (extra.length) notes.push(`Kochmodus enthält ${extra.length} weitere Einstellung(en), die im Text anders stehen: ${extra.map((c) => `„${c.label}“ ${formatSetting(c.setting)}`).join(' · ')} – bitte prüfen.`);
  }
  return { recipe: r, notes, subRecipes, complete };
}
