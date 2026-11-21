// Baut die PC-Version: eine einzelne HTML-Datei (dist/petras-rezepte.html)
// mit eingebautem Lesezeichen-Helfer, plus ein Tampermonkey-Userscript.
//   node pc/build.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (p) => readFile(new URL(p, root), 'utf8');

// Mini-Bundler: entfernt import/export, damit mehrere Module in einem Skript laufen.
function strip(code) {
  return code
    .split('\n')
    .filter((l) => !/^\s*import\s.+from\s.+;\s*$/.test(l) && !/^\s*export\s*\{.*\};?\s*$/.test(l))
    .map((l) => l.replace(/^export\s+(?=(async\s+)?function|const|let|class)/, ''))
    .join('\n');
}

const parser = strip(await read('public/parser.js'));
const format = strip(await read('lib/cookidoo-format.js'));
const browser = strip(await read('lib/cookidoo-browser.js'));
const helper = strip(await read('pc/helper.js'));
const app = strip(await read('public/app.js'));
const css = await read('public/style.css');
const svg = await read('public/icon.svg');
const version = new Date().toISOString().slice(0, 10);

// ---- Lesezeichen ----
const helperBundle = `${parser}\n${format}\n${browser}\n${helper}`;
const bookmarkletCode = `(()=>{\n${helperBundle}\nopenHelper();\n})();`;
// Zeilenkommentare entfernen, damit nichts durch Zeilenumbrüche kaputtgeht.
const bookmarklet = 'javascript:' + encodeURIComponent(
  bookmarkletCode.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'));
new Function(bookmarkletCode.replace('openHelper();', '')); // Syntax-Check

// ---- Userscript (Alternative, falls das Lesezeichen blockiert wird) ----
const userscript = `// ==UserScript==
// @name         Petras Rezepte → Cookidoo
// @namespace    petras-rezepte-app
// @version      ${version.replaceAll('-', '.')}
// @description  Rezept einfügen und als eigenes Rezept in Cookidoo speichern
// @match        https://cookidoo.de/*
// @match        https://cookidoo.at/*
// @match        https://cookidoo.ch/*
// @grant        none
// ==/UserScript==
(() => {
${helperBundle}
  const b = document.createElement('button');
  b.textContent = '🍲 Petras Rezepte';
  b.title = 'Rezept einfügen und speichern';
  b.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483646;background:#2E6B3F;color:#fff;border:0;border-radius:99px;padding:12px 18px;font:600 15px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer';
  b.addEventListener('click', openHelper);
  const add = () => document.body && !document.body.contains(b) && document.body.appendChild(b);
  add(); setInterval(add, 2000);
})();
`;

// ---- HTML-Seite ----
let html = await read('public/index.html');
const install = `
  <section class="card" id="paneInstall">
    <h2>🔖 Einmalig einrichten</h2>
    <p class="hint">Damit das Speichern klappt, kommt ein Lesezeichen in die Lesezeichenleiste
      (Leiste einblenden: <b>Strg + Umschalt + B</b>).</p>
    <ol class="install">
      <li>Diesen grünen Knopf mit der Maus <b>in die Lesezeichenleiste ziehen</b>:<br>
        <a class="bm" href="${bookmarklet}" onclick="alert('Bitte nicht anklicken, sondern in die Lesezeichenleiste ziehen.');return false;">➜ Petras Rezepte speichern</a></li>
      <li>Auf <a href="https://cookidoo.de" target="_blank" rel="noopener">cookidoo.de</a> mit Petras Konto anmelden (bleibt gespeichert).</li>
      <li>Fertig. Ab jetzt: Rezept hier einfügen → prüfen → <b>„Für Cookidoo kopieren &amp; öffnen“</b>
        → auf cookidoo.de das Lesezeichen anklicken → <b>Strg + V</b> → speichern.</li>
    </ol>
    <details><summary>Tipp: Geht auch ohne diese Seite</summary>
      <p class="hint">Man kann das Rezept im Zaubertopf Club kopieren, direkt auf cookidoo.de das Lesezeichen anklicken
      und dort einfügen – die Erkennung ist im Lesezeichen eingebaut.</p></details>
    <details><summary>Lesezeichen funktioniert nicht?</summary>
      <p class="hint">Dann die Browser-Erweiterung <b>Tampermonkey</b> installieren und die Datei
      <code>petras-rezepte-helfer.user.js</code> öffnen. Danach erscheint auf cookidoo.de unten rechts ein Knopf
      „🍲 Petras Rezepte“.</p></details>
  </section>
`;
html = html
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg.trim())}">`)
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}
.install li{margin:10px 0}
.bm{display:inline-block;margin-top:6px;background:var(--brand);color:#fff!important;padding:10px 16px;border-radius:10px;font-weight:700;text-decoration:none;cursor:grab}
details{margin-top:8px}summary{cursor:pointer;color:var(--brand2)}
</style>`)
  .replace('<main>', () => `<main>${install}`)
  .replace(/<script type="module" src="app.js"><\/script>/,
    () => `<script>window.PETRAS_STANDALONE = true;</script>\n<script>\n(()=>{\n${parser}\n${app}\n})();\n</script>`);
html = html.replace('<title>', () => `<!-- Petras Rezepte App – PC-Version ${version} (gebaut mit pc/build.mjs) -->\n<title>`);

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/petras-rezepte.html', root), html);
await writeFile(new URL('dist/petras-rezepte-helfer.user.js', root), userscript);
await writeFile(new URL('dist/lesezeichen.txt', root), bookmarklet + '\n');
console.log(`✓ dist/petras-rezepte.html (${Math.round(html.length / 1024)} KB), Lesezeichen ${Math.round(bookmarklet.length / 1024)} KB`);
