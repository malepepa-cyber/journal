import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInstructions, buildMeta, validateRecipe } from '../lib/cookidoo-format.js';

const steps = [
  'Zwiebel  in den Mixtopf geben, 5 Sek./Stufe 5 zerkleinern.',
  'Tomaten zugeben und 25 Min./Varoma/Linkslauf/Sanftrührstufe garen.',
  'Teig 2 Min./Teigstufe kneten.',
  'Abschmecken.',
];

test('Level 0: alles inkl. experimentell', () => {
  const { steps: s, stats } = buildInstructions(steps, 0);
  assert.equal(s[0].text, 'Zwiebel in den Mixtopf geben, 5 Sek./Stufe 5 zerkleinern.');
  const a = s[0].annotations[0];
  assert.deepEqual(a, { type: 'TTS', data: { time: 5, speed: '5' }, position: { offset: 30, length: 14 } });
  assert.equal(s[0].text.substr(a.position.offset, a.position.length), '5 Sek./Stufe 5');
  assert.deepEqual(s[1].annotations[0].data, { time: 1500, speed: 'soft', temperature: { value: 'Varoma', unit: 'C' }, direction: 'CCW' });
  assert.equal(s[2].annotations[0].type, 'MODE');
  assert.equal(s[3].annotations, undefined);
  assert.deepEqual(stats, { steps: 4, buttons: 3, skipped: 0 });
});

test('Level 1: nur sichere Knöpfe', () => {
  const { steps: s, stats } = buildInstructions(steps, 1);
  assert.equal(s[1].annotations, undefined); // Sanftrührstufe → kein Knopf
  assert.equal(s[2].annotations, undefined);
  assert.equal(stats.buttons, 1);
  const v = buildInstructions(['25 Min./Varoma/Stufe 1 garen'], 1).steps[0].annotations[0];
  assert.deepEqual(v.data.temperature, { value: '120', unit: 'C' });
});

test('Level 2: nur Text', () => {
  assert.equal(buildInstructions(steps, 2).stats.buttons, 0);
});

test('Meta & Validierung', () => {
  const m = buildMeta({ title: ' Suppe ', servings: 4, prepTime: 15, totalTime: 40, ingredients: ['1 Zwiebel', ' ', '20 g Öl'] });
  assert.deepEqual(m, {
    name: 'Suppe', ingredients: [{ type: 'INGREDIENT', text: '1 Zwiebel' }, { type: 'INGREDIENT', text: '20 g Öl' }],
    yield: { value: 4, unitText: 'portion' }, prepTime: 900, totalTime: 2400,
  });
  assert.equal(validateRecipe({ title: '', ingredients: [], steps: [] }).length, 2);
});
