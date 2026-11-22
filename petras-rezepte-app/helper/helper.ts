/**
 * Lesezeichen „➜ Petras Rezepte“.
 * - Auf einer Rezeptseite: Rezept auslesen und für die App in die Zwischenablage kopieren.
 * - Auf cookidoo.de: vorbereitetes Rezept aus der App speichern – NUR wenn in der App die
 *   experimentelle Schnellübertragung eingeschaltet wurde (Kennzeichen im kopierten Paket).
 */
import type { Recipe } from '../shared/model.ts';
import { findSettings, describeSetting } from '../shared/tm.ts';
import { extractFromDocument } from './extract.ts';
import { saveInCookidoo } from './cookidoo-browser.ts';

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

/** Auf einer Rezeptseite: auslesen und kopieren */
async function grab() {
  const { root } = panel('Rezept für Petras Rezepte App');
  const main = root.querySelector('main')!;
  const { text, source } = extractFromDocument(document, window);
  const lines = text.split('\n').filter(Boolean);
  main.innerHTML = `<p>Gelesen aus: <b>${esc(source)}</b></p>
    <p class="muted">${esc(lines[0] ?? '')} · ${lines.length} Zeilen</p>
    <button class="btn" id="go">📋 Für die App kopieren</button>
    <p class="muted">Tipp: Wird etwas falsch gelesen, das Rezept auf der Seite markieren und das Lesezeichen erneut klicken.</p>
    <div id="msg"></div>`;
  root.getElementById('go')!.addEventListener('click', async () => {
    const ok = await copy(IMPORT_MARK + JSON.stringify({ v: 1, text, source: location.href.split('?')[0], title: document.title }));
    root.getElementById('msg')!.innerHTML = ok
      ? `<div class="ok">✅ <b>Kopiert!</b><br>Jetzt in der <b>Petras Rezepte App</b> auf „Rezept importieren“ → <b>„Aus Zwischenablage einfügen“</b> klicken.</div>`
      : '<div class="err">❌ Kopieren hat nicht geklappt.</div>';
  });
}

/** Auf cookidoo.de: vorbereitetes Rezept speichern (experimentell) */
async function transfer() {
  const { root } = panel('Petras Rezepte → Cookidoo');
  const main = root.querySelector('main')!;
  main.innerHTML = `<p class="muted">Lese das vorbereitete Rezept aus der Zwischenablage …</p>
    <textarea id="in" style="width:100%;min-height:70px;border:1px solid #ddd;border-radius:10px;padding:8px" placeholder="Falls nichts erscheint: hier klicken und Strg + V drücken"></textarea>
    <div id="pv"></div><div id="msg"></div>`;
  const input = root.getElementById('in') as HTMLTextAreaElement;
  const show = (raw: string) => {
    const t = raw.trim();
    if (!t.startsWith(TRANSFER_MARK)) {
      root.getElementById('pv')!.innerHTML = t ? '<div class="err">Das ist kein vorbereitetes Rezept. Bitte in der App unter „Cookidoo übertragen“ zuerst auf „Schnellübertragung vorbereiten“ klicken.</div>' : '';
      return;
    }
    let payload: { v: number; allowApi: boolean; recipe: Recipe };
    try { payload = JSON.parse(t.slice(TRANSFER_MARK.length)); } catch { return; }
    const r = payload.recipe;
    if (!payload.allowApi) {
      root.getElementById('pv')!.innerHTML = '<div class="warn">Die Schnellübertragung ist in der App ausgeschaltet. Bitte den <b>Übertragungsassistenten</b> in der App verwenden.</div>';
      return;
    }
    const buttons = r.steps.reduce((n, s) => n + findSettings(s.text).length, 0);
    root.getElementById('pv')!.innerHTML = `<p><b>${esc(r.title)}</b><br><span class="muted">${r.ingredients.length} Zutaten · ${r.steps.length} Schritte · ${buttons} Thermomix-Einstellungen</span></p>
      <ol>${r.steps.slice(0, 30).map((s) => `<li>${esc(s.text.length > 80 ? `${s.text.slice(0, 80)}…` : s.text)}<br>${findSettings(s.text).map((o) => `<span class="tm">${esc(describeSetting(o).join(' · '))}</span>`).join('')}</li>`).join('')}</ol>
      <div class="warn">Experimentell: nutzt dieselbe Schnittstelle wie die Cookidoo-Webseite (nicht offiziell dokumentiert). Bitte das Ergebnis in Cookidoo kurz prüfen.</div>
      <button class="btn" id="save">☁️ In „Meine Kreationen“ speichern</button>`;
    root.getElementById('save')!.addEventListener('click', async (ev) => {
      const btn = ev.target as HTMLButtonElement;
      btn.disabled = true; btn.textContent = '⏳ Wird gespeichert …';
      try {
        const res = await saveInCookidoo(r);
        const note = ['', 'Einige Sondereinstellungen (Varoma/Sanftrührstufe/Teig/Turbo/Anbraten) wurden vereinfacht – bitte prüfen.', 'Die Einstellungs-Knöpfe wurden nicht angenommen – die Schritte stehen als Text drin.'][res.level];
        root.getElementById('msg')!.innerHTML = `<div class="ok">✅ <b>Gespeichert!</b> ${res.buttons} Thermomix-Knöpfe in ${res.steps} Schritten.${note ? `<br>${esc(note)}` : ''}<br>
          Auf dem TM6: <i>Meine Rezepte → Meine Kreationen</i>.<br><a href="${esc(res.url)}">Rezept in Cookidoo öffnen</a></div>`;
        btn.textContent = '✓ Gespeichert';
      } catch (e: any) {
        root.getElementById('msg')!.innerHTML = `<div class="err">❌ <b>${esc(e.message)}</b><br><span class="muted">Der Übertragungsassistent in der App funktioniert unabhängig davon.</span></div>`;
        btn.disabled = false; btn.textContent = 'Nochmal versuchen';
      }
    });
  };
  input.addEventListener('input', () => show(input.value));
  try { const t = await navigator.clipboard.readText(); if (t) { input.value = t; show(t); } } catch { input.focus(); }
}

export function run() {
  if (/(^|\.)cookidoo\.[a-z.]+$/.test(location.hostname)) transfer(); else grab();
}
run();
