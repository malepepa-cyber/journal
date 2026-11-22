/**
 * Build der Petras Rezepte App.
 *   node build/build.mjs          → Oberfläche + Lesezeichen + Server (dist/)
 *   node build/build.mjs --win    → zusätzlich Windows-EXE + Installer (siehe build/windows.mjs)
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const r = (...p) => join(root, ...p);
const step = (m) => console.log(`\n▶ ${m}`);

// 1) OCR-Dateien (Tesseract, deutsches Sprachmodell) in die Oberfläche kopieren
step('OCR-Dateien kopieren');
const ocr = r('web', 'public', 'ocr');
rmSync(ocr, { recursive: true, force: true });
mkdirSync(join(ocr, 'core'), { recursive: true });
mkdirSync(join(ocr, 'lang'), { recursive: true });
cpSync(r('node_modules/tesseract.js/dist/worker.min.js'), join(ocr, 'worker.min.js'));
for (const f of readdirSync(r('node_modules/tesseract.js-core'))) {
  if (/^tesseract-core.*-lstm\.wasm\.js$|^tesseract-core.*-lstm\.js$/.test(f)) cpSync(r('node_modules/tesseract.js-core', f), join(ocr, 'core', f));
}
cpSync(r('node_modules/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz'), join(ocr, 'lang', 'deu.traineddata.gz'));

// 2) Oberfläche (React + Tailwind)
step('Oberfläche bauen (Vite)');
rmSync(r('web', 'dist'), { recursive: true, force: true });
execSync('npx vite build --config web/vite.config.ts --logLevel warn', { cwd: root, stdio: 'inherit' });

// 3) Lesezeichen „➜ Petras Rezepte“
step('Lesezeichen bauen');
mkdirSync(r('web', 'dist', 'helper'), { recursive: true });
await build({
  entryPoints: [r('helper', 'helper.ts')], bundle: true, minify: true, format: 'iife', target: 'es2020',
  outfile: r('web', 'dist', 'helper', 'bookmarklet.js'), legalComments: 'none', charset: 'utf8',
});

// 4) Lokaler Dienst als eine CommonJS-Datei (für Node „Single Executable Application“)
step('Lokalen Dienst bauen');
mkdirSync(r('dist'), { recursive: true });
await build({
  entryPoints: [r('server', 'main.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  outfile: r('dist', 'server.cjs'), legalComments: 'none', charset: 'utf8',
  define: { 'import.meta.url': '__import_meta_url' },
  banner: { js: "const __import_meta_url = require('url').pathToFileURL(__filename).href;" },
});
// Liste aller Oberflächen-Dateien (für die Einbettung in die EXE)
const files = [];
const walk = (d, pre = '') => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = pre ? `${pre}/${e.name}` : e.name; e.isDirectory() ? walk(join(d, e.name), p) : files.push(p); } };
walk(r('web', 'dist'));
writeFileSync(r('dist', 'web-files.json'), JSON.stringify(files, null, 0));
console.log(`  ${files.length} Dateien der Oberfläche`);

if (process.argv.includes('--win')) {
  step('Windows-Paket bauen');
  await import('./windows.mjs');
}
console.log('\n✓ Fertig');
