import { parseRecipeText, findOperations, formatSeconds } from './parser.js';
import { pdfToText } from './pdftext.js';

// ---------------------------------------------------------------------------
// Grundlagen
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorieren */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// PC-Version (eine einzelne HTML-Datei ohne Server): gespeichert wird über das
// Lesezeichen direkt auf cookidoo.de.
const STANDALONE = Boolean(window.PETRAS_STANDALONE);
const MARK = 'PETRAS-REZEPT:';
const COOKIDOO_URL = 'https://cookidoo.de/created-recipes/de-DE';

let settings = store.get('rb.settings', { pin: '', server: '' });
let state = { ingredients: [], steps: [], source: '' };

function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hide');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hide'), ms);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fallback */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* egal */ }
  ta.remove(); return ok;
}

// ---------------------------------------------------------------------------
// Server-API (nur Server-Version)
// ---------------------------------------------------------------------------
async function api(path, opts = {}) {
  const base = (settings.server || '').replace(/\/+$/, '');
  const res = await fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-App-Pin': settings.pin || '', ...(opts.headers || {}) },
  });
  let data = null;
  try { data = await res.json(); } catch { /* kein JSON */ }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Fehler ${res.status}`), { data, status: res.status });
  return data;
}

async function refreshStatus() {
  const dot = $('statusDot');
  if (STANDALONE) {
    dot.className = `dot ${store.get('rb.setupDone', false) ? 'ok' : 'warn'}`;
    return;
  }
  try {
    const s = await api('/api/status');
    dot.className = `dot ${s.configured ? 'ok' : 'warn'}`;
    $('sInfo').textContent = `Cookidoo: ${s.market}${s.pinRequired ? ' · PIN erforderlich' : ''}`;
  } catch {
    dot.className = 'dot err';
    $('sInfo').textContent = 'Server nicht erreichbar. Erkennen und „Text kopieren“ funktionieren trotzdem.';
  }
}

// ---------------------------------------------------------------------------
// Ansicht / Fortschritt
// ---------------------------------------------------------------------------
function setStep(n) {
  document.querySelectorAll('#stepper li').forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', s < n);
  });
}

function showImport() {
  $('viewReview').classList.add('hide');
  $('actionbar').classList.add('hide');
  $('viewImport').classList.remove('hide');
  setStep(1);
  window.scrollTo({ top: 0 });
}

function showReview() {
  $('viewImport').classList.add('hide');
  $('viewReview').classList.remove('hide');
  $('actionbar').classList.remove('hide');
  setStep(2);
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------
// Rezept laden
// ---------------------------------------------------------------------------
function loadRecipe(r, source) {
  $('fTitle').value = r.title || '';
  $('fServings').value = r.servings || '';
  $('fPrep').value = r.prepTime || '';
  $('fTotal').value = r.totalTime || '';
  state = { ingredients: [...(r.ingredients || [])], steps: [...(r.steps || [])], source: source || '' };
  if (!state.ingredients.length) state.ingredients.push('');
  if (!state.steps.length) state.steps.push('');
  $('sourceInfo').textContent = source ? `Gelesen aus: ${source}` : '';
  renderIngredients(); renderSteps(); updateSummary(); saveDraft();
  showReview();
  if (!r.ingredients?.length || !r.steps?.length) toast('Nicht alles wurde sicher erkannt – bitte kurz prüfen', 4000);
}

function importText(raw, source) {
  const t = String(raw || '').trim();
  if (!t) return toast('Kein Text gefunden');
  if (t.startsWith(MARK)) {
    try { return loadRecipe(JSON.parse(t.slice(MARK.length)), 'Lesezeichen'); } catch { /* normal weiter */ }
  }
  loadRecipe(parseRecipeText(t), source);
}

async function importFile(file) {
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf && !/^text\//.test(file.type) && !/\.txt$/i.test(file.name)) {
    return toast('Bitte eine PDF- oder Textdatei verwenden');
  }
  $('dropBusy').classList.remove('hide');
  try {
    const text = isPdf ? await pdfToText(await file.arrayBuffer()) : await file.text();
    if (text.replace(/\s/g, '').length < 20) {
      toast('Die PDF enthält keinen lesbaren Text (z. B. ein Foto/Scan). Bitte den Text kopieren und einfügen.', 6000);
      return;
    }
    $('rawInput').value = text;
    importText(text, file.name);
  } catch (e) {
    console.error(e);
    toast(`PDF konnte nicht gelesen werden: ${e.message}`, 5000);
  } finally {
    $('dropBusy').classList.add('hide');
    $('fileInput').value = '';
  }
}

// ---------------------------------------------------------------------------
// Zutaten
// ---------------------------------------------------------------------------
function renderIngredients(focusIndex) {
  const ul = $('ingList');
  ul.innerHTML = '';
  state.ingredients.forEach((text, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<input type="text" placeholder="z. B. 200 g Mehl"><button class="x" title="Entfernen" aria-label="Zutat entfernen">✕</button>';
    const inp = li.querySelector('input');
    inp.value = text;
    inp.addEventListener('input', () => { state.ingredients[i] = inp.value; updateSummary(); saveDraft(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const pos = inp.selectionStart ?? inp.value.length;
        state.ingredients.splice(i, 1, inp.value.slice(0, pos).trim(), inp.value.slice(pos).trim());
        renderIngredients(i + 1);
      } else if (e.key === 'Backspace' && !inp.value && state.ingredients.length > 1) {
        e.preventDefault();
        state.ingredients.splice(i, 1);
        renderIngredients(Math.max(0, i - 1));
      }
    });
    li.querySelector('.x').addEventListener('click', () => {
      state.ingredients.splice(i, 1);
      if (!state.ingredients.length) state.ingredients.push('');
      renderIngredients();
    });
    ul.appendChild(li);
  });
  if (focusIndex != null) ul.children[focusIndex]?.querySelector('input')?.focus();
  updateSummary(); saveDraft();
}

// ---------------------------------------------------------------------------
// Schritte
// ---------------------------------------------------------------------------
function tmPill(op) {
  const parts = [];
  if (op.mode === 'dough') parts.push('🌾 Teig');
  if (op.mode === 'turbo') parts.push('⚡ Turbo');
  if (op.time != null) parts.push(`⏱ ${formatSeconds(op.time)}`);
  if (op.temp != null) parts.push(`🌡 ${op.temp === 'Varoma' ? 'Varoma' : `${op.temp}°`}`);
  if (op.reverse) parts.push('↺ Linkslauf');
  if (op.speed != null) parts.push(`⚙ ${op.speed === 'soft' ? 'Sanft' : `Stufe ${String(op.speed).replace('.', ',')}`}`);
  if (op.pulses) parts.push(`${op.pulses}×`);
  const warn = op.warnings.length > 0;
  return `<span class="tm-pill ${warn ? 'warn' : ''}" title="${esc(op.warnings.join(' · '))}">${parts.map(esc).join('<span class="sep">·</span>')}${warn ? ' ⚠' : ''}</span>`;
}

function renderStepFoot(li, text) {
  const ops = findOperations(text.replace(/\s+/g, ' ').trim());
  const notes = [...new Set(ops.flatMap((o) => o.warnings))];
  li.querySelector('.tms').innerHTML = ops.map(tmPill).join('') +
    (notes.length ? `<span class="tm-note">${esc(notes.join(' · '))}</span>` : '');
}

function autosize(ta) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; }

function renderSteps(focusIndex) {
  const ol = $('stepList');
  ol.innerHTML = '';
  state.steps.forEach((text, i) => {
    const li = document.createElement('li');
    li.className = 'step';
    li.innerHTML = `<textarea rows="1" placeholder="Arbeitsschritt beschreiben …"></textarea>
      <div class="step-foot"><div class="tms"></div>
        <div class="step-tools">
          <button data-a="up" title="Nach oben">↑</button>
          <button data-a="down" title="Nach unten">↓</button>
          <button data-a="split" title="An der Cursor-Position teilen">✂</button>
          <button data-a="del" title="Schritt löschen">🗑</button>
        </div></div>`;
    const ta = li.querySelector('textarea');
    ta.value = text;
    ta.addEventListener('input', () => {
      state.steps[i] = ta.value; autosize(ta); renderStepFoot(li, ta.value); updateSummary(); saveDraft();
    });
    li.querySelector('.step-tools').addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a; if (!a) return;
      const s = state.steps;
      if (a === 'up' && i > 0) { [s[i - 1], s[i]] = [s[i], s[i - 1]]; return renderSteps(i - 1); }
      if (a === 'down' && i < s.length - 1) { [s[i + 1], s[i]] = [s[i], s[i + 1]]; return renderSteps(i + 1); }
      if (a === 'del') { s.splice(i, 1); if (!s.length) s.push(''); toast('Schritt gelöscht'); return renderSteps(); }
      if (a === 'split') {
        const pos = ta.selectionStart || 0;
        if (pos <= 0 || pos >= ta.value.length) return toast('Erst in den Text klicken, wo geteilt werden soll');
        s.splice(i, 1, ta.value.slice(0, pos).trim(), ta.value.slice(pos).trim());
        return renderSteps(i + 1);
      }
    });
    renderStepFoot(li, text);
    ol.appendChild(li);
    requestAnimationFrame(() => autosize(ta));
  });
  if (focusIndex != null) ol.children[focusIndex]?.querySelector('textarea')?.focus();
  updateSummary(); saveDraft();
}

// ---------------------------------------------------------------------------
// Zusammenfassung / Speichern
// ---------------------------------------------------------------------------
function currentRecipe() {
  return {
    title: $('fTitle').value.trim(),
    servings: parseInt($('fServings').value, 10) || null,
    prepTime: parseInt($('fPrep').value, 10) || null,
    totalTime: parseInt($('fTotal').value, 10) || null,
    ingredients: state.ingredients.map((s) => s.trim()).filter(Boolean),
    steps: state.steps.map((s) => s.trim()).filter(Boolean),
  };
}

function updateSummary() {
  const r = currentRecipe();
  const ops = r.steps.flatMap((s) => findOperations(s.replace(/\s+/g, ' ')));
  const warn = ops.filter((o) => o.warnings.length).length;
  $('ingCount').textContent = r.ingredients.length;
  $('stepCount').textContent = r.steps.length;
  $('summary').innerHTML = `<b>${r.ingredients.length}</b> Zutaten · <b>${r.steps.length}</b> Schritte · <b>${ops.length}</b> Thermomix-Einstellungen
    ${warn ? `<br><span class="warn">⚠ ${warn} mit Hinweis – kurz prüfen</span>` : ''}`;
  $('btnUpload').disabled = !r.title || !r.steps.length;
  $('btnUpload').title = !r.title ? 'Bitte einen Namen eingeben' : '';
}

function saveDraft() { store.set('rb.draft', currentRecipe()); }

function asText(r) {
  return [r.title, '',
    r.servings ? `${r.servings} Portionen` : '', r.prepTime ? `Arbeitszeit: ${r.prepTime} Min.` : '', r.totalTime ? `Gesamtzeit: ${r.totalTime} Min.` : '',
    '', 'Zutaten', ...r.ingredients, '', 'Zubereitung', ...r.steps.map((s, i) => `${i + 1}. ${s}`)]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

function addHistory(title, url) {
  const h = store.get('rb.history', []);
  h.unshift({ title, url, at: Date.now() });
  store.set('rb.history', h.slice(0, 50));
  store.set('rb.draft', null); // gespeichert → kein Entwurf mehr
  renderHistory();
}

function renderHistory() {
  const h = store.get('rb.history', []);
  $('recent').classList.toggle('hide', !h.length);
  const fmt = (t) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  $('historyList').innerHTML = h.slice(0, 8).map((e) =>
    `<li><span>${esc(e.title)}</span><span><small>${fmt(e.at)}</small> &nbsp;<a href="${esc(e.url)}" target="_blank" rel="noopener">Öffnen ↗</a></span></li>`).join('');
}

function showResult(html) {
  $('resultBody').innerHTML = html;
  $('dlgResult').showModal();
}

async function saveStandalone(r) {
  const ok = await copyText(MARK + JSON.stringify(r));
  if (!ok) return showResult('<div class="result-icon err">!</div><h2>Kopieren hat nicht geklappt</h2><p>Bitte „Text kopieren“ versuchen.</p>');
  if (!store.get('rb.setupDone', false)) {
    toast('Bitte zuerst einrichten (Lesezeichen anlegen)', 4000);
    $('dlgSetupPc').showModal();
    return;
  }
  window.open(COOKIDOO_URL, '_blank');
  setStep(3);
  addHistory(r.title, COOKIDOO_URL);
  showResult(`<div class="result-icon ok">✓</div><h2>Fast geschafft!</h2>
    <p>„${esc(r.title)}“ ist kopiert und Cookidoo öffnet sich in einem neuen Tab. Dort:</p>
    <ol class="result-steps">
      <li>In der Lesezeichenleiste auf <b>„➜ Petras Rezepte“</b> klicken.</li>
      <li><b>„In Cookidoo speichern“</b> klicken.</li>
    </ol>
    <p class="hint">Danach ist das Rezept auf dem TM6 unter <i>Meine Rezepte → Meine Kreationen</i>.</p>`);
}

async function saveServer(r) {
  const btn = $('btnUpload');
  btn.disabled = true; btn.innerHTML = '<i class="spinner"></i> Wird gespeichert …';
  try {
    const res = await api('/api/recipes', { method: 'POST', body: JSON.stringify(r) });
    const note = ['', 'Varoma, Sanftrührstufe, Teig oder Turbo wurden vereinfacht übertragen – diese Schritte am TM6 kurz prüfen.',
      'Cookidoo hat die Einstellungs-Knöpfe nicht angenommen – die Schritte wurden als Text gespeichert.'][res.level];
    setStep(3);
    addHistory(r.title, res.url);
    showResult(`<div class="result-icon ok">✓</div><h2>In Cookidoo gespeichert!</h2>
      <p><b>${esc(r.title)}</b> – ${res.stats.buttons} Thermomix-Knöpfe in ${res.stats.steps} Schritten.</p>
      <p>Auf dem TM6 unter <i>Meine Rezepte → Meine Kreationen</i>.</p>
      ${note ? `<div class="result-note">${esc(note)}</div>` : ''}
      <p><a href="${esc(res.url)}" target="_blank" rel="noopener">In Cookidoo ansehen ↗</a></p>`);
  } catch (e) {
    const hint = e.status === 401 ? 'Die PIN stimmt nicht – bitte unter „Einrichten“ prüfen.'
      : e.status ? '' : 'Der Server ist nicht erreichbar.';
    showResult(`<div class="result-icon err">!</div><h2>Das hat nicht geklappt</h2>
      <p><b>${esc(e.message)}</b><br>${esc(hint)}</p>
      ${e.data?.details ? `<details><summary>Technische Details</summary><pre>${esc(JSON.stringify(e.data.details, null, 2))}</pre></details>` : ''}`);
  } finally {
    btn.textContent = 'In Cookidoo speichern'; updateSummary();
  }
}

// ---------------------------------------------------------------------------
// Ereignisse
// ---------------------------------------------------------------------------
$('fileInput').addEventListener('change', (e) => importFile(e.target.files[0]));
$('drop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });

// Ziehen & Ablegen überall auf der Seite
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('dragOverlay').classList.remove('hide'); $('drop').classList.add('over'); });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('dragOverlay').classList.add('hide'); $('drop').classList.remove('over'); } });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0;
  $('dragOverlay').classList.add('hide'); $('drop').classList.remove('over');
  importFile(e.dataTransfer.files[0]);
});

// Einfügen mit Strg+V irgendwo auf Schritt 1 → sofort erkennen
document.addEventListener('paste', (e) => {
  if ($('viewImport').classList.contains('hide')) return;
  if (e.target === $('rawInput')) {
    setTimeout(() => { if ($('rawInput').value.trim().length > 40) importText($('rawInput').value, 'eingefügter Text'); }, 0);
    return;
  }
  const file = [...(e.clipboardData?.files || [])][0];
  if (file) { e.preventDefault(); return importFile(file); }
  const text = e.clipboardData?.getData('text/plain');
  if (text && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); $('rawInput').value = text; importText(text, 'eingefügter Text'); }
});

$('btnPaste').addEventListener('click', async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (!t) return toast('Die Zwischenablage ist leer');
    $('rawInput').value = t; importText(t, 'Zwischenablage');
  } catch { toast('Bitte ins Textfeld klicken und Strg + V drücken'); $('rawInput').focus(); }
});
$('btnParse').addEventListener('click', () => {
  if (!$('rawInput').value.trim()) { toast('Bitte zuerst Text einfügen oder eine PDF hineinziehen'); return $('rawInput').focus(); }
  importText($('rawInput').value, 'eingefügter Text');
});

['fTitle', 'fServings', 'fPrep', 'fTotal'].forEach((id) => $(id).addEventListener('input', () => { updateSummary(); saveDraft(); }));
$('btnAddIng').addEventListener('click', () => { state.ingredients.push(''); renderIngredients(state.ingredients.length - 1); });
$('btnAddStep').addEventListener('click', () => { state.steps.push(''); renderSteps(state.steps.length - 1); });
$('btnBack').addEventListener('click', showImport);

$('btnCopy').addEventListener('click', async () => {
  toast(await copyText(asText(currentRecipe())) ? 'Rezept als Text kopiert' : 'Kopieren nicht möglich');
});
$('btnUpload').addEventListener('click', () => {
  const r = currentRecipe();
  return STANDALONE ? saveStandalone(r) : saveServer(r);
});

$('dlgResult').addEventListener('close', () => {
  if ($('dlgResult').returnValue === 'new') {
    $('rawInput').value = ''; store.set('rb.draft', null); showImport();
  }
});

// Einrichten
document.querySelectorAll('[data-open-setup]').forEach((b) => b.addEventListener('click', () => $('btnSetup').click()));
$('btnSetup').addEventListener('click', () => {
  if (STANDALONE) return $('dlgSetupPc').showModal();
  $('sPin').value = settings.pin || ''; $('sServer').value = settings.server || '';
  $('dlgSetupServer').showModal();
});
$('dlgSetupPc').addEventListener('close', () => {
  if ($('dlgSetupPc').returnValue !== 'done') return;
  store.set('rb.setupDone', true);
  $('setupBanner').classList.add('hide');
  refreshStatus();
  toast('Eingerichtet – los geht’s!');
});
$('bmLink').addEventListener('click', (e) => {
  e.preventDefault();
  toast('Nicht anklicken – mit der Maus in die Lesezeichenleiste ziehen', 4000);
});
$('dlgSetupServer').addEventListener('close', () => {
  if ($('dlgSetupServer').returnValue !== 'ok') return;
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

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
renderHistory();
refreshStatus();
setStep(1);
if (STANDALONE) {
  if (!store.get('rb.setupDone', false)) $('setupBanner').classList.remove('hide');
} else {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

const shared = new URLSearchParams(location.search);
const sharedText = [shared.get('title'), shared.get('text')].filter(Boolean).join('\n');
const draft = store.get('rb.draft', null);
if (sharedText) {
  // Über Android „Teilen“ → Petras Rezepte App geschickt
  history.replaceState(null, '', location.pathname);
  $('rawInput').value = sharedText;
  importText(sharedText, 'geteilter Text');
} else if (draft && (draft.title || draft.steps?.length)) {
  loadRecipe(draft, 'letzter Entwurf');
}
