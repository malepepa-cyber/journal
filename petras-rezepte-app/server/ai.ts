/**
 * OPTIONALE KI-Unterstützung (Claude-API, eigener API-Schlüssel nötig).
 * Die App funktioniert vollständig ohne diese Funktion.
 *
 * - Der Schlüssel liegt verschlüsselt im lokalen Dienst (secrets.ts) und wird nie an die Oberfläche gegeben.
 * - Es wird nur der Rezepttext gesendet – keine Zugangsdaten, keine persönlichen Daten.
 * - Ergebnisse sind immer VORSCHLÄGE: Thermomix-Einstellungen, die nicht im Originaltext stehen,
 *   landen in `suggestions` (Quelle „ki“) und müssen in der App bestätigt werden.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { CATEGORIES, emptyRecipe, newId, type Recipe, type TmSetting } from '../shared/model.ts';
import { detectAccessories } from '../shared/parser.ts';
import { findRestMinutes, findSettings } from '../shared/tm.ts';
import { readApiKey } from './secrets.ts';

export const DEFAULT_AI_MODEL = 'claude-opus-5-5';

const SettingSchema = z.object({
  mode: z.enum(['manual', 'dough', 'turbo', 'browning']),
  timeSeconds: z.number().nullable(),
  temperatureC: z.number().nullable(),
  varoma: z.boolean(),
  speed: z.string().nullable().describe('"0.5" bis "10" oder "soft" für Sanftrührstufe'),
  reverse: z.boolean(),
  reason: z.string().describe('kurze deutsche Begründung'),
});

const RecipeSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.enum(CATEGORIES),
  servings: z.number().nullable(),
  prepTimeMinutes: z.number().nullable(),
  totalTimeMinutes: z.number().nullable(),
  ingredients: z.array(z.object({
    amount: z.number().nullable(),
    amountMax: z.number().nullable(),
    unit: z.string().describe('einheitlich: g, kg, ml, l, EL, TL, Prise, Pck., Stück, Würfel … oder leer'),
    name: z.string(),
    note: z.string(),
    group: z.string(),
  })),
  steps: z.array(z.object({
    text: z.string().describe('Schritttext in deutscher Sprache. Thermomix-Angaben NUR, wenn sie im Original stehen.'),
    suggestion: SettingSchema.nullable().describe('Vorschlag, falls der Schritt im Mixtopf passiert und KEINE Angabe im Original steht'),
  })),
  issues: z.array(z.string()).describe('Unvollständige oder unplausible Angaben, kurz auf Deutsch'),
});

const SYSTEM = `Du hilfst, Rezepte für den Thermomix TM6 aufzubereiten. Antworte ausschließlich im vorgegebenen JSON-Format, auf Deutsch.
Regeln:
- Übernimm Zutaten und Schritte inhaltlich vollständig aus dem Originaltext. Erfinde keine Zutaten oder Mengen.
- Vereinheitliche Einheiten (Gramm→g, Esslöffel→EL, Teelöffel→TL, Milliliter→ml).
- Thermomix-Angaben (z. B. "3 Min./120°C/Stufe 1") gehören nur dann in "text", wenn sie im Original stehen; dann exakt in dieser Schreibweise.
- Fehlen Angaben bei einem Schritt, der im Mixtopf stattfindet, setze "suggestion" mit üblichen TM6-Werten (max. 120 °C manuell, Stufe 0,5–10, Teigstufe max. 6 Min.). Für Backofen-, Pfannen- oder Kühlschrankschritte keine suggestion.
- Ruhe- und Gehzeiten als eigenen Schritt belassen.
- Liste fehlende Mengen oder unklare Angaben in "issues".`;

function toSetting(s: z.infer<typeof SettingSchema>): TmSetting {
  return {
    mode: s.mode, time: s.timeSeconds, temp: s.varoma ? 'Varoma' : s.temperatureC,
    speed: s.speed, reverse: s.reverse || undefined,
  };
}

export class AiError extends Error { status = 502; }

/** Strukturiert einen Rezepttext mit Claude. */
export async function structureWithAi(text: string, model = DEFAULT_AI_MODEL): Promise<{ recipe: Recipe; issues: string[] }> {
  const apiKey = readApiKey();
  if (!apiKey) throw Object.assign(new AiError('Kein KI-Schlüssel hinterlegt (Einstellungen → KI).'), { status: 400 });
  if (text.length > 60_000) throw Object.assign(new AiError('Der Text ist für die KI zu lang (max. 60.000 Zeichen).'), { status: 400 });

  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  let response;
  try {
    response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: `Rezepttext:\n\n${text}` }],
      output_config: { format: zodOutputFormat(RecipeSchema) },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('Der KI-Schlüssel ist ungültig.');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('Die KI ist gerade ausgelastet – bitte gleich noch einmal versuchen.');
    if (e instanceof Anthropic.APIConnectionError) throw new AiError('Keine Internetverbindung zur KI.');
    if (e instanceof Anthropic.APIError) throw new AiError(`KI-Fehler (${e.status ?? '?'})`);
    throw e;
  }
  if (response.stop_reason === 'refusal') throw new AiError('Die KI hat die Anfrage abgelehnt.');
  const out = response.parsed_output;
  if (!out) throw new AiError('Die KI-Antwort war unvollständig.');

  const r = emptyRecipe();
  Object.assign(r, {
    title: out.title, description: out.description, category: out.category,
    servings: out.servings, prepTime: out.prepTimeMinutes, totalTime: out.totalTimeMinutes,
    source: { type: 'text', name: 'KI-Aufbereitung' },
    ingredients: out.ingredients.map((i) => ({ id: newId(), ...i })),
    steps: out.steps.map((s) => {
      const hasOwn = findSettings(s.text).length > 0;
      return {
        id: newId(), text: s.text, accessories: detectAccessories(s.text),
        restMinutes: hasOwn ? null : findRestMinutes(s.text),
        suggestions: !hasOwn && s.suggestion ? [{ setting: toSetting(s.suggestion), reason: s.suggestion.reason, source: 'ki' as const }] : [],
      };
    }),
  });
  const rest = r.steps.reduce((sum, s) => sum + (s.restMinutes ?? 0), 0);
  r.restTime = rest || null;
  return { recipe: r, issues: out.issues };
}
