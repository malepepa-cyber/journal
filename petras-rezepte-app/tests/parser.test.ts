import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRecipeText } from '../shared/parser.ts';
import { findSettings, formatSetting, insertSetting, parseDuration, replaceSetting, findRestMinutes } from '../shared/tm.ts';
import { parseIngredient, formatIngredient, checkIngredient } from '../shared/ingredients.ts';
import { suggestForStep } from '../shared/suggest.ts';
import { validateRecipe, fingerprint } from '../shared/validate.ts';

test('Dauer', () => {
  assert.equal(parseDuration('1 Min. 30 Sek.'), 90);
  assert.equal(parseDuration('10-15 Sek.'), 10);
  assert.equal(parseDuration('1,5 Min.'), 90);
  assert.equal(parseDuration('1 Std. 10 Min.'), 4200);
});

test('Thermomix-Einstellungen erkennen', () => {
  const t = 'Zwiebel in den Mixtopf geben, 5 Sek./Stufe 5 zerkleinern.';
  const [o] = findSettings(t);
  assert.deepEqual([o.time, o.speed, o.mode], [5, '5', 'manual']);
  assert.equal(t.slice(o.offset, o.offset + o.length), '5 Sek./Stufe 5');
  let [x] = findSettings('20 Min./100 °C/Linkslauf/Sanftrührstufe garen');
  assert.deepEqual([x.time, x.temp, x.reverse, x.speed], [1200, 100, true, 'soft']);
  [x] = findSettings('25 Min./Varoma/Stufe 1'); assert.equal(x.temp, 'Varoma');
  [x] = findSettings('10 Sek./Stufe 4,5'); assert.equal(x.speed, '4.5');
  [x] = findSettings('2 Min./Teigstufe'); assert.deepEqual([x.mode, x.time], ['dough', 120]);
  [x] = findSettings('Turbo/1 Sek./3 Mal'); assert.deepEqual([x.mode, x.time, x.pulses], ['turbo', 1, 3]);
  [x] = findSettings('Anbraten/5 Min./160°C'); assert.deepEqual([x.mode, x.time, x.temp], ['browning', 300, 160]);
  assert.equal(findSettings('Backofen auf 180°C vorheizen.').length, 0);
  assert.equal(findSettings('Erst 5 Sek./Stufe 5, dann 3 Min./120°C/Stufe 1.').length, 2);
});

test('Plausibilität TM6', () => {
  assert.ok(findSettings('3 Min./140°C/Stufe 1')[0].warnings.some((w) => /120/.test(w)));
  assert.ok(findSettings('3 Min./Stufe 12')[0].warnings.length > 0);
  assert.equal(findSettings('3 Min./120°C/Stufe 1')[0].warnings.length, 0);
});

test('Einstellung schreiben, ersetzen, einfügen', () => {
  assert.equal(formatSetting({ mode: 'manual', time: 180, temp: 120, reverse: true, speed: '1' }), '3 Min./120°C/Linkslauf/Stufe 1');
  assert.equal(formatSetting({ mode: 'manual', time: 90, speed: '4.5' }), '1 Min. 30 Sek./Stufe 4,5');
  assert.equal(formatSetting({ mode: 'dough', time: 120 }), '2 Min./Teigstufe');
  const t = 'Öl zugeben und 3 Min./120°C/Stufe 1 dünsten.';
  const [m] = findSettings(t);
  assert.equal(replaceSetting(t, m, { ...m, time: 300 }), 'Öl zugeben und 5 Min./120°C/Stufe 1 dünsten.');
  assert.equal(insertSetting('Milch erwärmen.', { mode: 'manual', time: 120, temp: 37, speed: '2' }), 'Milch erwärmen – 2 Min./37°C/Stufe 2.');
  // Rundlauf: geschriebene Einstellung wird wieder erkannt
  for (const s of [{ mode: 'manual', time: 1500, temp: 'Varoma', speed: '1' }, { mode: 'turbo', time: 1, pulses: 3 }, { mode: 'browning', time: 300, temp: 160 }] as const) {
    const [back] = findSettings(`x ${formatSetting(s)} y`);
    assert.equal(back.mode, s.mode); assert.equal(back.time, s.time);
  }
});

