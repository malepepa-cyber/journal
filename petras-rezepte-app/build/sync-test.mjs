// Startet die Firebase-Emulatoren (Auth + Firestore, Projekt „demo-pra“ – rein lokal, ohne Konto, ohne Kosten)
// und führt den Synchronisierungstest aus. Voraussetzung: Java 21. firebase-tools wird bei Bedarf per npx geholt
// oder über FIREBASE_BIN angegeben.
import { spawnSync } from 'node:child_process';
const bin = process.env.FIREBASE_BIN;
const cmd = bin ? [bin] : ['npx', '--yes', 'firebase-tools@15'];
const script = process.argv.includes('--ui') ? 'node tests/e2e/sync-ui.cjs' : 'node --test --test-concurrency=1 --import tsx tests/sync/sync.emulator.ts';
const r = spawnSync(cmd[0], [...cmd.slice(1), 'emulators:exec', '--only', 'auth,firestore', '--project', 'demo-pra', '--config', 'firebase/firebase.json', script], { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
