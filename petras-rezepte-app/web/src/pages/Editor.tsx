import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Save, Heart, Copy, Download, Trash2, Send, ChevronUp, ChevronDown, Plus, Scissors, X, Check, Pencil,
  ImagePlus, AlertTriangle, Sparkles, Hourglass, ListPlus, CheckCheck, Info, Type,
} from 'lucide-react';
import {
  ACCESSORIES, CATEGORIES, DIFFICULTIES, emptyRecipe,
  type Accessory, type Ingredient, type Recipe, type Step, type TmSetting,
} from '../../../shared/model.ts';
import { findSettings, findRestMinutes, insertSetting, replaceSetting } from '../../../shared/tm.ts';
import { checkIngredient, formatAmount, formatIngredient, KNOWN_UNITS, parseAmount, parseIngredient } from '../../../shared/ingredients.ts';
import { detectAccessories, makeStep } from '../../../shared/parser.ts';
import { validateRecipe } from '../../../shared/validate.ts';
import { Api, downloadExport } from '../lib/api.ts';
import { resizePhoto } from '../lib/importers.ts';
import { go } from '../lib/router.ts';
import { RecipeVisual, TmPill, CookidooBadge, fmtMin } from '../components/recipe-bits.tsx';
import { SettingEditor } from '../components/SettingEditor.tsx';
import { Empty, ProgressOverlay, useConfirm, useToast } from '../components/ui.tsx';

type EditTarget = { step: number; match: number | null; initial: TmSetting | null; suggestion?: number } | null;

function withStepText(s: Step, text: string): Step {
  const hasOwn = findSettings(text).length > 0;
  const acc = new Set<Accessory>([...s.accessories, ...detectAccessories(text)]);
  return { ...s, text, accessories: [...acc], restMinutes: hasOwn ? null : findRestMinutes(text), suggestions: hasOwn ? [] : s.suggestions };
}

function AutoText({ value, onChange, className, placeholder, onKeyDown, taRef }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>; taRef?: (el: HTMLTextAreaElement | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { const t = ref.current; if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; } }, [value]);
  return <textarea ref={(el) => { ref.current = el; taRef?.(el); }} rows={1} value={value} placeholder={placeholder} onKeyDown={onKeyDown}
    onChange={(e) => onChange(e.target.value)} className={`w-full resize-none overflow-hidden ${className ?? ''}`} />;
}

