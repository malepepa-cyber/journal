import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findOperations, parseRecipeText, parseDuration } from '../public/parser.js';

test('Dauer', () => {
  assert.equal(parseDuration('1 Min. 30 Sek.'), 90);
  assert.equal(parseDuration('10-15 Sek.'), 10);
  assert.equal(parseDuration('1,5 Min.'), 90);
  assert.equal(parseDuration('1 Std. 10 Min.'), 4200);
});

test('Einfache Schritte', () => {
  const t = 'Zwiebel in den Mixtopf geben, 5 Sek./Stufe 5 zerkleinern.';
  const [o] = findOperations(t);
  assert.equal(o.time, 5); assert.equal(o.speed, '5'); assert.equal(o.temp, undefined);
  assert.equal(t.slice(o.offset, o.offset + o.length), '5 Sek./Stufe 5');
});

test('Temperatur, Linkslauf, Sanftrührstufe, Varoma, Dezimal', () => {
  let [o] = findOperations('Öl zugeben und 3 Min./120°C/Stufe 1 dünsten.');
  assert.deepEqual([o.time, o.temp, o.speed], [180, 120, '1']);
  [o] = findOperations('20 Min./100 °C/Linkslauf/Sanftrührstufe garen');
  assert.deepEqual([o.time, o.temp, o.reverse, o.speed], [1200, 100, true, 'soft']);
  [o] = findOperations('25 Min./Varoma/Stufe 1 dampfgaren');
  assert.deepEqual([o.time, o.temp, o.speed], [1500, 'Varoma', '1']);
  [o] = findOperations('10 Sek./Stufe 4,5 vermischen');
  assert.equal(o.speed, '4.5');
  [o] = findOperations('1 Min. 30 Sek./Stufe 3 rühren');
  assert.equal(o.time, 90);
  [o] = findOperations('2 Min./Teigstufe kneten');
  assert.deepEqual([o.mode, o.time], ['dough', 120]);
  const two = findOperations('Erst 5 Sek./Stufe 5 zerkleinern, dann 3 Min./120°C/Stufe 1 dünsten.');
  assert.equal(two.length, 2);
  assert.equal(findOperations('Backofen auf 180°C vorheizen.').length, 0);
});

test('Ganzes Rezept', () => {
  const r = parseRecipeText(`Cremige Tomatensuppe

4 Portionen
Arbeitszeit 15 Min.
Gesamtzeit 35 Min.

Zutaten
1 Zwiebel, halbiert
20 g Olivenöl
800 g
Tomaten aus der Dose
1 TL Salz

Zubereitung
1. Zwiebel in den Mixtopf geben, 5 Sek./Stufe 5 zerkleinern und mit dem Spatel nach unten schieben.
2. Öl zugeben und 3 Min./120°C/Stufe 1 dünsten.
3. Tomaten und Salz zugeben und 20 Min./100°C/Stufe 1 garen.
Danach abschmecken.
4. 1 Min./Stufe 5-10 schrittweise ansteigend pürieren.

Tipp
Mit Basilikum servieren.`);
  assert.equal(r.title, 'Cremige Tomatensuppe');
  assert.equal(r.servings, 4); assert.equal(r.prepTime, 15); assert.equal(r.totalTime, 35);
  assert.deepEqual(r.ingredients, ['1 Zwiebel, halbiert', '20 g Olivenöl', '800 g Tomaten aus der Dose', '1 TL Salz']);
  assert.equal(r.steps.length, 4);
  assert.match(r.steps[2], /garen\. Danach abschmecken\.$/);
});

test('Stück-Zutat ist keine Portionsangabe', () => {
  const r = parseRecipeText('Brot\nZutaten\n4 Stück Eier\n500 g Mehl\nZubereitung\n1. Alles 2 Min./Teigstufe kneten.\n2. Backen.');
  assert.equal(r.servings, null);
  assert.deepEqual(r.ingredients, ['4 Stück Eier', '500 g Mehl']);
});
