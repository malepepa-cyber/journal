import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stepHtml, ingredientLines } from '../shared/cookidoo-ui.ts';
import { makeStep } from '../shared/parser.ts';
import { parseIngredient } from '../shared/ingredients.ts';
import { emptyRecipe } from '../shared/model.ts';

test('Schritt → Cookidoo-Editor-HTML mit <cr-tts>', () => {
  const s = stepHtml(makeStep('Wasser zugeben und 10 Min. | 100 °C | Linkslauf | Sanftrührstufe garen.'));
  assert.equal(s.html, 'Wasser zugeben und <cr-tts speed="soft" temperature="100" temperature-unit="C" time="600" direction="CCW">10 Min. | 100 °C | Linkslauf | Sanftrührstufe</cr-tts> garen.');
  assert.equal(s.buttons, 1);
  const v = stepHtml(makeStep('Varoma aufsetzen und 25 Min./Varoma/Stufe 1 garen.'));
  assert.match(v.html, /<cr-tts speed="1" temperature="varoma" temperature-unit="C" time="1500">25 Min\.\/Varoma\/Stufe 1<\/cr-tts>/);
  const t = stepHtml(makeStep('Knoblauch 2 Sek. | Turbo zerkleinern, dann 10 Sek. | Stufe 4 vermengen <b>.'));
  assert.equal(t.buttons, 1);
  assert.deepEqual(t.manual, ['2 Sek. | Turbo'], 'Turbo → im Editor ergänzen');
  assert.ok(t.html.includes('&lt;b&gt;'), 'Text wird escaped');
  const ohne = stepHtml(makeStep('Nach Packungsangabe | Varoma® | Linkslauf | Sanftrührstufe garen.'));
  assert.equal(ohne.buttons, 0, 'ohne Zeit kein Knopf');
});

test('Zutatenzeilen mit Gruppen', () => {
  const r = emptyRecipe();
  r.ingredients = [parseIngredient('200 g Mehl', 'Für den Teig'), parseIngredient('1 Ei', 'Für den Teig'), parseIngredient('100 g Puderzucker', 'Für den Guss')];
  assert.deepEqual(ingredientLines(r), ['– Für den Teig –', '200 g Mehl', '1 Ei', '– Für den Guss –', '100 g Puderzucker']);
});
