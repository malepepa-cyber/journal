/** Zaubertopf-Seitenleser: eigene Testseite (immer) + gespeicherte Club-Seiten (nur lokal, falls vorhanden) */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { extractFromDom } from '../shared/sites/generic.ts';
import { findSettings } from '../shared/tm.ts';
import { formatIngredient } from '../shared/ingredients.ts';

const load = (p: string) => parseHTML(readFileSync(new URL(p, import.meta.url), 'utf8')).document as unknown as Document;
const tm = (r: ReturnType<typeof extractFromDom>) => r.recipe.steps.flatMap((s) => findSettings(s.text));

test('Zaubertopf-Aufbau (eigene Testseite)', () => {
  const r = extractFromDom(load('fixtures/zaubertopf-aufbau.html'));
  assert.equal(r.method, 'ZauberTopf Club');
  assert.equal(r.complete, true);
  assert.equal(r.recipe.title, 'Test-Linsencurry mit Kokos', 'Silbentrennzeichen entfernt');
  assert.match(r.recipe.description, /cremiges Curry/);
  assert.deepEqual([r.recipe.servings, r.recipe.totalTime], [4, 40]);
  assert.deepEqual(r.recipe.ingredients.map(formatIngredient), ['1 Zwiebel, halbiert', '20 g Rapsöl', '200 g rote Linsen', '½ TL Salz', '400 g Kokosmilch, alternativ Sahne', '1 EL Gemüsepaste', 'Koriander zum Garnieren', 'Gareinsatz']);
  assert.deepEqual([...new Set(r.recipe.ingredients.map((i) => i.group))], ['Für das Curry', 'Außerdem']);
  // Schritte aus dem Kochmodus (Thermomix-Reihenfolge, Zutaten je Schritt); Originaltext bleibt umschaltbar
  assert.deepEqual(r.recipe.steps.map((s) => s.text), [
    '1 Zwiebel, halbiert in den Mixtopf geben und 5 Sek./Stufe 5 zerkleinern. Mit dem Spatel nach unten schieben.',
    '20 g Rapsöl in den Mixtopf geben und 3 Min./120°C/Stufe 1 andünsten.',
    '200 g rote Linsen und 400 g Kokosmilch in den Mixtopf geben und 20 Min./100°C/Linkslauf/Sanftrührstufe köcheln. Reis in den Gareinsatz geben und den Varoma® aufsetzen.',
    'Reis nach Packungsangabe garen (Varoma/Linkslauf/Sanftrührstufe).',
    'Mit Koriander garniert servieren.',
  ]);
  assert.deepEqual(r.recipe.steps.map((s) => s.ingredients), [['1 Zwiebel, halbiert'], ['20 g Rapsöl'], ['200 g rote Linsen', '400 g Kokosmilch'], [], []]);
  assert.equal(r.recipe.altSteps?.steps.length, 4);
  const s = r.recipe.altSteps!.steps.flatMap((x) => findSettings(x.text));
  assert.deepEqual(s.map((o) => [o.time ?? null, o.temp ?? null, o.speed, !!o.reverse]), [[5, null, '5', false], [180, 120, '1', false], [1200, 100, 'soft', true], [null, 'Varoma', 'soft', true]]);
  assert.deepEqual(r.subRecipes.map((x) => x.title), ['Gemüsepaste'], 'nur Teilrezepte aus Zutaten/Schritten, keine Empfehlungen');
  assert.ok(r.notes[0].includes('Kochmodus übernommen'));
  assert.ok(r.notes.some((n) => /Schritt 4: Keine feste Zeit.*Reis nach Packungsangabe/.test(n)), r.notes.join('\n'));
  assert.ok(!r.notes.some((n) => /weitere Einstellung/.test(n)), 'Kochmodus stimmt mit Text überein');
});

test('Vorschau ohne Anmeldung wird erkannt', () => {
  const html = readFileSync(new URL('fixtures/zaubertopf-aufbau.html', import.meta.url), 'utf8').replace(/<div class="row step">[\s\S]*?<\/div><\/div>\s*<\/div><\/div>/, '');
  const doc = parseHTML(html.replace(/stepcounter/g, 'x')).document as unknown as Document;
  const r = extractFromDom(doc);
  assert.equal(r.complete, false);
  assert.ok(r.notes[0].includes('Vorschau'));
});

const PRIVAT = [
  { f: 'zt-gyros.html', title: 'Schnelles Gyros-Feierabendblech', ingr: 15, cat: 'Hauptgerichte', steps: 8, orig: 5, tm: 2, weigh: 4, groups: ['Für das Blech', 'Für die Gyros-Soße', 'Außerdem'] },
  { f: 'zt-rouladen.html', title: 'Weltbeste Rouladen im Varoma®', ingr: 17, cat: 'Hauptgerichte', steps: 7, orig: 4, tm: 5, weigh: 15, groups: ['Für die Rouladen', 'Für die Soße', 'Außerdem'] },
  { f: 'zt-bandnudeln.html', title: 'Bandnudeln mit Hähnchen, Brokkoli und Tomaten', ingr: 12, cat: 'Hauptgerichte', steps: 6, orig: 4, tm: 3, weigh: 4, groups: null },
  { f: 'zt-tortellini.html', title: 'Virale Marry Me Tortellini', ingr: 10, cat: 'Hauptgerichte', steps: 9, orig: 4, tm: 7, weigh: 11, groups: null },
];
for (const p of PRIVAT) {
  const path = `fixtures/privat/${p.f}`;
  test(`Gespeicherte Club-Seite: ${p.f}`, { skip: !existsSync(new URL(path, import.meta.url)) && 'nur lokal vorhanden (urheberrechtlich geschützt)' }, () => {
    const r = extractFromDom(load(path));
    assert.equal(r.complete, true);
    assert.equal(r.recipe.title, p.title);
    assert.equal(r.recipe.ingredients.length, p.ingr);
    if (p.groups) assert.deepEqual([...new Set(r.recipe.ingredients.map((i) => i.group))], p.groups);
    assert.equal(r.recipe.category, p.cat);
    assert.equal(r.recipe.steps.length, p.steps, r.recipe.steps.map((s) => s.text.slice(0, 60)).join('\n'));
    assert.equal(r.recipe.altSteps?.steps.length, p.orig);
    assert.equal(tm(r).length, p.tm, 'alle Kochmodus-Einstellungen in den Schritten');
    assert.equal(r.recipe.steps.reduce((n, s) => n + (s.ingredients?.length ?? 0), 0), p.weigh);
    for (const s of r.recipe.steps) for (const i of s.ingredients ?? []) assert.ok(s.text.includes(i), `Zutat „${i}“ steht im Schritt`);
    assert.ok(!r.notes.some((n) => /weitere Einstellung/.test(n)), `Kochmodus-Abgleich: ${r.notes.join(' | ')}`);
  });
}
