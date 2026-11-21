// Lesezeichen-Helfer – EIN Lesezeichen für beides:
//  * auf einer Rezeptseite (z. B. Zaubertopf Club): liest das Rezept aus der Seite,
//    zeigt eine Vorschau, kopiert es und öffnet Cookidoo.
//  * auf cookidoo.de: Fenster zum Einfügen und Speichern mit der bestehenden Anmeldung.
import { parseRecipeText, findOperations, describeOperation } from '../public/parser.js';
import { saveRecipeInBrowser } from '../lib/cookidoo-browser.js';
import { extractRecipeFromDocument } from './extract.js';

const MARK = 'PETRAS-REZEPT:';
const COOKIDOO_URL = 'https://cookidoo.de/created-recipes/de-DE';
const isCookidoo = () => /(^|\.)cookidoo\.[a-z.]+$/.test(location.hostname);

function openHelper() {
  const grab = !isCookidoo();
  const old = document.getElementById('petras-rezepte-helper');
  if (old) { old.remove(); return; }

  const host = document.createElement('div');
  host.id = 'petras-rezepte-helper';
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
    .box{width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#1d2420;
      border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.35);font-size:15px;line-height:1.45}
    header{background:#2E6B3F;color:#fff;padding:12px 16px;display:flex;align-items:center;gap:8px;position:sticky;top:0}
    header b{flex:1;font-size:16px}
    header button{background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px}
    main{padding:14px 16px}
    textarea{width:100%;min-height:150px;border:1px solid #ccd5cc;border-radius:10px;padding:10px;font-size:14px;resize:vertical}
    .hint{color:#66706a;font-size:13px;margin:0 0 8px}
    .btn{border:0;border-radius:10px;padding:12px 16px;font-weight:600;font-size:15px;cursor:pointer;width:100%;margin-top:10px;background:#2E6B3F;color:#fff}
    .btn:disabled{opacity:.5;cursor:default}
    .preview{margin-top:10px;font-size:14px}
    .preview ol{padding-left:20px;margin:6px 0}
    .op{display:inline-block;font-size:12px;padding:2px 8px;border-radius:99px;background:#E3F3E6;color:#1E7B34;font-weight:600;margin:2px 4px 2px 0}
    .op.warn{background:#FFF1DF;color:#B25D0E}
    .msg{margin-top:12px;padding:10px 12px;border-radius:10px;font-size:14px}
    .ok{background:#E3F3E6}.err{background:#FCE8E6}
    a{color:#2E6B3F;font-weight:700}
    pre{white-space:pre-wrap;font-size:11px;max-height:160px;overflow:auto}
  </style>
  <div class="box">
    <header><b>🍲 Petras Rezepte → Cookidoo</b><button id="x" title="Schließen">✕</button></header>
    <main>
      <p class="hint" id="hint">Strg + V drücken, um das Rezept einzufügen – aus der Petras-Rezepte-Seite oder direkt aus dem Zaubertopf Club kopiert.</p>
      <textarea id="in" placeholder="Hier einfügen (Strg + V) …"></textarea>
      <div id="pv" class="preview"></div>
      <button id="save" class="btn" disabled>☁️ In Cookidoo speichern</button>
      <button id="go" class="btn" style="display:none">➜ Kopieren &amp; Cookidoo öffnen</button>
      <div id="msg"></div>
    </main>
  </div>`;
  document.body.appendChild(host);

  const $ = (id) => root.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let recipe = null;

  function read(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (t.startsWith(MARK)) {
      try { return JSON.parse(t.slice(MARK.length)); } catch { return null; }
    }
    const r = parseRecipeText(t);
    return { title: r.title, servings: r.servings, prepTime: r.prepTime, totalTime: r.totalTime, ingredients: r.ingredients, steps: r.steps };
  }

  function update() {
    recipe = read($('in').value);
    $('msg').innerHTML = '';
    if (!recipe) { $('pv').innerHTML = ''; $('save').disabled = true; return; }
    const ok = recipe.title && recipe.steps?.length;
    $('pv').innerHTML = `<b>${esc(recipe.title || '⚠ Kein Titel erkannt')}</b><br>
      ${recipe.ingredients?.length || 0} Zutaten · ${recipe.steps?.length || 0} Schritte
      <ol>${(recipe.steps || []).map((s) => {
        const ops = findOperations(s.replace(/\s+/g, ' ').trim());
        return `<li>${esc(s.length > 70 ? s.slice(0, 70) + '…' : s)}<br>${ops.map((o) =>
          `<span class="op ${o.warnings.length ? 'warn' : ''}">⚙ ${esc(describeOperation(o))}</span>`).join('')}</li>`;
      }).join('')}</ol>`;
    $('save').disabled = !ok;
  }

  $('in').addEventListener('input', update);
  $('x').addEventListener('click', () => host.remove());
  $('save').addEventListener('click', async () => {
    if (!recipe) return;
    const btn = $('save');
    btn.disabled = true; btn.textContent = '⏳ Wird gespeichert …';
    try {
      const res = await saveRecipeInBrowser(recipe);
      const note = ['', '<br>Hinweis: Varoma/Sanftrührstufe/Teig/Turbo wurden vereinfacht übertragen – bitte am TM6 prüfen.',
        '<br>Hinweis: Einstellungs-Knöpfe wurden nicht angenommen – Schritte als Text gespeichert.'][res.level];
      $('msg').innerHTML = `<div class="msg ok">✅ <b>„${esc(recipe.title)}“ gespeichert!</b><br>
        ${res.stats.buttons} Thermomix-Knöpfe in ${res.stats.steps} Schritten.${note}<br>
        Auf dem TM6: <i>Meine Rezepte → Meine Kreationen</i><br>
        <a href="${esc(res.url)}">Rezept ansehen</a></div>`;
      btn.textContent = '✓ Gespeichert';
    } catch (e) {
      $('msg').innerHTML = `<div class="msg err">❌ <b>${esc(e.message)}</b>
        ${e.body ? `<details><summary>Technische Details</summary><pre>${esc(JSON.stringify(e.body, null, 2))}</pre></details>` : ''}</div>`;
      btn.disabled = false; btn.textContent = '☁️ Nochmal versuchen';
    }
  });

  if (grab) {
    // Rezept aus der aktuellen Seite lesen
    const r = extractRecipeFromDocument(document, window);
    const clean = { title: r.title, servings: r.servings, prepTime: r.prepTime, totalTime: r.totalTime, ingredients: r.ingredients, steps: r.steps };
    $('hint').innerHTML = `Rezept aus dieser Seite gelesen (Quelle: ${esc(r.source)}). Im Feld kann noch korrigiert werden.
      <br>Tipp: Klappt es nicht richtig, das Rezept auf der Seite mit der Maus markieren und das Lesezeichen erneut klicken.`;
    $('in').value = toText(clean);
    $('save').style.display = 'none';
    $('go').style.display = '';
    update();
    $('go').addEventListener('click', async () => {
      if (!recipe) return;
      const ok = await copy(MARK + JSON.stringify(recipe));
      if (!ok) { $('msg').innerHTML = '<div class="msg err">❌ Kopieren nicht möglich.</div>'; return; }
      window.open(COOKIDOO_URL, '_blank');
      $('msg').innerHTML = `<div class="msg ok">✅ <b>Kopiert!</b> Cookidoo öffnet sich in einem neuen Tab.<br>
        Dort das Lesezeichen <b>noch einmal</b> anklicken → <b>„In Cookidoo speichern“</b>.</div>`;
    });
    return;
  }
  $('in').focus();
  // Wenn der Browser es erlaubt: Zwischenablage direkt übernehmen
  navigator.clipboard?.readText?.().then((t) => {
    if (t && !$('in').value) { $('in').value = t; update(); }
  }).catch(() => {});
}

function toText(r) {
  return [r.title, r.servings ? `${r.servings} Portionen` : '', r.prepTime ? `Arbeitszeit ${r.prepTime} Min.` : '',
    r.totalTime ? `Gesamtzeit ${r.totalTime} Min.` : '', 'Zutaten', ...(r.ingredients || []),
    'Zubereitung', ...(r.steps || []).map((s, i) => `${i + 1}. ${s}`)].filter(Boolean).join('\n');
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fallback */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* egal */ }
  ta.remove(); return ok;
}

// Aufruf erfolgt durch das Build-Skript (Lesezeichen bzw. Userscript).
export { openHelper };
