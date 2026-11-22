/**
 * Regelbasierte Thermomix-Vorschläge für Schritte OHNE Thermomix-Angabe.
 * Die Werte orientieren sich an üblichen TM6-Grundeinstellungen.
 * Sie sind immer nur VORSCHLÄGE und werden erst nach Bestätigung übernommen.
 */
import type { TmSetting, TmSuggestion } from './model.ts';
import { findSettings, parseDuration } from './tm.ts';

interface Rule {
  test: RegExp;
  /** Wenn gesetzt, muss auch dies passen (z. B. bestimmte Zutat) */
  also?: RegExp;
  setting: (text: string) => TmSetting;
  reason: string;
  accessories?: TmSuggestion['accessories'];
}

/** Dauer aus dem Satz übernehmen („20 Minuten köcheln“), sonst Standard */
const durationOr = (text: string, fallbackSec: number) => {
  const sec = parseDuration(text.replace(/(\d)\s*[-–]\s*\d+/g, '$1'));
  return sec && sec <= 99 * 60 ? sec : fallbackSec;
};

const RULES: Rule[] = [
  { test: /\b(sahne|schlagsahne|eiweiß|eischnee)\b.*\b(steif )?(schlagen|aufschlagen)\b|\b(steif|aufschlagen)\b/i,
    setting: () => ({ mode: 'manual', time: 180, speed: '3.5' }), reason: '„Aufschlagen“ → mit Rühraufsatz, ca. 3 Min./Stufe 3,5 (Sichtkontrolle!)', accessories: ['butterfly'] },
  { test: /\b(dampfgaren|dämpfen|im varoma|garen im varoma)\b/i,
    setting: (t) => ({ mode: 'manual', time: durationOr(t, 20 * 60), temp: 'Varoma', speed: '1' }), reason: '„Dämpfen“ → Varoma, Stufe 1', accessories: ['varoma'] },
  { test: /\b(fein )?(mahlen|zu puderzucker)\b/i,
    setting: () => ({ mode: 'manual', time: 10, speed: '10' }), reason: '„Mahlen“ → 10 Sek./Stufe 10' },
  { test: /\b(zerkleinern|hacken|klein hacken|fein hacken|grob hacken|häckseln)\b/i,
    setting: (t) => (/grob/i.test(t) ? { mode: 'manual', time: 3, speed: '5' } : { mode: 'manual', time: 5, speed: '5' }),
    reason: '„Zerkleinern“ → 5 Sek./Stufe 5' },
  { test: /\b(raspeln|reiben)\b/i,
    setting: () => ({ mode: 'manual', time: 5, speed: '5' }), reason: '„Raspeln“ → 5 Sek./Stufe 5' },
  { test: /\b(andünsten|dünsten|anschwitzen|glasig)\b/i,
    setting: (t) => ({ mode: 'manual', time: durationOr(t, 180), temp: 120, speed: '1' }), reason: '„Dünsten“ → 3 Min./120 °C/Stufe 1', accessories: ['cupOff'] },
  { test: /\b(anbraten|scharf anbraten|anrösten|rösten)\b/i,
    setting: (t) => ({ mode: 'manual', time: durationOr(t, 300), temp: 120, reverse: true, speed: '1' }), reason: '„Anbraten“ → 5 Min./120 °C/Linkslauf/Stufe 1 (alternativ Modus „Anbraten“)', accessories: ['cupOff'] },
  { test: /\b(schmelzen|zerlassen|zerlaufen lassen)\b/i,
    setting: (t) => ({ mode: 'manual', time: durationOr(t, 180), temp: 50, speed: '2' }), reason: '„Schmelzen“ → 3 Min./50 °C/Stufe 2' },
  { test: /\b(erwärmen|lauwarm|anwärmen|erhitzen)\b/i, also: /\b(hefe|milch)\b/i,
    setting: () => ({ mode: 'manual', time: 120, temp: 37, speed: '2' }), reason: 'Hefeteig: Flüssigkeit auf 37 °C → 2 Min./37 °C/Stufe 2' },
  { test: /\b(erwärmen|anwärmen|erhitzen|warm machen)\b/i,
    setting: (t) => ({ mode: 'manual', time: durationOr(t, 180), temp: 90, speed: '2' }), reason: '„Erwärmen“ → 3 Min./90 °C/Stufe 2' },
  { test: /\b(kneten|zu einem teig|teig verarbeiten)\b/i,
    setting: (t) => ({ mode: 'dough', time: durationOr(t, 120) }), reason: '„Kneten“ → Teigstufe, ca. 2 Min.' },
  { test: /\b(pürieren|fein pürieren|mixen)\b/i,
    setting: (t) => ({ mode: 'manual', time: durationOr(t, 60), speed: '8' }), reason: '„Pürieren“ → 1 Min./Stufe 8 (Stufe 5–10 langsam steigern)' },
  { test: /\b(köcheln|kochen|garen|einkochen|aufkochen|simmern)\b/i,
    setting: (t) => ({ mode: 'manual', time: durationOr(t, 15 * 60), temp: 100, reverse: true, speed: '1' }), reason: '„Kochen/Garen“ → 100 °C/Linkslauf/Stufe 1', accessories: ['basketAsLid'] },
  { test: /\b(unterheben|unterrühren|untermischen)\b/i,
    setting: () => ({ mode: 'manual', time: 20, reverse: true, speed: '3' }), reason: '„Unterheben“ → 20 Sek./Linkslauf/Stufe 3' },
  { test: /\b(verrühren|vermischen|vermengen|mischen|verquirlen|cremig rühren|glatt rühren)\b/i,
    setting: () => ({ mode: 'manual', time: 20, speed: '4' }), reason: '„Verrühren“ → 20 Sek./Stufe 4' },
  { test: /\b(emulgieren)\b/i,
    setting: () => ({ mode: 'manual', time: 60, speed: '4' }), reason: '„Emulgieren“ → 1 Min./Stufe 4' },
];

/** Schritte, die nicht im Mixtopf passieren (Backofen, Pfanne, Kühlschrank …) */
const NOT_TM = /\b(in der zwischenzeit|salzwasser|in einem (großen )?topf|im topf|auf dem herd|backofen|ofen|backen|im ofen|pfanne|grill|kühlschrank|einfrieren|servieren|anrichten|garnieren|gehen lassen|ruhen lassen|abkühlen lassen|auskühlen|form (fetten|einfetten)|ausrollen|formen|bestreuen|blech|aufschneiden|in scheiben|umfüllen|herausnehmen|entnehmen)\b/i;

export function suggestForStep(text: string): TmSuggestion[] {
  if (!text || findSettings(text).length) return [];
  if (NOT_TM.test(text) && !/mixtopf/i.test(text)) return [];
  for (const r of RULES) {
    if (r.test.test(text) && (!r.also || r.also.test(text))) {
      return [{ setting: r.setting(text), reason: r.reason, source: 'regel', accessories: r.accessories }];
    }
  }
  return [];
}
