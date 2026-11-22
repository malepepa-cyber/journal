/** Sammelt die Lizenztexte aller mitgelieferten Bibliotheken → build/LIZENZEN-Drittanbieter.txt */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const paths = execSync('npm ls --omit=dev --all --parseable', { cwd: root, encoding: 'utf8' }).split('\n').filter((p) => p.includes('node_modules'));
const seen = new Map();
for (const p of paths) {
  if (!existsSync(join(p, 'package.json'))) continue;
  const pkg = JSON.parse(readFileSync(join(p, 'package.json'), 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) continue;
  const lic = readdirSync(p).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  seen.set(key, { name: pkg.name, version: pkg.version, license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'siehe Text', text: lic ? readFileSync(join(p, lic), 'utf8').trim() : '' });
}
const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
let out = `Petras Rezepte App – Lizenzen der enthaltenen Open-Source-Software\n${'='.repeat(66)}\n\n`;
out += `Enthält Node.js (MIT, https://nodejs.org) und folgende Bibliotheken:\n\n${list.map((l) => `  ${l.name} ${l.version} – ${l.license}`).join('\n')}\n\n`;
out += 'jszip ist doppelt lizenziert (MIT oder GPL-3.0); es wird unter der MIT-Lizenz verwendet.\n';
out += 'Das deutsche Sprachmodell für die Texterkennung stammt aus dem Tesseract-Projekt (Apache-2.0).\n\n';
for (const l of list) if (l.text) out += `\n${'-'.repeat(66)}\n${l.name} ${l.version}\n${'-'.repeat(66)}\n${l.text}\n`;
writeFileSync(join(root, 'build', 'LIZENZEN-Drittanbieter.txt'), out.replace(/\r?\n/g, '\r\n'));
console.log(`  ${list.length} Pakete → build/LIZENZEN-Drittanbieter.txt`);
