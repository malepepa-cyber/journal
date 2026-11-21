import { parseRecipeText, findOperations, describeOperation } from './parser.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorieren */ } },
};

// PC-Version (eine einzelne HTML-Datei, kein Server): speichert über den
// Lesezeichen-Helfer direkt auf cookidoo.de.
const STANDALONE = Boolean(window.PETRAS_STANDALONE);
const MARK = 'PETRAS-REZEPT:';
let settings = store.get('rb.settings', { pin: '', server: '' });
let steps = [];

function apiUrl(path) {
  const base = (settings.server || '').replace(/\/+$/, '');
  return base + path;
}
async function api(path, opts = {}) {
  const res = await fetch(apiUrl(path), {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-App-Pin': settings.pin || '', ...(opts.headers || {}) },
  });
  let data = null;
  try { data = await res.json(); } catch { /* kein JSON */ }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Fehler ${res.status}`), { data, status: res.status });
  return data;
}

function toast(msg, ms = 2500) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hide');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hide'), ms);
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Status ----------
async function refreshStatus() {
  const chip = $('statusChip');
  try {
    const s = await api('/api/status');
    chip.textContent = s.configured ? '✓ bereit' : '⚠ Setup';
    chip.className = `chip ${s.configured ? 'ok' : 'err'}`;
    $('sInfo').textContent = `Cookidoo: ${s.market}${s.pinRequired ? ' · PIN erforderlich' : ''}`;
    return s;
  } catch {
    chip.textContent = 'Offline'; chip.className = 'chip err';
    $('sInfo').textContent = 'Server nicht erreichbar. Erkennen & Text kopieren funktionieren trotzdem.';
    return null;
  }
}

// ---------- Schritte ----------
function renderOps(li, text) {
  const box = li.querySelector('.ops');
  const ops = findOperations(text);
  box.innerHTML = ops.length
    ? ops.map((o) => `<span class="op ${o.warnings.length ? 'warn' : ''}" title="${esc(o.warnings.join(' · '))}">⚙ ${esc(describeOperation(o))}${o.warnings.length ? ' ⚠' : ''}</span>`).join('')
    : '<span class="op none">keine Thermomix-Einstellung</span>';
}

function renderSteps() {
  const ol = $('stepList');
  ol.innerHTML = '';
  steps.forEach((text, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<textarea rows="3"></textarea><div class="ops"></div>
      <div class="stepbar">
        <button data-a="up" aria-label="nach oben">▲</button>
        <button data-a="down" aria-label="nach unten">▼</button>
        <button data-a="split" aria-label="teilen" title="An Cursorposition teilen">✂</button>
        <button data-a="del" aria-label="löschen">🗑</button>
      </div>`;
    const ta = li.querySelector('textarea');
    ta.value = text;
    ta.addEventListener('input', () => { steps[i] = ta.value; renderOps(li, ta.value); saveDraft(); updateSummary(); });
    li.querySelector('.stepbar').addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a; if (!a) return;
      if (a === 'up' && i > 0) [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
      if (a === 'down' && i < steps.length - 1) [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]];
      if (a === 'del') { if (!confirm('Schritt löschen?')) return; steps.splice(i, 1); }
      if (a === 'split') {
        const pos = ta.selectionStart || 0;
        if (pos <= 0 || pos >= ta.value.length) return toast('Cursor in den Text setzen, wo geteilt werden soll');
        steps.splice(i, 1, ta.value.slice(0, pos).trim(), ta.value.slice(pos).trim());
      }
      renderSteps(); saveDraft(); updateSummary();
    });
    renderOps(li, text);
    ol.appendChild(li);
  });
}

// ---------- Formular ----------
function currentRecipe() {
  return {
    title: $('fTitle').value.trim(),
    servings: parseInt($('fServings').value, 10) || null,
    prepTime: parseInt($('fPrep').value, 10) || null,
    totalTime: parseInt($('fTotal').value, 10) || null,
    ingredients: $('fIngredients').value.split('\n').map((s) => s.trim()).filter(Boolean),
    steps: steps.map((s) => s.trim()).filter(Boolean),
  };
}

