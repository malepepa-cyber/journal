/**
 * Zutaten zerlegen in Menge · Einheit · Zutat · Zusatz, Einheiten vereinheitlichen,
 * Mengen prüfen und wieder als Text ausgeben.
 */
import { newId, type Ingredient } from './model.ts';

/** Schreibweisen → einheitliche Einheit */
const UNIT_MAP: Record<string, string> = {
  g: 'g', gr: 'g', 'gr.': 'g', gramm: 'g',
  kg: 'kg', kilo: 'kg', kilogramm: 'kg',
  mg: 'mg',
  ml: 'ml', milliliter: 'ml',
  cl: 'cl', dl: 'dl',
  l: 'l', liter: 'l', ltr: 'l', 'ltr.': 'l',
  el: 'EL', 'el.': 'EL', essl: 'EL', 'essl.': 'EL', esslöffel: 'EL', 'gestr. el': 'EL', 'geh. el': 'EL',
  tl: 'TL', 'tl.': 'TL', teel: 'TL', 'teel.': 'TL', teelöffel: 'TL', 'gestr. tl': 'TL', 'geh. tl': 'TL',
  msp: 'Msp.', 'msp.': 'Msp.', messerspitze: 'Msp.', messerspitzen: 'Msp.',
  prise: 'Prise', prisen: 'Prise',
  pck: 'Pck.', 'pck.': 'Pck.', päckchen: 'Pck.', packung: 'Pck.', packungen: 'Pck.', pkg: 'Pck.', 'pkg.': 'Pck.', tüte: 'Pck.', tüten: 'Pck.',
  dose: 'Dose', dosen: 'Dose',
  becher: 'Becher',
  bund: 'Bund',
  stück: 'Stück', stk: 'Stück', 'stk.': 'Stück', st: 'Stück', 'st.': 'Stück',
  zehe: 'Zehe', zehen: 'Zehe',
  scheibe: 'Scheibe', scheiben: 'Scheibe',
  tasse: 'Tasse', tassen: 'Tasse',
  handvoll: 'Handvoll',
  spritzer: 'Spritzer', schuss: 'Schuss',
  würfel: 'Würfel',
  blatt: 'Blatt', blätter: 'Blatt',
  glas: 'Glas', gläser: 'Glas',
  tropfen: 'Tropfen',
  zweig: 'Zweig', zweige: 'Zweig',
  stange: 'Stange', stangen: 'Stange',
  knolle: 'Knolle', knollen: 'Knolle',
  kopf: 'Kopf', köpfe: 'Kopf',
  tafel: 'Tafel', tafeln: 'Tafel',
  rolle: 'Rolle', rollen: 'Rolle',
  beutel: 'Beutel',
  messbecher: 'Messbecher',
};
export const KNOWN_UNITS = [...new Set(Object.values(UNIT_MAP))];
/** „Gramm“ → „g“, „Essl.“ → „EL“ … (unbekannte Einheiten bleiben unverändert) */
export const normalizeUnit = (u: string): string => { const t = u.trim(); return UNIT_MAP[t.toLowerCase()] ?? t; };

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const NUM_RE = String.raw`(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[,.]\d+)?(?:\s*[½¼¾⅓⅔⅛])?|[½¼¾⅓⅔⅛])`;
const unitAlternatives = Object.keys(UNIT_MAP)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.]/g, '\\.'))
  .join('|');
const LINE_RE = new RegExp(
  String.raw`^(?:ca\.?\s*|etwa\s*)?(${NUM_RE})(?:\s*(?:-|–|bis)\s*(${NUM_RE}))?\s*(?:(${unitAlternatives})(?![a-zäöüß]))?\.?\s*(.*)$`,
  'iu',
);

