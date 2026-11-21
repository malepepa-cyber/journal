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
const extract = strip(await read('pc/extract.js'));
const helper = strip(await read('pc/helper.js'));
const app = strip(await read('public/app.js'));
const css = await read('public/style.css');
const svg = await read('public/icon.svg');
const version = new Date().toISOString().slice(0, 10);

// ---- Lesezeichen ----
const helperBundle = `${parser}\n${format}\n${browser}\n${extract}\n${helper}`;
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
const pdftext = strip(await read('public/pdftext.js'));
const pdfLib = await read('public/vendor/pdf.min.js');
const pdfWorker = await read('public/vendor/pdf.worker.min.js');
for (const [n, c] of [['pdf.min.js', pdfLib], ['pdf.worker.min.js', pdfWorker]]) {
  if (/<\/script/i.test(c)) throw new Error(`${n} enthält </script – kann nicht eingebettet werden`);
}
let html = await read('public/index.html');
html = html
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg.trim())}">`)
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`)
  .replace('href="#bookmarklet"', () => `href="${bookmarklet.replace(/"/g, '%22')}"`)
  .replace(/<script type="module" src="app.js"><\/script>/, () => [
    // pdf.js (Apache-2.0, Mozilla) – wird erst beim ersten PDF geladen
    `<script type="text/plain" id="pdfjs-lib">${pdfLib}</script>`,
    `<script type="text/plain" id="pdfjs-worker">${pdfWorker}</script>`,
    '<script>window.PETRAS_STANDALONE = true;</script>',
    `<script>\n(()=>{\n${parser}\n${pdftext}\n${app}\n})();\n</script>`,
  ].join('\n'));
if (!html.includes('javascript:')) throw new Error('Lesezeichen nicht eingesetzt');
html = html.replace('<title>', () => `<!-- Petras Rezepte App – PC-Version ${version} (gebaut mit pc/build.mjs). Enthält pdf.js (Apache-2.0). -->\n<title>`);

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/petras-rezepte.html', root), html);
await writeFile(new URL('dist/petras-rezepte-helfer.user.js', root), userscript);
await writeFile(new URL('dist/lesezeichen.txt', root), bookmarklet + '\n');
console.log(`✓ dist/petras-rezepte.html (${Math.round(html.length / 1024)} KB), Lesezeichen ${Math.round(bookmarklet.length / 1024)} KB`);