function fillForm(r) {
  $('fTitle').value = r.title || '';
  $('fServings').value = r.servings || '';
  $('fPrep').value = r.prepTime || '';
  $('fTotal').value = r.totalTime || '';
  $('fIngredients').value = (r.ingredients || []).join('\n');
  steps = [...(r.steps || [])];
  renderSteps();
  ['paneEdit', 'paneSave'].forEach((id) => $(id).classList.remove('hide'));
  updateSummary();
}

function updateSummary() {
  const r = currentRecipe();
  const ops = r.steps.flatMap((s) => findOperations(s));
  const warn = ops.filter((o) => o.warnings.length).length;
  $('summary').innerHTML = `<b>${esc(r.title || 'Ohne Titel')}</b><br>
    ${r.ingredients.length} Zutaten · ${r.steps.length} Schritte · ${ops.length} Thermomix-Einstellungen
    ${warn ? `<br><span style="color:var(--warn)">⚠ ${warn} Einstellung(en) mit Hinweis – bitte prüfen</span>` : ''}`;
  $('btnUpload').disabled = !r.title || !r.steps.length;
}

function saveDraft() { store.set('rb.draft', { raw: $('rawInput').value, recipe: currentRecipe() }); }

function asText(r) {
  return [r.title, '',
    r.servings ? `${r.servings} Portionen` : '', r.prepTime ? `Arbeitszeit: ${r.prepTime} Min.` : '', r.totalTime ? `Gesamtzeit: ${r.totalTime} Min.` : '',
    '', 'Zutaten', ...r.ingredients, '', 'Zubereitung', ...r.steps.map((s, i) => `${i + 1}. ${s}`)]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

// ---------- Verlauf ----------
function renderHistory() {
  const h = store.get('rb.history', []);
  $('paneHistory').classList.toggle('hide', !h.length);
  $('historyList').innerHTML = h.slice(0, 15).map((e) =>
    `<li><span>${esc(e.title)}</span><a href="${esc(e.url)}" target="_blank" rel="noopener">öffnen</a></li>`).join('');
}

// ---------- Ereignisse ----------
$('btnPaste').addEventListener('click', async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (!t) return toast('Zwischenablage ist leer');
    $('rawInput').value = t; saveDraft();
  } catch { toast('Bitte lange ins Feld tippen und „Einfügen“ wählen'); }
});

$('btnParse').addEventListener('click', () => {
  const raw = $('rawInput').value;
  if (!raw.trim()) return toast('Bitte zuerst ein Rezept einfügen');
  const r = parseRecipeText(raw);
  fillForm(r);
  saveDraft();
  $('paneEdit').scrollIntoView({ behavior: 'smooth' });
  if (!r.ingredients.length || !r.steps.length) toast('Zutaten oder Schritte nicht sicher erkannt – bitte prüfen', 4000);
});

['fTitle', 'fServings', 'fPrep', 'fTotal', 'fIngredients'].forEach((id) =>
  $(id).addEventListener('input', () => { saveDraft(); updateSummary(); }));

$('btnAddStep').addEventListener('click', () => {
  steps.push(''); renderSteps();
  $('stepList').lastElementChild.querySelector('textarea').focus();
});

$('btnCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(asText(currentRecipe())); toast('Rezept als Text kopiert'); }
  catch { toast('Kopieren nicht möglich'); }
});

$('btnNew').addEventListener('click', () => {
  if (!confirm('Aktuelles Rezept verwerfen?')) return;
  $('rawInput').value = ''; steps = [];
  ['paneEdit', 'paneSave'].forEach((id) => $(id).classList.add('hide'));
  $('result').classList.add('hide');
  store.set('rb.draft', null);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fallback */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* egal */ }
  ta.remove(); return ok;
}

async function prepareForCookidoo() {
  const r = currentRecipe();
  const out = $('result');
  const ok = await copyText(MARK + JSON.stringify(r));
  window.open('https://cookidoo.de/created-recipes/de-DE', '_blank', 'noopener');
  out.innerHTML = ok
    ? `✅ <b>Rezept kopiert – Cookidoo wird geöffnet.</b>
       <ol><li>Auf cookidoo.de angemeldet sein.</li>
       <li>In der Lesezeichenleiste auf <b>„➜ Petras Rezepte speichern“</b> klicken.</li>
       <li>Ins Feld klicken, <b>Strg + V</b> drücken, dann <b>„In Cookidoo speichern“</b>.</li></ol>`
    : '❌ Kopieren hat nicht geklappt. Bitte „Als Text kopieren“ versuchen.';
  out.className = `result ${ok ? 'ok' : 'err'}`;
  const h = store.get('rb.history', []);
  h.unshift({ title: r.title, url: 'https://cookidoo.de/created-recipes/de-DE', at: Date.now() });
  store.set('rb.history', h.slice(0, 50)); renderHistory();
}