export function parseAmount(s: string): number | null {
  const mixedFrac = s.trim().match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixedFrac) return Number(mixedFrac[1]) + Number(mixedFrac[2]) / Number(mixedFrac[3]);
  const t = s.trim().replace(/\s+/g, '');
  if (!t) return null;
  if (t in FRACTIONS) return FRACTIONS[t];
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const mixed = t.match(/^(\d+(?:[,.]\d+)?)([½¼¾⅓⅔⅛])$/);
  if (mixed) return parseFloat(mixed[1].replace(',', '.')) + FRACTIONS[mixed[2]];
  const n = parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function formatAmount(n: number | null): string {
  if (n == null) return '';
  const r = Math.round(n * 100) / 100;
  for (const [ch, v] of Object.entries(FRACTIONS)) if (Math.abs(r - v) < 0.01) return ch;
  return String(r).replace('.', ',');
}

/** „500 g Mehl (Type 405), gesiebt“ → {amount:500, unit:'g', name:'Mehl (Type 405)', note:'gesiebt'} */
export function parseIngredient(line: string, group = ''): Ingredient {
  const text = line.replace(/\s+/g, ' ').trim();
  const ing: Ingredient = { id: newId(), amount: null, amountMax: null, unit: '', name: text, note: '', group };
  const m = text.match(LINE_RE);
  let rest = text;
  if (m) {
    ing.amount = parseAmount(m[1]);
    ing.amountMax = m[2] ? parseAmount(m[2]) : null;
    if (m[3]) ing.unit = UNIT_MAP[m[3].toLowerCase()] ?? m[3];
    rest = m[4] ?? '';
  }
  // Zusatz nach Komma oder Gedankenstrich (nicht innerhalb von Klammern)
  const cut = rest.search(/,(?![^()]*\))|\s[–-]\s/);
  if (cut > 0) {
    ing.note = rest.slice(cut).replace(/^[,\s–-]+/, '').trim();
    rest = rest.slice(0, cut);
  }
  ing.name = rest.trim() || text;
  return ing;
}

export function formatIngredient(i: Pick<Ingredient, 'amount' | 'amountMax' | 'unit' | 'name' | 'note'>): string {
  const amount = i.amount != null
    ? (i.amountMax != null && i.amountMax !== i.amount ? `${formatAmount(i.amount)}-${formatAmount(i.amountMax)}` : formatAmount(i.amount))
    : '';
  return [amount, i.unit, i.name].filter(Boolean).join(' ') + (i.note ? `, ${i.note}` : '');
}

/** Zutaten, für die keine Menge nötig ist */
const NO_AMOUNT_OK = /\b(salz|pfeffer|muskat|zum (bestreuen|garnieren|braten|einfetten)|nach (belieben|geschmack)|etwas|optional|wasser zum|öl zum|fett für|mehl zum)\b/i;

/** Plausibilitätsprüfung einer Zutat. */
export function checkIngredient(i: Ingredient): string[] {
  const w: string[] = [];
  if (!i.name.trim()) w.push('Zutat ohne Namen');
  const full = `${i.name} ${i.note}`;
  // Unter „Außerdem“/„Zubehör“ stehen Geräte (z. B. „Tiefes Ofenblech“) – die brauchen keine Menge
  const equipment = /^(außerdem|zubehör|utensilien|du brauchst|ausstattung)/i.test(i.group ?? '');
  if (i.amount == null && !equipment && !NO_AMOUNT_OK.test(full)) w.push('Menge fehlt');
  if (i.amount != null && i.amount <= 0) w.push('Menge muss größer als 0 sein');
  if (i.amountMax != null && i.amount != null && i.amountMax < i.amount) w.push('Bereich verkehrt herum');
  if (i.unit && !KNOWN_UNITS.includes(i.unit)) w.push(`Unbekannte Einheit „${i.unit}“`);
  if (i.unit === 'g' && i.amount != null && i.amount > 5000) w.push('Ungewöhnlich große Menge');
  if ((i.unit === 'kg' || i.unit === 'l') && i.amount != null && i.amount > 5) w.push('Mehr als in den Mixtopf passt (2,2 l)');
  return w;
}

/** Erkennt Gruppen-Überschriften wie „Für den Teig:“ oder „Belag“. */
export function isGroupHeader(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 50 || /\d/.test(t)) return false;
  return /:$/.test(t) || /^für (den|die|das)\s/i.test(t);
}
