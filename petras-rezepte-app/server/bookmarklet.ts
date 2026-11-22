/** Liefert das Lesezeichen „➜ Petras Rezepte“ als javascript:-Adresse. */
import { readAsset } from './assets.ts';

let cache: string | null = null;
export function bookmarkletSource(): string {
  if (cache) return cache;
  const a = readAsset('helper/bookmarklet.js');
  if (!a) throw Object.assign(new Error('Lesezeichen nicht gefunden – bitte „npm run build“ ausführen.'), { status: 500 });
  cache = `javascript:${encodeURIComponent(`(()=>{${a.data.toString('utf8')}})();void 0`)}`;
  return cache;
}
