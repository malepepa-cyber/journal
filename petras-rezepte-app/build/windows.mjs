/**
 * Windows-Paket der Petras Rezepte App
 *  1. Node.js für Windows (offizielle Version, Prüfsumme wird geprüft) herunterladen
 *  2. Dienst + Oberfläche als „Single Executable Application“ in EINE EXE einbetten
 *  3. EXE ohne Konsolenfenster starten lassen (GUI-Subsystem)
 *  4. Installer mit NSIS bauen (Verknüpfungen, Deinstallation, ohne Administratorrechte)
 * Läuft unter Linux oder Windows; benötigt `makensis` (NSIS) im Pfad.
 */
import { createHash } from 'node:crypto';
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, openSync, readSync, writeSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const r = (...p) => join(root, ...p);
const pkg = JSON.parse(readFileSync(r('package.json'), 'utf8'));
const NODE_VERSION = process.version; // SEA-Blob muss mit derselben Node-Version erzeugt werden
const cache = r('build', 'cache');
const out = r('release');
const app = join(out, 'app');
mkdirSync(cache, { recursive: true });
rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

await import('./licenses.mjs');

// ---------- 1) node.exe ----------
const zipName = `node-${NODE_VERSION}-win-x64.zip`;
const zipPath = join(cache, zipName);
if (!existsSync(zipPath)) {
  console.log(`  lade ${zipName} …`);
  const res = await fetch(`https://nodejs.org/dist/${NODE_VERSION}/${zipName}`);
  if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status}`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
}
const sums = await (await fetch(`https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`)).text();
const expected = sums.split('\n').find((l) => l.endsWith(`  ${zipName}`))?.split(/\s+/)[0];
const actual = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
if (!expected || expected !== actual) { rmSync(zipPath); throw new Error('Prüfsumme von node.exe stimmt nicht!'); }
console.log(`  node.exe ${NODE_VERSION} – Prüfsumme ok`);
const nodeExe = join(cache, `node-${NODE_VERSION}.exe`);
if (!existsSync(nodeExe)) {
  execFileSync('unzip', ['-o', '-j', zipPath, `node-${NODE_VERSION}-win-x64/node.exe`, '-d', cache], { stdio: 'ignore' });
  copyFileSync(join(cache, 'node.exe'), nodeExe);
}

// ---------- 2) SEA-Blob ----------
const files = JSON.parse(readFileSync(r('dist', 'web-files.json'), 'utf8'));
const assets = Object.fromEntries(files.map((f) => [`web/${f}`, r('web', 'dist', f)]));
const seaConfig = {
  main: r('dist', 'server.cjs'),
  output: r('dist', 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false, // Code-Cache ist plattformabhängig – wir bauen unter Linux für Windows
  assets,
};
writeFileSync(r('dist', 'sea-config.json'), JSON.stringify(seaConfig, null, 1));
execFileSync(process.execPath, ['--experimental-sea-config', r('dist', 'sea-config.json')], { stdio: 'inherit' });

const exe = join(app, 'PetrasRezepteApp.exe');
copyFileSync(nodeExe, exe);
// Ursprüngliche Authenticode-Signatur entfernen (sie wird durch das Einbetten ohnehin ungültig;
// eine unsignierte Datei ist für Windows/Virenscanner unauffälliger als eine beschädigte Signatur).
{
  const buf = readFileSync(exe);
  const pe = buf.readUInt32LE(0x3c);
  const opt = pe + 24;
  const magic = buf.readUInt16LE(opt); // 0x20b = PE32+
  const dd = opt + (magic === 0x20b ? 112 : 96);
  const secOff = buf.readUInt32LE(dd + 4 * 8), secSize = buf.readUInt32LE(dd + 4 * 8 + 4);
  if (secOff && secSize) {
    buf.writeUInt32LE(0, dd + 4 * 8); buf.writeUInt32LE(0, dd + 4 * 8 + 4);
    const trimmed = secOff + secSize === buf.length ? buf.subarray(0, secOff) : buf;
    writeFileSync(exe, trimmed);
    console.log(`  Signatur entfernt (${secSize} Bytes)`);
  }
}
execFileSync(process.execPath, [r('node_modules', 'postject', 'dist', 'cli.js'), exe, 'NODE_SEA_BLOB', r('dist', 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite'], { stdio: 'inherit' });

// ---------- 3) GUI-Subsystem (kein schwarzes Konsolenfenster) ----------
{
  const fd = openSync(exe, 'r+');
  const b = Buffer.alloc(4);
  readSync(fd, b, 0, 4, 0x3c);
  const pe = b.readUInt32LE(0);
  const sig = Buffer.alloc(4); readSync(fd, sig, 0, 4, pe);
  if (sig.toString('latin1') !== 'PE\0\0') throw new Error('Keine gültige PE-Datei');
  const sub = Buffer.alloc(2); sub.writeUInt16LE(2); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  writeSync(fd, sub, 0, 2, pe + 24 + 68);
  closeSync(fd);
}
console.log(`  EXE: ${(statSync(exe).size / 1048576).toFixed(1)} MB`);

// ---------- 4) Begleitdateien ----------
copyFileSync(r('build', 'icon.ico'), join(app, 'app.ico'));
copyFileSync(r('LICENSE.txt'), join(app, 'LIZENZ.txt'));
copyFileSync(r('build', 'LIZENZEN-Drittanbieter.txt'), join(app, 'LIZENZEN.txt'));
writeFileSync(join(app, 'LIESMICH.txt'), readFileSync(r('build', 'LIESMICH.txt'), 'utf8').replace(/\n/g, '\r\n'));

// ---------- 5) Installer ----------
execFileSync('makensis', ['-V2', `-DVERSION=${pkg.version}`, `-DAPPDIR=${app}`, `-DOUTFILE=${join(out, `PetrasRezepteApp-Setup-${pkg.version}.exe`)}`, r('build', 'installer.nsi')], { stdio: 'inherit' });
console.log(`  Installer: release/PetrasRezepteApp-Setup-${pkg.version}.exe (${(statSync(join(out, `PetrasRezepteApp-Setup-${pkg.version}.exe`)).size / 1048576).toFixed(1)} MB)`);
void execSync;