test('Zutaten zerlegen', () => {
  const z = (l: string) => { const i = parseIngredient(l); return [i.amount, i.amountMax, i.unit, i.name, i.note]; };
  assert.deepEqual(z('500 g Mehl'), [500, null, 'g', 'Mehl', '']);
  assert.deepEqual(z('1 Würfel Hefe (42 g)'), [1, null, 'Würfel', 'Hefe (42 g)', '']);
  assert.deepEqual(z('1-2 EL Olivenöl'), [1, 2, 'EL', 'Olivenöl', '']);
  assert.deepEqual(z('½ TL Salz'), [0.5, null, 'TL', 'Salz', '']);
  assert.deepEqual(z('2 Zwiebeln, halbiert'), [2, null, '', 'Zwiebeln', 'halbiert']);
  assert.deepEqual(z('250 Milliliter Milch'), [250, null, 'ml', 'Milch', '']);
  assert.deepEqual(z('2 Lauchstangen'), [2, null, '', 'Lauchstangen', '']);
  assert.deepEqual(z('Salz und Pfeffer'), [null, null, '', 'Salz und Pfeffer', '']);
  assert.deepEqual(z('1 1/2 TL Zucker'), [1.5, null, 'TL', 'Zucker', '']);
  assert.deepEqual(z('3/4 l Brühe'), [0.75, null, 'l', 'Brühe', '']);
  assert.equal(formatIngredient(parseIngredient('1-2 EL Olivenöl, kalt gepresst')), '1-2 EL Olivenöl, kalt gepresst');
  assert.deepEqual(checkIngredient(parseIngredient('Salz')), []);
  assert.deepEqual(checkIngredient(parseIngredient('Mehl')), ['Menge fehlt']);
});

test('Ruhe-/Gehzeit', () => {
  assert.equal(findRestMinutes('Teig abgedeckt 60 Minuten gehen lassen.'), 60);
  assert.equal(findRestMinutes('Im Kühlschrank 2 Std. ruhen lassen.'), 120);
  assert.equal(findRestMinutes('3 Min./120°C/Stufe 1 dünsten.'), null);
});

test('Vorschläge (Beispiel aus dem Auftrag)', () => {
  const s = suggestForStep('Milch, Hefe und Zucker erwärmen.');
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].setting, { mode: 'manual', time: 120, temp: 37, speed: '2' });
  assert.equal(s[0].source, 'regel');
  assert.deepEqual(suggestForStep('Alles zu einem Teig kneten.')[0].setting, { mode: 'dough', time: 120 });
  assert.equal(suggestForStep('Teig 60 Minuten gehen lassen.').length, 0);
  assert.equal(suggestForStep('Mehl, Butter, Ei und Salz dazugeben.').length, 0);
  assert.equal(suggestForStep('3 Min./120°C/Stufe 1 dünsten.').length, 0, 'keine Vorschläge, wenn Angabe vorhanden');
  assert.equal(suggestForStep('Im Backofen 30 Minuten backen.').length, 0);
  assert.equal(suggestForStep('Gemüse 20 Minuten köcheln lassen.')[0].setting.time, 1200);
});

const HEFE = `Hefezopf
1 Zopf
Zutaten
500 g Mehl
250 ml Milch
1 Würfel Hefe
80 g Zucker
80 g Butter
1 Ei
1 Prise Salz
Zubereitung
1. Milch, Hefe und Zucker erwärmen.
2. Mehl, Butter, Ei und Salz dazugeben.
3. Alles zu einem Teig kneten.
4. Teig 60 Minuten gehen lassen.`;

test('Beispielrezept aus dem Auftrag', () => {
  const r = parseRecipeText(HEFE);
  assert.equal(r.title, 'Hefezopf');
  assert.equal(r.category, 'Brot und Brötchen');
  assert.equal(r.ingredients.length, 7);
  assert.deepEqual(r.ingredients.map((i) => i.unit), ['g', 'ml', 'Würfel', 'g', 'g', '', 'Prise']);
  assert.equal(r.steps.length, 4);
  assert.equal(r.steps[0].suggestions[0].setting.temp, 37);
  assert.equal(r.steps[2].suggestions[0].setting.mode, 'dough');
  assert.equal(r.steps[3].restMinutes, 60);
  assert.equal(r.restTime, 60);
});

