/** Nachgebaute Cookidoo-Seiten (Aufbau wie die echte Seite, Verhalten vereinfacht) – nur für Tests. */
const LIST = (titles) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Meine Kreationen</title></head><body>
<button id="create-button">Rezept erstellen</button>
<core-tiles-list>${titles.map((t, i) => `<core-tile id="cr-${i}"><img alt="${t}"></core-tile>`).join('')}</core-tiles-list>
<cr-add-recipe><core-modal hidden="" id="create-modal"><form action="/created-recipes/de-DE" method="post">
<input id="recipe-title" name="recipeName" type="text" maxlength="120"><button type="submit" class="button--primary">Erstellen</button></form></core-modal></cr-add-recipe>
<script>
document.getElementById('create-button').onclick = () => document.getElementById('create-modal').removeAttribute('hidden');
document.querySelector('form').onsubmit = (e) => { e.preventDefault(); window.__created = document.getElementById('recipe-title').value; location.href = '/created-recipes/de-DE/01TESTREZEPT/edit'; };
</script></body></html>`;

const EDIT = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>TEST – Cookidoo</title></head><body><h1>Editor</h1></body></html>`;

const STEPS_PAGE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Zutaten & Rezeptschritte</title>
<style>[hidden]{display:none}</style></head><body>
<cr-edit-tabs><button id="ingredients-button">Zutaten</button><button id="preparation-steps-button">Rezeptschritte</button></cr-edit-tabs>
<cr-manage-ingredients><cr-manage-list name="ingredients" modal-id="ingredients-modal" trigger-id="add-ingredients"><ul class="cr-manage-list__content"></ul></cr-manage-list></cr-manage-ingredients>
<cr-manage-steps><cr-manage-list name="steps" modal-id="steps-modal" trigger-id="add-steps"><ol class="cr-manage-list__content"></ol></cr-manage-list></cr-manage-steps>
<cr-floating-button><button id="add-ingredients">+ Zutat</button><button id="add-steps">+ Schritt</button></cr-floating-button>
<cr-edit-modal hidden="true" id="ingredients-modal"><button class="cr-edit-modal__save">✓</button><cr-text-field one-line="" contenteditable="" max-length="500"></cr-text-field></cr-edit-modal>
<cr-edit-modal hidden="true" id="steps-modal"><button class="cr-edit-modal__save">✓</button><cr-step-text-field><cr-text-field contenteditable="" allow-html="" max-length="5000"></cr-text-field></cr-step-text-field></cr-edit-modal>
<script>
// Simuliert: „+“ öffnet das Feld, ✓ speichert (asynchron) und hängt den Eintrag an die Liste
for (const kind of ['ingredients', 'steps']) {
  const modal = document.getElementById(kind + '-modal');
  const field = modal.querySelector('cr-text-field');
  document.getElementById('add-' + kind).onclick = () => { field.innerHTML = ''; modal.removeAttribute('hidden'); };
  modal.querySelector('.cr-edit-modal__save').onclick = () => setTimeout(() => {
    const li = document.createElement('li'); li.className = 'cr-manage-list__item';
    const f = document.createElement('cr-text-field'); f.innerHTML = field.innerHTML; li.appendChild(f);
    document.querySelector('cr-manage-list[name="' + kind + '"] .cr-manage-list__content').appendChild(li);
    modal.setAttribute('hidden', 'true');
    (window.__saved ||= []).push({ kind, html: field.innerHTML });
  }, 150);
}
</script></body></html>`;

module.exports = { LIST, EDIT, STEPS_PAGE };