export function Editor({ id }: { id: number | null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [r, setR] = useState<Recipe | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [draftAt, setDraftAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<EditTarget>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [ingText, setIngText] = useState<string | null>(null);
  const [restoreOffer, setRestoreOffer] = useState<Recipe | null>(null);
  const [notFound, setNotFound] = useState(false);
  const stepRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const photoRef = useRef<HTMLInputElement>(null);

  // ---------- Laden ----------
  useEffect(() => {
    (async () => {
      try {
        const draft = await Api.draft().catch(() => null);
        if (id) {
          const rec = await Api.get(id);
          setR(rec); setSavedAt(rec.updatedAt ?? null);
          if (draft?.data?.editingId === id && draft.data.recipe && draft.updatedAt > (rec.updatedAt ?? '')) setRestoreOffer(draft.data.recipe);
        } else {
          if (draft?.data?.editingId) { go(`rezept/${draft.data.editingId}`); return; }
          const rec: Recipe = draft?.data?.recipe ?? { ...emptyRecipe(), ingredients: [parseIngredient('')], steps: [makeStep('')] };
          setR(rec); setNotes(draft?.data?.notes ?? []); setDraftAt(draft?.updatedAt ?? null);
          if (rec.title) {
            const d = await Api.duplicates(rec).catch(() => []);
            if (d.length) toast(`Ähnliches Rezept schon vorhanden: „${d[0].title}“`, 'info');
          }
        }
      } catch (e: any) {
        if (e.status === 404) setNotFound(true); else toast(e.message, 'fehler');
      }
    })();
  }, [id]);

  // ---------- Ändern + automatische Zwischenspeicherung ----------
  const update = useCallback((fn: (r: Recipe) => Recipe) => { setR((o) => (o ? fn(o) : o)); setDirty(true); }, []);
  useEffect(() => {
    if (!r || !dirty) return;
    const t = setTimeout(() => {
      Api.saveDraft({ recipe: r, notes, editingId: id }).then(() => setDraftAt(new Date().toISOString())).catch(() => {});
    }, 1000);
    return () => clearTimeout(t);
  }, [r, dirty]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const issues = useMemo(() => (r ? validateRecipe(r) : []), [r]);
  const suggestionCount = r?.steps.reduce((n, s) => n + s.suggestions.length, 0) ?? 0;

  if (notFound) return <Empty icon={<Info />} title="Rezept nicht gefunden" text="Vielleicht wurde es gelöscht – schau im Papierkorb unter Einstellungen." action={<button className="btn-primary" onClick={() => go('rezepte')}>Zu meinen Rezepten</button>} />;
  if (!r) return <ProgressOverlay label="Rezept wird geladen …" value={null} />;

  const set = <K extends keyof Recipe>(k: K, v: Recipe[K]) => update((o) => ({ ...o, [k]: v }));
  const setIng = (i: number, p: Partial<Ingredient>) => update((o) => ({ ...o, ingredients: o.ingredients.map((x, j) => (j === i ? { ...x, ...p } : x)) }));
  const setStep = (i: number, s: Step) => update((o) => ({ ...o, steps: o.steps.map((x, j) => (j === i ? s : x)) }));
  const move = <T,>(arr: T[], i: number, d: number) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };
  const groups = [...new Set(r.ingredients.map((i) => i.group).filter(Boolean))];

  // ---------- Speichern ----------
  async function save(): Promise<Recipe | null> {
    if (!r) return null;
    const errors = issues.filter((i) => i.level === 'fehler');
    if (errors.length) { toast(errors[0].message, 'fehler'); return null; }
    const clean: Recipe = {
      ...r,
      ingredients: r.ingredients.filter((i) => i.name.trim() || i.amount != null),
      steps: r.steps.filter((s) => s.text.trim()),
    };
    if (!clean.id) {
      const d = await Api.duplicates(clean).catch(() => []);
      if (d.length && !(await confirm({ title: 'Rezept schon vorhanden?', ok: 'Trotzdem speichern', text: <>Es gibt bereits {d.length === 1 ? 'ein Rezept' : `${d.length} Rezepte`} mit diesem Namen: <b>„{d[0].title}“</b>. Möchtest du es trotzdem als neues Rezept speichern?</> }))) return null;
    }
    setBusy(true);
    try {
      const saved = clean.id ? await Api.update(clean) : await Api.create(clean);
      await Api.clearDraft().catch(() => {});
      setR(saved); setDirty(false); setSavedAt(saved.updatedAt ?? null); setDraftAt(null);
      toast('Rezept gespeichert');
      if (!id && saved.id) { history.replaceState(null, '', `#/rezept/${saved.id}`); window.dispatchEvent(new HashChangeEvent('hashchange')); }
      return saved;
    } catch (e: any) { toast(e.message, 'fehler'); return null; } finally { setBusy(false); }
  }

  async function discard() {
    if (!(await confirm({ title: 'Änderungen verwerfen?', text: 'Die nicht gespeicherten Änderungen gehen verloren.', ok: 'Verwerfen', danger: true }))) return;
    await Api.clearDraft().catch(() => {});
    setDirty(false);
    go(id ? 'rezepte' : 'importieren');
  }

  async function remove() {
    if (!r?.id) return;
    if (!(await confirm({ title: 'Rezept löschen?', text: <>„{r.title}“ kommt in den Papierkorb und kann 30 Tage lang wiederhergestellt werden.</>, ok: 'In den Papierkorb', danger: true }))) return;
    await Api.remove(r.id); await Api.clearDraft().catch(() => {});
    setDirty(false); toast('In den Papierkorb verschoben'); go('rezepte');
  }

  // ---------- Thermomix-Einstellungen ----------
  function saveSetting(s: TmSetting) {
    if (!edit || !r) return;
    const step = r.steps[edit.step];
    let text: string;
    if (edit.match != null) text = replaceSetting(step.text, findSettings(step.text)[edit.match], s);
    else text = insertSetting(step.text, s);
    const next = withStepText(step, text);
    if (edit.suggestion != null) next.suggestions = [];
    setStep(edit.step, next); setEdit(null);
  }
  function removeSetting() {
    if (!edit || edit.match == null || !r) return;
    const step = r.steps[edit.step];
    const m = findSettings(step.text)[edit.match];
    setStep(edit.step, withStepText(step, (step.text.slice(0, m.offset) + step.text.slice(m.offset + m.length)).replace(/\s+([.,])/g, '$1').replace(/\s{2,}/g, ' ').trim()));
    setEdit(null);
  }
  function acceptSuggestion(i: number, k = 0) {
    const step = r!.steps[i];
    const sug = step.suggestions[k];
    const next = withStepText(step, insertSetting(step.text, sug.setting));
    next.suggestions = [];
    next.accessories = [...new Set([...next.accessories, ...(sug.accessories ?? [])])];
    setStep(i, next);
  }
  function acceptAll() {
    update((o) => ({ ...o, steps: o.steps.map((s) => {
      if (!s.suggestions.length) return s;
      const n = withStepText(s, insertSetting(s.text, s.suggestions[0].setting));
      return { ...n, suggestions: [], accessories: [...new Set([...n.accessories, ...(s.suggestions[0].accessories ?? [])])] };
    }) }));
    toast('Alle Vorschläge übernommen – bitte kurz prüfen');
  }

  async function onPhoto(f?: File | null) {
    if (!f) return;
    try { set('photo', await resizePhoto(f)); } catch { toast('Das Bild konnte nicht geladen werden.', 'fehler'); }
  }

  const totalCalc = (r.prepTime ?? 0) + (r.cookTime ?? 0) + (r.restTime ?? 0);
  const numberInput = (k: 'servings' | 'prepTime' | 'cookTime' | 'restTime' | 'totalTime', label: string, unit: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <input className="input text-center font-semibold" type="number" min={0} inputMode="numeric" value={r[k] ?? ''} placeholder="–"
          onChange={(e) => set(k, e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))))} />
        <span className="shrink-0 text-sm text-ink-soft">{unit}</span>
      </div>
    </label>
  );

  return (
    <div className="pb-28">
      {/* Kopfzeile */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button className="btn-ghost btn-sm" onClick={() => go(id ? 'rezepte' : 'importieren')}><ArrowLeft size={18} /> Zurück</button>
        <span className="text-ink-soft">{id ? 'Rezept bearbeiten' : 'Neues Rezept prüfen'}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {r.id && <>
            <button className={`btn-ghost btn-sm ${r.favorite ? 'text-apricot-500' : ''}`} onClick={async () => { await Api.favorite(r.id!, !r.favorite); setR({ ...r, favorite: !r.favorite }); }}>
              <Heart size={18} fill={r.favorite ? 'currentColor' : 'none'} /> {r.favorite ? 'Favorit' : 'Merken'}</button>
            <button className="btn-ghost btn-sm" onClick={async () => { const c = await Api.duplicate(r.id!); toast('Kopie erstellt'); go(`rezept/${c.id}`); }}><Copy size={18} /> Duplizieren</button>
            <button className="btn-ghost btn-sm" onClick={() => downloadExport([r.id!])}><Download size={18} /> Exportieren</button>
            <button className="btn-ghost btn-sm text-red-700" onClick={remove}><Trash2 size={18} /> Löschen</button>
          </>}
        </div>
      </div>

      {restoreOffer && (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 border-apricot-300 bg-apricot-100/60 p-4">
          <span><b>Es gibt nicht gespeicherte Änderungen</b> an diesem Rezept (automatisch zwischengespeichert).</span>
          <div className="flex gap-2">
            <button className="btn-ghost btn-sm" onClick={() => { setRestoreOffer(null); Api.clearDraft(); }}>Verwerfen</button>
            <button className="btn-accent btn-sm" onClick={() => { setR(restoreOffer); setDirty(true); setRestoreOffer(null); }}>Wiederherstellen</button>
          </div>
        </div>
      )}

      {/* Prüfhinweise */}
      {(!id || issues.length > 0 || notes.length > 0) && (
        <div className="card mb-6 border-sage-300 bg-sage-50/60 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Info className="text-sage-700" />
            <div className="flex-1">
              <b>{id ? 'Hinweise zum Rezept' : 'Bitte kurz prüfen'}</b>
              <p className="text-sm text-ink-soft">
                {r.source?.name && <>Gelesen aus: {r.source.name}{r.source.type === 'ocr' ? ' (Texterkennung – bitte genau prüfen)' : ''}. </>}
                {issues.length ? `${issues.length} Hinweis${issues.length > 1 ? 'e' : ''}` : 'Alles plausibel'}
                {suggestionCount ? ` · ${suggestionCount} Thermomix-Vorschl${suggestionCount > 1 ? 'äge' : 'ag'} zum Bestätigen` : ''}
              </p>
            </div>
            {r.altSteps && (
              <button className="btn-ghost btn-sm" title="Zwischen den beiden Schritt-Fassungen wechseln" onClick={() => update((o) => ({
                ...o, steps: o.altSteps!.steps,
                altSteps: { label: /Original/.test(o.altSteps!.label) ? 'Schritte aus dem Kochmodus' : 'Originaltext der Seite', steps: o.steps },
              }))}>⇄ {/Original/.test(r.altSteps.label) ? 'Originaltext verwenden' : 'Kochmodus-Schritte verwenden'}</button>
            )}
            {(issues.length > 0 || notes.length > 0) && <button className="btn-soft btn-sm" onClick={() => setShowIssues(!showIssues)}>{showIssues ? 'Ausblenden' : 'Anzeigen'}</button>}
          </div>
          {showIssues && (
            <ul className="mt-3 space-y-1 pl-9 text-sm">
              {notes.map((n) => <li key={n} className="flex gap-2"><Sparkles size={15} className="mt-0.5 shrink-0 text-apricot-500" />KI: {n}</li>)}
              {issues.map((i, k) => <li key={k} className={`flex gap-2 ${i.level === 'fehler' ? 'text-red-700' : 'text-ink'}`}><AlertTriangle size={15} className="mt-0.5 shrink-0 text-apricot-500" />{i.message}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Rezeptinformationen */}
      <section className="card mb-6 overflow-hidden">
        <div className="grid md:grid-cols-[320px_1fr]">
          <div className="relative">
            <RecipeVisual category={r.category} photo={r.photo ? (r.photo.startsWith('data:') ? r.photo : `/api/recipes/${r.id}/photo?v=${r.updatedAt}`) : null} className="h-full min-h-56 w-full" />
            <div className="absolute bottom-3 left-3 flex gap-2">
              <button className="btn-sm btn bg-white/90 text-ink shadow hover:bg-white" onClick={() => photoRef.current?.click()}><ImagePlus size={16} /> {r.photo ? 'Foto ändern' : 'Foto hinzufügen'}</button>
              {r.photo && <button className="btn-sm btn bg-white/90 text-ink shadow hover:bg-white" onClick={() => set('photo', null)} aria-label="Foto entfernen"><X size={16} /></button>}
            </div>
            <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
          </div>
          <div className="space-y-5 p-6 md:p-8">
            <input className="w-full border-b-2 border-transparent bg-transparent pb-1 text-[30px] font-bold leading-tight outline-none placeholder:text-ink-faint focus:border-sage-500"
              value={r.title} onChange={(e) => set('title', e.target.value)} placeholder="Name des Rezepts" aria-label="Rezeptname" />
            <textarea className="input min-h-20 resize-y" value={r.description} onChange={(e) => set('description', e.target.value)} placeholder="Kurze Beschreibung (optional)" aria-label="Beschreibung" />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="label">Kategorie</span>
                <select className="input" value={r.category} onChange={(e) => set('category', e.target.value as Recipe['category'])}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select></label>
              <div><span className="label">Schwierigkeit</span>
                <div className="flex gap-1.5">{DIFFICULTIES.map((d) => (
                  <button key={d} type="button" onClick={() => set('difficulty', r.difficulty === d ? null : d)}
                    className={`flex-1 rounded-2xl px-3 py-3 text-[15px] font-semibold capitalize transition ${r.difficulty === d ? 'bg-sage-600 text-white' : 'bg-cream-200 hover:bg-cream-300'}`}>{d}</button>
                ))}</div></div>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <div className="col-span-2 lg:col-span-1">
                {numberInput('servings', 'Portionen', '')}
                <input className="mt-1 w-full bg-transparent text-center text-sm text-ink-soft outline-none" value={r.servingsUnit} onChange={(e) => set('servingsUnit', e.target.value)} aria-label="Einheit der Portionen" />
              </div>
              {numberInput('prepTime', 'Arbeitszeit', 'Min.')}
              {numberInput('cookTime', 'Koch-/Backzeit', 'Min.')}
              {numberInput('restTime', 'Ruhe-/Gehzeit', 'Min.')}
              <div>
                {numberInput('totalTime', 'Gesamtzeit', 'Min.')}
                {totalCalc > 0 && r.totalTime !== totalCalc && <button className="mt-1 text-xs font-semibold text-sage-700 hover:underline" onClick={() => set('totalTime', totalCalc)}>= {fmtMin(totalCalc)} übernehmen</button>}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 2xl:grid-cols-[minmax(440px,5fr)_7fr]">
        {/* Zutaten */}
        <section className="card self-start p-6 2xl:sticky 2xl:top-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-2xl font-bold">Zutaten <span className="chip ml-1 bg-cream-200 text-sm text-ink-soft">{r.ingredients.filter((i) => i.name).length}</span></h2>
            <button className="btn-ghost btn-sm" onClick={() => setIngText(ingText == null ? r.ingredients.map((i) => (i.group ? `${i.group}: ` : '') + formatIngredient(i)).join('\n') : null)}>
              <Type size={16} /> {ingText == null ? 'Als Text' : 'Als Liste'}
            </button>
          </div>

          {ingText != null ? (
            <div>
              <textarea className="input min-h-72 font-mono text-sm" value={ingText} onChange={(e) => setIngText(e.target.value)} />
              <p className="mt-2 text-xs text-ink-soft">Eine Zutat pro Zeile. Gruppe mit „Gruppe: …“ voranstellen.</p>
              <button className="btn-primary btn-sm mt-3" onClick={() => {
                const list = ingText.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
                  const m = l.match(/^(Für [^:]+|[^:\d]{2,30}):\s+(.+)$/);
                  return m ? parseIngredient(m[2], m[1]) : parseIngredient(l);
                });
                set('ingredients', list); setIngText(null);
              }}><Check size={16} /> Übernehmen</button>
            </div>
          ) : (
            <>
              <div className="mb-1 hidden grid-cols-[72px_100px_1fr_32px] gap-2 px-1 text-xs font-medium text-ink-faint sm:grid"><span>Menge</span><span>Einheit</span><span>Zutat · Zusatz</span></div>
              <datalist id="units">{KNOWN_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
              <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
              <ul className="space-y-1">
                {r.ingredients.map((ing, i) => {
                  const w = ing.name || ing.amount != null ? checkIngredient(ing) : [];
                  const showGroup = ing.group && ing.group !== r.ingredients[i - 1]?.group;
                  return (
                    <li key={ing.id}>
                      {showGroup && <p className="mt-3 mb-1 text-sm font-bold uppercase tracking-wide text-sage-700">{ing.group}</p>}
                      <div className="group grid grid-cols-[72px_100px_1fr_auto] items-start gap-2 rounded-2xl p-1 hover:bg-cream-200/50">
                        <input className="input px-2 py-2 text-center" value={ing.amount != null ? (ing.amountMax != null && ing.amountMax !== ing.amount ? `${formatAmount(ing.amount)}-${formatAmount(ing.amountMax)}` : formatAmount(ing.amount)) : ''}
                          onChange={(e) => { const [a, b] = e.target.value.split(/\s*[-–]\s*/); setIng(i, { amount: a?.trim() ? parseAmount(a) : null, amountMax: b?.trim() ? parseAmount(b) : null }); }}
                          placeholder="–" aria-label="Menge" />
                        <input className="input px-2 py-2" list="units" value={ing.unit} onChange={(e) => setIng(i, { unit: e.target.value })} placeholder="" aria-label="Einheit" />
                        <div className="min-w-0">
                          <input className="input py-2" value={ing.name} onChange={(e) => setIng(i, { name: e.target.value })} placeholder="Zutat" aria-label="Zutat"
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); update((o) => { const a = [...o.ingredients]; a.splice(i + 1, 0, { ...parseIngredient(''), group: ing.group }); return { ...o, ingredients: a }; }); } }} />
                          <div className="mt-1 hidden gap-2 group-focus-within:flex">
                            <input className="input py-1.5 text-sm" value={ing.note} onChange={(e) => setIng(i, { note: e.target.value })} placeholder="Zusatz, z. B. gewürfelt" aria-label="Zusatz" />
                            <input className="input py-1.5 text-sm" list="groups" value={ing.group} onChange={(e) => setIng(i, { group: e.target.value })} placeholder="Gruppe (optional)" aria-label="Gruppe" />
                          </div>
                          {ing.note && <p className="mt-0.5 px-1 text-sm text-ink-soft group-focus-within:hidden">{ing.note}</p>}
                          {w.length > 0 && <p className="mt-0.5 flex items-center gap-1 px-1 text-xs text-apricot-700"><AlertTriangle size={12} />{w.join(' · ')}</p>}
                        </div>
                        <div className="flex items-center pt-1 opacity-40 transition group-hover:opacity-100 group-focus-within:opacity-100">
                          <button className="rounded-lg p-1 hover:bg-cream-300" onClick={() => set('ingredients', move(r.ingredients, i, -1))} aria-label="nach oben"><ChevronUp size={16} /></button>
                          <button className="rounded-lg p-1 hover:bg-red-50 hover:text-red-700" onClick={() => set('ingredients', r.ingredients.filter((_, j) => j !== i))} aria-label="Zutat löschen"><X size={16} /></button>
                          <button className="rounded-lg p-1 hover:bg-cream-300" onClick={() => set('ingredients', move(r.ingredients, i, 1))} aria-label="nach unten"><ChevronDown size={16} /></button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex gap-2">
                <button className="btn-soft btn-sm flex-1" onClick={() => set('ingredients', [...r.ingredients, { ...parseIngredient(''), group: r.ingredients.at(-1)?.group ?? '' }])}><Plus size={16} /> Zutat</button>
                <button className="btn-ghost btn-sm" onClick={() => { const g = prompt('Name der Gruppe, z. B. „Für den Teig“'); if (g?.trim()) set('ingredients', [...r.ingredients, { ...parseIngredient(''), group: g.trim() }]); }}><ListPlus size={16} /> Gruppe</button>
              </div>
            </>
          )}
        </section>

        {/* Zubereitung */}
        <section className="card p-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-2xl font-bold">Zubereitung <span className="chip ml-1 bg-cream-200 text-sm text-ink-soft">{r.steps.filter((s) => s.text).length}</span></h2>
            {suggestionCount > 0 && <button className="btn-soft btn-sm" onClick={acceptAll}><CheckCheck size={16} /> Alle {suggestionCount} Vorschläge übernehmen</button>}
          </div>
          <p className="mb-5 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <TmPill s={{ mode: 'manual', time: 180, temp: 120, speed: '1' }} /> = steht im Rezept ·
            <TmPill s={{ mode: 'manual', time: 120, temp: 37, speed: '2' }} suggestion /> = Vorschlag der App (bitte bestätigen)
          </p>

          <ol className="space-y-4">
            {r.steps.map((s, i) => {
              const ops = findSettings(s.text);
              return (
                <li key={s.id} className="group relative rounded-3xl border border-cream-300 bg-white p-4 pl-16 transition focus-within:border-sage-300 focus-within:ring-4 focus-within:ring-sage-50">
                  <span className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-sage-50 font-bold text-sage-700">{i + 1}</span>
                  <AutoText value={s.text} onChange={(v) => setStep(i, withStepText(s, v))} taRef={(el) => { stepRefs.current[i] = el; }}
                    className="rounded-xl bg-transparent px-2 py-1.5 text-[17px] leading-relaxed outline-none" placeholder="Arbeitsschritt beschreiben …" />

                  <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
                    {ops.map((o, k) => <TmPill key={k} s={o} warn={o.warnings.length > 0} title={o.warnings.join(' · ') || 'Zum Ändern klicken'} onClick={() => setEdit({ step: i, match: k, initial: o })} />)}
                    <button className="rounded-xl border border-dashed border-cream-300 px-3 py-1.5 text-sm font-medium text-ink-soft hover:border-sage-500 hover:text-sage-700"
                      onClick={() => setEdit({ step: i, match: null, initial: null })}><Plus size={14} className="-mt-0.5 inline" /> Einstellung</button>
                    {s.restMinutes ? <span className="chip bg-apricot-100 text-apricot-700"><Hourglass size={14} /> {fmtMin(s.restMinutes)} warten</span> : null}
                    {(s.ingredients ?? []).map((ing) => (
                      <span key={ing} title={s.text.includes(ing) ? 'Wird in Cookidoo als Zutat dieses Schritts markiert (Anzeige mit Menge am TM6)' : 'Steht nicht mehr wörtlich im Text – wird nicht markiert'}
                        className={`chip ${s.text.includes(ing) ? 'bg-sage-50 text-sage-700' : 'bg-cream-200 text-ink-faint line-through'}`}>⚖ {ing}</span>
                    ))}
                    {s.accessories.map((a) => (
                      <button key={a} className="chip bg-cream-200 text-ink hover:bg-red-50 hover:text-red-700" title="Entfernen"
                        onClick={() => setStep(i, { ...s, accessories: s.accessories.filter((x) => x !== a) })}>{ACCESSORIES[a]} <X size={12} /></button>
                    ))}
                    <select className="rounded-xl bg-transparent px-2 py-1 text-sm text-ink-faint hover:text-ink" value="" aria-label="Zubehör hinzufügen"
                      onChange={(e) => { const a = e.target.value as Accessory; if (a) setStep(i, { ...s, accessories: [...new Set([...s.accessories, a])] }); }}>
                      <option value="">+ Zubehör</option>
                      {(Object.keys(ACCESSORIES) as Accessory[]).filter((a) => !s.accessories.includes(a)).map((a) => <option key={a} value={a}>{ACCESSORIES[a]}</option>)}
                    </select>
                  </div>

                  {s.suggestions.map((sug, k) => (
                    <div key={k} className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-sage-50 p-3">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-sage-700"><Sparkles size={16} /> Vorschlag{sug.source === 'ki' ? ' der KI' : ''}:</span>
                      <TmPill s={sug.setting} suggestion />
                      <span className="text-sm text-ink-soft">{sug.reason}</span>
                      <div className="ml-auto flex gap-1.5">
                        <button className="btn-primary btn-sm" onClick={() => acceptSuggestion(i, k)}><Check size={16} /> Übernehmen</button>
                        <button className="btn-ghost btn-sm" onClick={() => setEdit({ step: i, match: null, initial: sug.setting, suggestion: k })}><Pencil size={15} /> Anpassen</button>
                        <button className="btn-ghost btn-sm" onClick={() => setStep(i, { ...s, suggestions: s.suggestions.filter((_, j) => j !== k) })} aria-label="Vorschlag verwerfen"><X size={16} /></button>
                      </div>
                    </div>
                  ))}

                  <div className="absolute right-3 top-3 flex gap-0.5 rounded-xl bg-white/90 opacity-0 shadow-sm transition group-hover:opacity-100 group-focus-within:opacity-100">
                    <button className="rounded-lg p-1.5 hover:bg-cream-200" title="Nach oben" onClick={() => set('steps', move(r.steps, i, -1))}><ChevronUp size={17} /></button>
                    <button className="rounded-lg p-1.5 hover:bg-cream-200" title="Nach unten" onClick={() => set('steps', move(r.steps, i, 1))}><ChevronDown size={17} /></button>
                    <button className="rounded-lg p-1.5 hover:bg-cream-200" title="An der Cursorposition teilen" onClick={() => {
                      const el = stepRefs.current[i]; const pos = el?.selectionStart ?? 0;
                      if (!pos || pos >= s.text.length) { toast('Zuerst in den Text klicken, wo geteilt werden soll.', 'info'); return; }
                      update((o) => { const a = [...o.steps]; a.splice(i, 1, withStepText(s, s.text.slice(0, pos).trim()), makeStep(s.text.slice(pos).trim())); return { ...o, steps: a }; });
                    }}><Scissors size={17} /></button>
                    <button className="rounded-lg p-1.5 hover:bg-cream-200" title="Schritt darunter einfügen" onClick={() => update((o) => { const a = [...o.steps]; a.splice(i + 1, 0, makeStep('')); return { ...o, steps: a }; })}><Plus size={17} /></button>
                    <button className="rounded-lg p-1.5 hover:bg-red-50 hover:text-red-700" title="Schritt löschen" onClick={() => set('steps', r.steps.filter((_, j) => j !== i))}><Trash2 size={17} /></button>
                  </div>
                </li>
              );
            })}
          </ol>
          <button className="btn-soft mt-4 w-full" onClick={() => set('steps', [...r.steps, makeStep('')])}><Plus size={18} /> Schritt hinzufügen</button>
        </section>
      </div>

      <section className="card mt-6 p-6">
        <h2 className="mb-3 text-2xl font-bold">Eigene Notizen</h2>
        <textarea className="input min-h-28 resize-y" value={r.notes} onChange={(e) => set('notes', e.target.value)} placeholder="z. B. „Nur 60 g Zucker – reicht völlig“ oder „Kinder lieben es mit Käse“" />
      </section>

      {/* Aktionsleiste */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-cream-300 bg-cream-50/95 backdrop-blur lg:left-[272px]">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 px-6 py-3 lg:px-10">
          <div className="text-sm text-ink-soft">
            {dirty ? (draftAt ? <>✓ Automatisch zwischengespeichert · <b className="text-apricot-700">noch nicht gespeichert</b></> : 'Ungespeicherte Änderungen')
              : savedAt ? <>Gespeichert · {new Date(savedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</> : 'Neues Rezept'}
            {r.id && <span className="ml-3 align-middle"><CookidooBadge status={r.cookidoo?.status ?? 'offen'} /></span>}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {(dirty || !id) && <button className="btn-ghost" onClick={discard}>Verwerfen</button>}
            <button className="btn-primary" disabled={busy} onClick={save}><Save size={18} /> Speichern</button>
            <button className="btn-accent" disabled={busy} onClick={async () => { const s = dirty || !r.id ? await save() : r; if (s?.id) go(`cookidoo/${s.id}`); }}>
              <Send size={18} /> Speichern & zu Cookidoo
            </button>
          </div>
        </div>
      </div>

      <SettingEditor open={!!edit} initial={edit?.initial ?? null} onClose={() => setEdit(null)} onSave={saveSetting}
        onDelete={edit?.match != null ? removeSetting : undefined}
        title={edit?.match != null ? 'Einstellung ändern' : edit?.suggestion != null ? 'Vorschlag anpassen' : 'Einstellung hinzufügen'} />
      {busy && <ProgressOverlay label="Wird gespeichert …" value={null} />}
    </div>
  );
}