test('Gruppen, Meta-Zeile, PDF-Struktur, Kopfzeilen', () => {
  const r = parseRecipeText(`21.11.26, 19:35 Nimmersatt-Brot | Zaubertopf Club
Startseite › Rezepte › Brot

Nimmersatt-Brot
Ein saftiges Brot, das ganz ohne Kneten gelingt und lange frisch bleibt.

Arbeitszeit 10 Min. · Gesamtzeit 1 Std. 20 Min. · 1 Brot · Schwierigkeit: einfach

Zutaten

Für den Vorteig:

500 g Wasser

1 Würfel Hefe

Für den Hauptteig:

500 g Dinkelmehl
Type 630

100 g

Sonnenblumenkerne
https://www.zaubertopf-club.de/rezept/x.html 1/2
Zubereitung

1. Wasser und Hefe 3 Min./37°C/Stufe 2
erwärmen.
2. Mehl zugeben und 3 Min./Teigstufe kneten.
Seite 2 von 2
3. Abgedeckt 30 Min. gehen lassen.
Tipp
Schmeckt auch mit Kürbiskernen.`);
  assert.equal(r.title, 'Nimmersatt-Brot');
  assert.match(r.description, /saftiges Brot/);
  assert.equal(r.prepTime, 10); assert.equal(r.totalTime, 80); assert.equal(r.servings, 1); assert.equal(r.servingsUnit, 'Brot');
  assert.equal(r.difficulty, 'einfach');
  assert.deepEqual(r.ingredients.map((i) => [i.group, i.amount, i.unit, i.name]), [
    ['Für den Vorteig', 500, 'g', 'Wasser'], ['Für den Vorteig', 1, 'Würfel', 'Hefe'],
    ['Für den Hauptteig', 500, 'g', 'Dinkelmehl Type 630'], ['Für den Hauptteig', 100, 'g', 'Sonnenblumenkerne']]);
  assert.deepEqual(r.steps.map((s) => s.text), ['Wasser und Hefe 3 Min./37°C/Stufe 2 erwärmen.', 'Mehl zugeben und 3 Min./Teigstufe kneten.', 'Abgedeckt 30 Min. gehen lassen.']);
  assert.equal(r.steps[2].restMinutes, 30);
});

test('Zubehör erkennen', () => {
  const r = parseRecipeText('Test\nZutaten\n200 g Sahne\nZubereitung\n1. Rühraufsatz einsetzen, Sahne 3 Min./Stufe 3,5 steif schlagen.\n2. Gemüse in den Gareinsatz geben, 20 Min./Varoma/Stufe 1 garen.');
  assert.deepEqual(r.steps[0].accessories, ['butterfly']);
  assert.ok(r.steps[1].accessories.includes('basket') && r.steps[1].accessories.includes('varoma'));
});

test('Validierung & Fingerabdruck', () => {
  const r = parseRecipeText(HEFE);
  const issues = validateRecipe(r);
  assert.ok(issues.some((i) => /Vorschlag/.test(i.message)));
  assert.ok(!issues.some((i) => i.level === 'fehler'));
  assert.equal(fingerprint(r), fingerprint({ ...r, title: ' hefezopf ', ingredients: [...r.ingredients].reverse() }));
  assert.ok(validateRecipe({ ...r, title: '' }).some((i) => i.level === 'fehler'));
});

test('Thermomix-Zeiten bleiben bis 99 Min. in Minuten; „1 Zopf“ als Menge', () => {
  assert.equal(formatSetting({ mode: 'manual', time: 3600, temp: 100, speed: '1' }), '60 Min./100°C/Stufe 1');
  assert.equal(findSettings('x 60 Min./100°C/Stufe 1')[0].time, 3600);
  const r = parseRecipeText('Hefezopf\n1 Zopf\nZutaten\n500 g Mehl\nZubereitung\n1. Kneten.');
  assert.deepEqual([r.servings, r.servingsUnit], [1, 'Zopf']);
});

test('Druck-Kopfzeile ohne Doppelpunkt („1015“) wird ignoriert', () => {
  const r = parseRecipeText('Eintopf\nZutaten\n1 Zwiebel\nZubereitung\n1. Schneiden.\n22.11.26, 1015 Eintopf | Zaubertopf Club\n2. Kochen.');
  assert.deepEqual(r.steps.map((s) => s.text), ['Schneiden.', 'Kochen.']);
});

test('Kopfzeile mit Sonderzeichen-Doppelpunkt aus PDF-Schrift', () => {
  const r = parseRecipeText('Eintopf\nZutaten\n1 Zwiebel\nZubereitung\n1. Schneiden.\n22.11.26, 1015 Eintopf | Zaubertopf Club\n2. Kochen.');
  assert.equal(r.steps.length, 2);
});
