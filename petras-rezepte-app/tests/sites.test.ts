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
  assert.equal(r.recipe.steps.length, 4);
  const s = tm(r);
  assert.deepEqual(s.map((o) => [o.time ?? null, o.temp ?? null, o.speed, !!o.reverse]), [[5, null, '5', false], [180, 120, '1', false], [1200, 100, 'soft', true], [null, 'Varoma', 'soft', true]]);
  assert.deepEqual(r.subRecipes.map((x) => x.title), ['Gemüsepaste'], 'nur Teilrezepte aus Zutaten/Schritten, keine Empfehlungen');
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
  { f: 'zt-gyros.html', title: 'Schnelles Gyros-Feierabendblech', ingr: 15, cat: 'Hauptgerichte', steps: 5, groups: ['Für das Blech', 'Für die Gyros-Soße', 'Außerdem'], tm: [['turbo', 2], ['manual', 10]] },
  { f: 'zt-rouladen.html', title: 'Weltbeste Rouladen im Varoma®', ingr: 17, cat: 'Hauptgerichte', steps: 4, groups: ['Für die Rouladen', 'Für die Soße', 'Außerdem'], tm: [['manual', 8], ['manual', 8], ['manual', 240], ['manual', 4500], ['manual', 30]] },
  { f: 'zt-bandnudeln.html', title: 'Bandnudeln mit Hähnchen, Brokkoli und Tomaten', ingr: null, cat: 'Hauptgerichte', steps: 4, groups: null, tm: [['manual', 600], ['manual', 300], ['manual', null]] },
];
for (const p of PRIVAT) {
  const path = `fixtures/privat/${p.f}`;
  test(`Gespeicherte Club-Seite: ${p.f}`, { skip: !existsSync(new URL(path, import.meta.url)) && 'nur lokal vorhanden (urheberrechtlich geschützt)' }, () => {
    const r = extractFromDom(load(path));
    assert.equal(r.complete, true);
    assert.equal(r.recipe.title, p.title);
    if (p.ingr) assert.equal(r.recipe.ingredients.length, p.ingr);
    if (p.groups) assert.deepEqual([...new Set(r.recipe.ingredients.map((i) => i.group))], p.groups);
    assert.equal(r.recipe.steps.length, p.steps, r.recipe.steps.map((s) => s.text.slice(0, 50)).join('\n'));
    assert.deepEqual(tm(r).map((o) => [o.mode, o.time ?? null]), p.tm);
    assert.equal(r.recipe.category, p.cat);
    assert.ok(!r.notes.some((n) => /weitere Einstellung/.test(n)), `Kochmodus-Abgleich: ${r.notes.join(' | ')}`);
    console.log(`   ${p.f}: ${r.recipe.ingredients.length} Zutaten, ${r.recipe.steps.length} Schritte, ${tm(r).length} TM · Hinweise: ${r.notes.join(' | ') || '–'}`);
  });
}
