/**
 * Erzeugt aus samples/*.txt
 *  - web/public/beispielrezepte.json (in der App über „Beispielrezepte laden“)
 *  - samples/beispiel-datenbank.db   (fertige SQLite-Datenbank mit den Testrezepten)
 *   npx tsx build/make-samples.ts
 */
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseRecipeText } from '../shared/parser.ts';
import { insertSetting } from '../shared/tm.ts';

const dir = new URL('../samples/', import.meta.url).pathname;
const recipes = readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((f) => {
  const r = parseRecipeText(readFileSync(join(dir, f), 'utf8'), { type: 'sample', name: 'Beispielrezept' });
  // Beispiel: Vorschläge des letzten Rezepts NICHT übernehmen, damit man die Funktion ausprobieren kann
  if (!f.startsWith('06')) r.steps = r.steps.map((s) => (s.suggestions.length ? { ...s, text: insertSetting(s.text, s.suggestions[0].setting), suggestions: [] } : s));
  r.notes = 'Beispielrezept der Petras Rezepte App – kann gelöscht werden.';
  return r;
});
const payload = { format: 'petras-rezepte-app', version: 1, exportedAt: new Date().toISOString(), recipes };
writeFileSync(new URL('../web/public/beispielrezepte.json', import.meta.url), JSON.stringify(payload));
console.log(`✓ ${recipes.length} Beispielrezepte → web/public/beispielrezepte.json`);

process.env.PRA_DATA_DIR = mkdtempSync(join(tmpdir(), 'pra-samples-'));
process.env.PRA_DEFAULT_PROFILE = 'Petra';
const db = await import('../server/db.ts');
db.openDb();
for (const r of recipes) db.saveRecipe(db.currentProfileId(), r);
db.openDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.closeDb();
copyFileSync(join(process.env.PRA_DATA_DIR, 'rezepte.db'), join(dir, 'beispiel-datenbank.db'));
console.log('✓ samples/beispiel-datenbank.db');
