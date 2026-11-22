/**
 * Datenmodell der Petras Rezepte App.
 * Wird von Oberfläche (web/) und lokalem Dienst (server/) gemeinsam genutzt.
 *
 * Grundprinzip: Der Text eines Arbeitsschritts ist die einzige "Wahrheit".
 * Thermomix-Einstellungen werden daraus gelesen (siehe tm.ts). Vorschläge der
 * App liegen getrennt in `suggestions` und landen erst nach Bestätigung im Text.
 */

export const CATEGORIES = [
  'Hauptgerichte', 'Suppen', 'Salate', 'Kuchen', 'Brot und Brötchen', 'Desserts',
  'Frühstück', 'Beilagen', 'Soßen', 'Getränke', 'Sonstiges',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const DIFFICULTIES = ['einfach', 'mittel', 'aufwendig'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Thermomix-Modi, die die App kennt. */
export type TmMode = 'manual' | 'dough' | 'turbo' | 'browning' | 'steaming';

/** Eine Thermomix-Einstellung (z. B. „3 Min./120 °C/Linkslauf/Stufe 1“). */
export interface TmSetting {
  mode: TmMode;
  /** Dauer in Sekunden */
  time?: number | null;
  /** Temperatur in °C oder 'Varoma' */
  temp?: number | 'Varoma' | null;
  /** Stufe als Text: '0.5' … '10' oder 'soft' (Sanftrührstufe) */
  speed?: string | null;
  reverse?: boolean;
  /** Turbo: Anzahl Impulse */
  pulses?: number | null;
}

/** Erkannte Einstellung inkl. Position im Schritttext. */
export interface TmMatch extends TmSetting {
  offset: number;
  length: number;
  match: string;
  warnings: string[];
}

/** Vorschlag der App (oder KI) für einen Schritt ohne Thermomix-Angabe. */
export interface TmSuggestion {
  setting: TmSetting;
  /** Begründung, z. B. „‚dünsten‘ → üblich 3 Min./120 °C/Stufe 1“ */
  reason: string;
  source: 'regel' | 'ki';
  accessories?: Accessory[];
}

export const ACCESSORIES = {
  butterfly: 'Rühraufsatz',
  basket: 'Gareinsatz',
  varoma: 'Varoma',
  cupOff: 'ohne Messbecher',
  cupOn: 'Messbecher',
  basketAsLid: 'Gareinsatz als Deckel',
  spatula: 'Spatel',
} as const;
export type Accessory = keyof typeof ACCESSORIES;

export interface Ingredient {
  id: string;
  amount: number | null;
  amountMax: number | null;
  unit: string;
  name: string;
  /** Zusatz, z. B. „halbiert“, „zimmerwarm“ */
  note: string;
  /** Gruppe, z. B. „Für den Teig“ (leer = keine) */
  group: string;
}

export interface Step {
  id: string;
  text: string;
  accessories: Accessory[];
  /** Ruhe-/Geh-/Kühlzeit in Minuten, falls der Schritt eine Wartezeit ist */
  restMinutes: number | null;
  suggestions: TmSuggestion[];
}

export type SourceType = 'text' | 'pdf' | 'ocr' | 'docx' | 'txt' | 'web' | 'manual' | 'sample';

export type CookidooStatus = 'offen' | 'in Arbeit' | 'übertragen';

export interface Recipe {
  id: number | null;
  profileId: number | null;
  title: string;
  description: string;
  category: Category;
  difficulty: Difficulty | null;
  servings: number | null;
  servingsUnit: string;
  /** Minuten */
  prepTime: number | null;
  cookTime: number | null;
  restTime: number | null;
  totalTime: number | null;
  photo: string | null;
  ingredients: Ingredient[];
  steps: Step[];
  notes: string;
  favorite: boolean;
  source: { type: SourceType; name: string; url?: string };
  cookidoo: { status: CookidooStatus; at?: string | null; url?: string | null };
  createdAt?: string;
  updatedAt?: string;
}

export interface RecipeSummary {
  id: number;
  title: string;
  category: Category;
  favorite: boolean;
  photo: string | null;
  totalTime: number | null;
  servings: number | null;
  cookidooStatus: CookidooStatus;
  updatedAt: string;
  createdAt: string;
}

export interface Profile { id: number; name: string; createdAt: string }

export const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function emptyRecipe(): Recipe {
  return {
    id: null, profileId: null, title: '', description: '', category: 'Sonstiges', difficulty: null,
    servings: null, servingsUnit: 'Portionen', prepTime: null, cookTime: null, restTime: null, totalTime: null,
    photo: null, ingredients: [], steps: [], notes: '', favorite: false,
    source: { type: 'manual', name: '' }, cookidoo: { status: 'offen' },
  };
}
