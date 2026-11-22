/**
 * Lesezeichen „➜ Petras Rezepte“.
 * - Auf einer Rezeptseite: Rezept auslesen und für die App in die Zwischenablage kopieren.
 * - Auf cookidoo.de: vorbereitetes Rezept aus der App speichern – NUR wenn in der App die
 *   experimentelle Schnellübertragung eingeschaltet wurde (Kennzeichen im kopierten Paket).
 */
import type { Recipe } from '../shared/model.ts';
import { findSettings } from '../shared/tm.ts';
import { extractFromDom } from '../shared/sites/generic.ts';
import { saveInCookidoo } from './cookidoo-browser.ts';
import { ingredientLines, stepHtml } from '../shared/cookidoo-ui.ts';

export const TRANSFER_MARK = 'PETRAS-REZEPTE-APP:';
export const IMPORT_MARK = 'PETRAS-REZEPTE-IMPORT:';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fallback */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* egal */ }
  ta.remove(); return ok;
}

function panel(title: string): { root: ShadowRoot; close: () => void } {
  document.getElementById('petras-rezepte-helfer')?.remove();
  const host = document.createElement('div');
  host.id = 'petras-rezepte-helfer';
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    *{box-sizing:border-box;font-family:"Segoe UI",system-ui,sans-serif}
    .box{width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#FFFDF8;color:#2B2A26;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);font-size:15px;line-height:1.5}
    header{background:#4E7A4C;color:#fff;padding:14px 18px;display:flex;align-items:center;gap:8px;position:sticky;top:0}
    header b{flex:1;font-size:16px}
    header button{background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:10px;width:32px;height:32px;cursor:pointer}
    main{padding:16px 18px}
    .btn{display:block;width:100%;border:0;border-radius:12px;padding:13px;margin-top:12px;font-weight:600;font-size:15px;cursor:pointer;background:#4E7A4C;color:#fff}
    .btn:disabled{opacity:.5}
    .muted{color:#6E6A60;font-size:13px}
    .ok{background:#E8F1E4;border-radius:12px;padding:12px;margin-top:12px}
    .err{background:#FBE9E4;border-radius:12px;padding:12px;margin-top:12px}
    .warn{background:#FFF3DC;border-radius:12px;padding:12px;margin-top:12px;font-size:13px}
    ol{padding-left:20px;margin:8px 0}
    .tm{display:inline-block;background:#4E7A4C;color:#fff;border-radius:8px;padding:1px 8px;font-size:12px;font-weight:600;margin:2px 4px 2px 0}
    a{color:#4E7A4C;font-weight:700}
  </style><div class="box"><header><b>🍲 ${esc(title)}</b><button title="Schließen">✕</button></header><main></main></div>`;
  document.body.appendChild(host);
  const close = () => host.remove();
  root.querySelector('header button')!.addEventListener('click', close);
  return { root, close };
}

/** Auf einer Rezeptseite: auslesen (inkl. Zaubertopf-Kochmodus) und für die App kopieren */
async function grab() {
  const { root } = panel('Rezept für Petras Rezepte App');
  const main = root.querySelector('main')!;
  const sel = String(window.getSelection?.() || '');
  const res = extractFromDom(document, location.href.split('?')[0], sel);
  const r = res.recipe;
  const tm = r.steps.reduce((n, s) => n + findSettings(s.text).length, 0);
  main.innerHTML = `<p><b>${esc(r.title || 'Ohne Titel')}</b><br><span class="muted">Gelesen aus: ${esc(res.method)} · ${r.ingredients.length} Zutaten · ${r.steps.length} Schritte · ${tm} Thermomix-Einstellungen</span></p>
    ${res.complete ? '' : `<div class="warn">⚠ ${esc(res.notes[0] ?? 'Rezept unvollständig.')}</div>`}
    ${res.subRecipes.length ? `<p class="muted" style="margin-top:12px"><b>Verlinkte Teilrezepte</b> – auf Wunsch als eigene Rezepte mitholen:</p>
      ${res.subRecipes.map((x, i) => `<label style="display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" data-i="${i}"> ${esc(x.title)}</label>`).join('')}` : ''}
    <button class="btn" id="go">📋 Für die App kopieren</button>
    <p class="muted">Tipp: Wird etwas falsch gelesen, das Rezept auf der Seite markieren und das Lesezeichen erneut klicken.</p>
    <div id="msg"></div>`;
  root.getElementById('go')!.addEventListener('click', async (ev) => {
    const btn = ev.target as HTMLButtonElement;
    btn.disabled = true; btn.textContent = '⏳ Wird vorbereitet …';
    const extra: { title: string; url: string; recipe?: Recipe; error?: string }[] = [];
    for (const box of Array.from(root.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked'))) {
      const link = res.subRecipes[Number(box.dataset.i)];
      try {
        // gleiche Website, mit Petras Anmeldung – so, als würde sie den Link selbst öffnen
        const html = await (await fetch(link.url, { credentials: 'include' })).text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const sub = extractFromDom(doc, link.url);
        extra.push({ ...link, recipe: sub.recipe });
      } catch { extra.push({ ...link, error: 'nicht lesbar' }); }
    }
    const payload = { v: 2, recipe: r, notes: res.notes, method: res.method, url: location.href.split('?')[0], subRecipes: extra };
    const ok = await copy(IMPORT_MARK + JSON.stringify(payload));
    btn.disabled = false; btn.textContent = '📋 Für die App kopieren';
    root.getElementById('msg')!.innerHTML = ok
      ? `<div class="ok">✅ <b>Kopiert!</b>${extra.length ? ` (+ ${extra.filter((x) => x.recipe).length} Teilrezept(e))` : ''}<br>Jetzt zur <b>Petras Rezepte App</b> wechseln – sie übernimmt das Rezept automatisch (sonst „Aus Zwischenablage einfügen“).</div>`
      : '<div class="err">❌ Kopieren hat nicht geklappt.</div>';
  });
}

// ======================= Cookidoo =======================
interface TransferPayload { v: number; allowApi: boolean; recipe: Recipe; servings?: string }
const STORE = 'petras-rezepte-app:rezept';

/** Vorbereitetes Rezept: aus der Zwischenablage, sonst aus dem Zwischenspeicher dieses Tabs */
async function loadPayload(): Promise<TransferPayload | null> {
  try {
    const t = (await navigator.clipboard.readText()).trim();
    if (t.startsWith(TRANSFER_MARK)) {
      const p = JSON.parse(t.slice(TRANSFER_MARK.length));
      try { sessionStorage.setItem(STORE, JSON.stringify(p)); } catch { /* egal */ }
      return p;
    }
  } catch { /* Zwischenablage nicht erlaubt */ }
  try { const s = sessionStorage.getItem(STORE); return s ? JSON.parse(s) : null; } catch { return null; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | null | undefined | false, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error('Zeitüberschreitung – die Cookidoo-Seite hat nicht wie erwartet reagiert.');
    await sleep(120);
  }
}
const isOpen = (el: Element | null) => !!el && el.getAttribute('hidden') !== 'true' && !el.hasAttribute('hidden');

/** Text in ein Cookidoo-Eingabefeld (contenteditable) setzen – wie Einfügen per Tastatur */
function fillField(field: HTMLElement, html: string, asHtml: boolean) {
  field.focus();
  const sel = window.getSelection();
  const range = document.createRange(); range.selectNodeContents(field);
  sel?.removeAllRanges(); sel?.addRange(range);
  let ok = false;
  try { ok = document.execCommand(asHtml ? 'insertHTML' : 'insertText', false, html); } catch { /* Fallback */ }
  if (!ok || (asHtml && html.includes('<cr-tts') && !field.querySelector('cr-tts'))) {
    if (asHtml) field.innerHTML = html; else field.textContent = html;
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
  }
}

async function addEntry(kind: 'ingredients' | 'steps', content: string, asHtml: boolean) {
  const list = document.querySelector(`cr-manage-list[name="${kind}"]`);
  const before = list?.querySelectorAll('.cr-manage-list__item').length ?? 0;
  const trigger = document.getElementById(`add-${kind}`) as HTMLElement | null;
  if (!trigger) throw new Error('Der Knopf zum Hinzufügen wurde nicht gefunden.');
  trigger.click();
  const modal = await waitFor(() => { const m = document.getElementById(`${kind}-modal`); return isOpen(m) ? m : null; });
  const field = modal!.querySelector('cr-text-field') as HTMLElement;
  fillField(field, content, asHtml);
  await sleep(150);
  (modal!.querySelector('.cr-edit-modal__save') as HTMLElement).click();
  await waitFor(() => (list?.querySelectorAll('.cr-manage-list__item').length ?? 0) > before || !isOpen(modal), 12000);
  await sleep(250);
}

async function transfer() {
  const { root } = panel('Petras Rezepte → Cookidoo');
  const main = root.querySelector('main')!;
  const payload = await loadPayload();
  if (!payload?.recipe) {
    main.innerHTML = `<p>Kein vorbereitetes Rezept gefunden.</p><p class="muted">In der <b>Petras Rezepte App</b> unter „Cookidoo übertragen“ auf <b>„Ausfüllhilfe starten“</b> klicken, dann hier das Lesezeichen erneut anklicken.</p>`;
    return;
  }
  const r = payload.recipe;
  const path = location.pathname;
  const lang = path.match(/\/([a-z]{2}-[A-Z]{2})(?:\/|$)/)?.[1] ?? 'de-DE';
  const editStepsPage = /\/created-recipes\/[a-z]{2}-[A-Z]{2}\/[A-Za-z0-9]+\/edit\/ingredients-and-preparation-steps/.test(path);
  const editPage = /\/created-recipes\/[a-z]{2}-[A-Z]{2}\/[A-Za-z0-9]+\/edit\/?$/.test(path);
  const head = `<p><b>${esc(r.title)}</b><br><span class="muted">${r.ingredients.length} Zutaten · ${r.steps.length} Schritte</span></p>`;

  // ---------- 3) Zutaten & Rezeptschritte eintragen ----------
  if (editStepsPage) {
    const ingr = ingredientLines(r);
    const steps = r.steps.filter((s) => s.text.trim()).map(stepHtml);
    const existing = document.querySelectorAll('cr-manage-list .cr-manage-list__item').length;
    const buttons = steps.reduce((n, s) => n + s.buttons, 0);
    const marked = steps.reduce((n, s) => n + s.ingredients, 0);
    const manual = steps.flatMap((s, i) => s.manual.map((m) => `Schritt ${i + 1}: ${m}`));
    main.innerHTML = `${head}
      <p>Die Ausfüllhilfe trägt <b>${ingr.length} Zutaten</b> und <b>${steps.length} Schritte</b> mit <b>${buttons} Thermomix-Einstellungen</b>${marked ? ` und <b>${marked} Zutaten zum Abwiegen</b>` : ''} nacheinander in dieses Formular ein – so, als würdest du tippen.</p>
      ${existing ? `<div class="warn">⚠ Hier stehen schon ${existing} Einträge. Die neuen werden darunter angehängt.</div>` : ''}
      <button class="btn" id="fill">✍️ Zutaten & Schritte eintragen</button>
      <div id="msg"></div>`;
    root.getElementById('fill')!.addEventListener('click', async (ev) => {
      const btn = ev.target as HTMLButtonElement; btn.disabled = true;
      const msg = root.getElementById('msg')!;
      try {
        (document.getElementById('ingredients-button') as HTMLElement | null)?.click();
        await sleep(300);
        for (let i = 0; i < ingr.length; i++) { btn.textContent = `⏳ Zutat ${i + 1} von ${ingr.length} …`; await addEntry('ingredients', ingr[i], false); }
        (document.getElementById('preparation-steps-button') as HTMLElement | null)?.click();
        await sleep(400);
        for (let i = 0; i < steps.length; i++) { btn.textContent = `⏳ Schritt ${i + 1} von ${steps.length} …`; await addEntry('steps', steps[i].html, true); }
        btn.textContent = '✓ Eingetragen';
        msg.innerHTML = `<div class="ok">✅ <b>Fertig eingetragen.</b><br>Bitte kurz durchsehen (Thermomix-Knöpfe in den Schritten) und oben auf <b>„Bestätigen“</b> klicken.</div>
          ${manual.length ? `<div class="warn">Bitte diese Einstellung(en) im Schritt über das Symbol <b>„Koch-Einstellungen“</b> ergänzen: ${manual.map(esc).join(' · ')}</div>` : ''}`;
        try { sessionStorage.removeItem(STORE); } catch { /* egal */ }
      } catch (e: any) {
        btn.disabled = false; btn.textContent = 'Nochmal versuchen';
        msg.innerHTML = `<div class="err">❌ ${esc(e.message)}<br><span class="muted">Die übrigen Einträge bitte über den Übertragungsassistenten der App kopieren.</span></div>`;
      }
    });
    return;
  }

  // ---------- 2) Editor-Hauptseite: Portionen/Zeiten zeigen, weiter zu Zutaten & Schritten ----------
  if (editPage) {
    const rows = [['Portionen', r.servings ? `${r.servings}` : ''], ['Arbeitszeit (Min.)', r.prepTime ? `${r.prepTime}` : ''], ['Gesamtzeit (Min.)', r.totalTime ? `${r.totalTime}` : '']].filter((x) => x[1]);
    main.innerHTML = `${head}
      ${rows.length ? `<p class="muted">Diese Werte hier im Editor eintragen:</p><ul>${rows.map(([k, v]) => `<li>${esc(k)}: <b>${esc(v)}</b></li>`).join('')}</ul>` : ''}
      <button class="btn" id="next">➜ Weiter zu „Zutaten & Rezeptschritte“</button>
      <p class="muted">Dort das Lesezeichen noch einmal anklicken.</p>`;
    root.getElementById('next')!.addEventListener('click', () => { location.href = `${path.replace(/\/$/, '')}/ingredients-and-preparation-steps?active=ingredients`; });
    return;
  }

  // ---------- 1) Übersicht „Meine Kreationen“: Rezept anlegen ----------
  const tiles = Array.from(document.querySelectorAll('core-tile img[alt]')).map((i) => (i.getAttribute('alt') ?? '').trim().toLowerCase());
  const exists = tiles.includes(r.title.trim().toLowerCase());
  const onList = new RegExp(`/created-recipes/${lang}/?$`).test(path);
  main.innerHTML = `${head}
    ${exists ? `<div class="warn">⚠ In „Meine Kreationen“ gibt es schon ein Rezept mit diesem Namen.</div>` : ''}
    <button class="btn" id="create">➕ Rezept in Cookidoo anlegen</button>
    <p class="muted">Trägt den Namen in Cookidoos Dialog „Eigenes Rezept erstellen“ ein. Danach im Editor das Lesezeichen erneut anklicken.</p>
    ${payload.allowApi ? `<div class="warn" style="margin-top:14px"><b>Schnellübertragung (experimentell)</b> – speichert alles auf einmal über die interne Schnittstelle der Webseite.<button class="btn" id="api" style="background:#C9733F">⚡ Schnellübertragung</button></div>` : ''}
    <div id="msg"></div>`;
  root.getElementById('create')!.addEventListener('click', async () => {
    try {
      if (!onList) { location.href = `/created-recipes/${lang}`; return; }
      (document.getElementById('create-button') as HTMLElement | null)?.click();
      const input = await waitFor(() => { const i = document.getElementById('recipe-title') as HTMLInputElement | null; return i && i.offsetParent !== null ? i : null; }, 5000);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, r.title.slice(0, 120));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(200);
      (input.form?.querySelector('button[type="submit"]') as HTMLElement | null)?.click();
      root.getElementById('msg')!.innerHTML = '<div class="ok">✅ Rezept wird angelegt … Im Editor dann das Lesezeichen erneut anklicken.</div>';
    } catch (e: any) {
      root.getElementById('msg')!.innerHTML = `<div class="err">❌ ${esc(e.message)}<br>Bitte auf „Rezept erstellen“ klicken und den Namen einfügen: <b>${esc(r.title)}</b></div>`;
    }
  });
  root.getElementById('api')?.addEventListener('click', async (ev) => {
    const btn = ev.target as HTMLButtonElement; btn.disabled = true; btn.textContent = '⏳ Wird gespeichert …';
    try {
      const res = await saveInCookidoo(r);
      root.getElementById('msg')!.innerHTML = `<div class="ok">✅ <b>Gespeichert!</b> ${res.buttons} Thermomix-Knöpfe in ${res.steps} Schritten.<br><a href="${esc(res.url)}/edit">Im Editor prüfen</a></div>`;
      btn.textContent = '✓ Gespeichert';
    } catch (e: any) {
      root.getElementById('msg')!.innerHTML = `<div class="err">❌ ${esc(e.message)}</div>`; btn.disabled = false; btn.textContent = 'Nochmal versuchen';
    }
  });
}

export function run() {
  if (/(^|\.)cookidoo\.[a-z.]+$/.test(location.hostname)) transfer(); else grab();
}
run();
