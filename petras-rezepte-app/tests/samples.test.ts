/** Phase 4: Testrezepte aus verschiedenen Kategorien */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parseRecipeText } from '../shared/parser.ts';
import { findSettings } from '../shared/tm.ts';
import { validateRecipe } from '../shared/validate.ts';
import { buildInstructions, buildMeta } from '../shared/cookidoo.ts';

const load = (f: string) => parseRecipeText(readFileSync(new URL(`../samples/${f}`, import.meta.url), 'utf8'), { type: 'sample', name: f });
const settings = (r: ReturnType<typeof load>) => r.steps.flatMap((s) => findSettings(s.text));

test('Suppe: Meta-Zeile, Zubehör, Bereich bei Stufe', () => {
  const r = load('01-tomatensuppe.txt');
  assert.equal(r.title, 'Cremige Tomatensuppe');
  assert.equal(r.category, 'Suppen');
  assert.deepEqual([r.servings, r.prepTime, r.totalTime, r.difficulty], [4, 10, 35, 'einfach']);
  assert.equal(r.ingredients.length, 9);
  assert.equal(r.steps.length, 4);
  assert.equal(settings(r).length, 4);
  assert.ok(r.steps[0].accessories.includes('spatula'));
  assert.ok(r.steps[2].accessories.includes('basketAsLid'));
  assert.equal(settings(r)[3].speed, '4', 'Bereich „Stufe 4-8“ → Startstufe');
  assert.ok(!validateRecipe(r).some((i) => i.level === 'fehler'));
});

test('Fleisch: Anbraten-Modus, Sanftrührstufe, Linkslauf, Kochzeit', () => {
  const r = load('02-rindergulasch.txt');
  assert.equal(r.category, 'Hauptgerichte');
  assert.deepEqual([r.prepTime, r.cookTime, r.totalTime], [20, 90, 110]);
  const s = settings(r);
  assert.equal(s.find((x) => x.mode === 'browning')?.temp, 160);
  assert.ok(s.filter((x) => x.speed === 'soft' && x.reverse).length >= 3);
  assert.ok(r.steps[2].accessories.includes('cupOff'));
  assert.equal(r.ingredients.find((i) => i.name.startsWith('Rindergulasch'))?.note, 'in Würfeln (3 cm)');
  // Cookidoo-Format: auf Stufe 1 werden Sonderwerte entfernt, Grundwerte bleiben
  assert.ok(buildInstructions(r, 0).buttons > buildInstructions(r, 1).buttons);
});

test('Kuchen: ohne Überschrift „Zutaten“, mit Gruppen, unnummerierte Schritte', () => {
  const r = load('03-zitronenkuchen.txt');
  assert.equal(r.title, 'Saftiger Zitronenkuchen');
  assert.equal(r.category, 'Kuchen');
  assert.ok(r.ingredients.length >= 10, `Zutaten: ${r.ingredients.length}`);
  assert.deepEqual([...new Set(r.ingredients.map((i) => i.group))], ['Für den Teig', 'Für den Guss']);
  assert.equal(r.steps.length, 6);
  assert.equal(settings(r).length, 3);
  assert.equal(r.steps[0].suggestions.length, 0, 'Backofen → kein Vorschlag');
  assert.equal(r.steps[5].suggestions[0]?.setting.speed, '4', 'Guss verrühren → Vorschlag');
});

test('Brot: Gehzeit über Nacht, Backzeit, Stückzahl', () => {
  const r = load('04-dinkelbroetchen.txt');
  assert.equal(r.category, 'Brot und Brötchen');
  assert.deepEqual([r.servings, r.servingsUnit, r.prepTime, r.cookTime, r.restTime], [12, 'Brötchen', 15, 25, 720]);
  assert.equal(r.steps[2].restMinutes, 720);
  assert.equal(settings(r)[1].mode, 'dough');
  assert.ok(!validateRecipe(r).some((i) => /Menge fehlt/.test(i.message) && /Mehl zum/.test(i.message)), '„Mehl zum Bearbeiten“ braucht keine Menge');
});

test('Varoma: Dampfgaren, Gareinsatz, zwei Gruppen', () => {
  const r = load('05-gemuese-varoma.txt');
  const v = settings(r).find((x) => x.temp === 'Varoma');
  assert.equal(v?.time, 1500);
  assert.ok(r.steps[2].accessories.includes('varoma'));
  assert.ok(r.steps[0].accessories.includes('basket'));
  assert.equal(r.ingredients.filter((i) => i.group === 'Für die Soße').length, 3);
  const meta = buildMeta(r);
  assert.ok(meta.ingredients.some((i) => i.text === '– Für die Soße –'));
});

test('Rezept ohne Thermomix-Angaben → nur Vorschläge, klar gekennzeichnet', () => {
  const r = load('06-ohne-tm-angaben.txt');
  assert.equal(settings(r).length, 0, 'nichts wird als Original ausgegeben');
  const sug = r.steps.filter((s) => s.suggestions.length);
  assert.ok(sug.length >= 2);
  assert.ok(sug.every((s) => s.suggestions[0].source === 'regel'));
  assert.equal(r.steps[3].restMinutes, 60);
  assert.equal(r.ingredients[0].unit, 'kg');
});