$('btnUpload').addEventListener('click', async () => {
  if (STANDALONE) return prepareForCookidoo();
  const r = currentRecipe();
  const btn = $('btnUpload'), out = $('result');
  btn.disabled = true; btn.textContent = '⏳ Wird gespeichert …';
  out.className = 'result hide';
  try {
    const res = await api('/api/recipes', { method: 'POST', body: JSON.stringify(r) });
    const lvl = ['', '<br>Hinweis: Varoma/Sanftrührstufe/Teig/Turbo wurden vereinfacht übertragen – bitte diese Schritte am TM6 prüfen.',
      '<br>Hinweis: Cookidoo hat die Einstellungs-Knöpfe nicht angenommen – Schritte wurden als Text gespeichert.'][res.level];
    out.innerHTML = `✅ <b>Gespeichert!</b> ${res.stats.buttons} Thermomix-Knöpfe in ${res.stats.steps} Schritten.${lvl}
      <br>Auf dem TM6: <i>Cookidoo → Meine Rezepte → Meine Kreationen</i>.
      <br><a href="${esc(res.url)}" target="_blank" rel="noopener">In Cookidoo öffnen</a>`;
    out.className = 'result ok';
    const h = store.get('rb.history', []);
    h.unshift({ title: r.title, url: res.url, at: Date.now() }); store.set('rb.history', h.slice(0, 50));
    renderHistory();
  } catch (e) {
    const hint = e.status === 401 ? 'PIN falsch – bitte in den Einstellungen (⚙️) prüfen.'
      : e.status ? '' : 'Server nicht erreichbar.';
    out.innerHTML = `❌ <b>${esc(e.message)}</b><br>${hint}
      ${e.data?.details ? `<details><summary>Technische Details</summary><pre>${esc(JSON.stringify(e.data.details, null, 2))}</pre></details>` : ''}`;
    out.className = 'result err';
  } finally {
    btn.textContent = '☁️ In Cookidoo speichern'; updateSummary();
  }
});

// Einstellungen
$('btnSettings').addEventListener('click', () => {
  $('sPin').value = settings.pin || ''; $('sServer').value = settings.server || '';
  $('dlgSettings').showModal();
});
$('dlgSettings').addEventListener('close', () => {
  if ($('dlgSettings').returnValue !== 'ok') return;
  settings = { pin: $('sPin').value.trim(), server: $('sServer').value.trim() };
  store.set('rb.settings', settings); refreshStatus();
});
$('btnCheck').addEventListener('click', async () => {
  const old = settings;
  settings = { pin: $('sPin').value.trim(), server: $('sServer').value.trim() };
  $('sInfo').textContent = 'Teste Anmeldung bei Cookidoo …';
  try {
    const r = await api('/api/check', { method: 'POST', body: '{}' });
    $('sInfo').textContent = `✅ Cookidoo-Anmeldung ok (${r.recipes} eigene Rezepte gefunden).`;
  } catch (e) {
    $('sInfo').textContent = `❌ ${e.message}`;
  } finally { settings = old; }
});

// Start
const shared = new URLSearchParams(location.search);
const sharedText = [shared.get('title'), shared.get('text')].filter(Boolean).join('\n');
const draft = store.get('rb.draft', null);
if (sharedText) {
  // Über Android „Teilen“ → Petras Rezepte App geschickt
  $('rawInput').value = sharedText;
  history.replaceState(null, '', location.pathname);
  $('btnParse').click();
} else if (draft) {
  $('rawInput').value = draft.raw || '';
  if (draft.recipe && (draft.recipe.title || draft.recipe.steps?.length)) fillForm(draft.recipe);
}
renderHistory();
if (STANDALONE) {
  $('statusChip').classList.add('hide');
  $('btnSettings').classList.add('hide');
  $('btnUpload').textContent = '☁️ Für Cookidoo kopieren & öffnen';
} else {
  refreshStatus();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
