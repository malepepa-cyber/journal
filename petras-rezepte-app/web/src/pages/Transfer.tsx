/**
 * Cookidoo übertragen.
 * Standard: geführter Assistent (vollständig mit den Cookidoo-Nutzungsbedingungen vereinbar).
 * Optional: experimentelle Schnellübertragung per Lesezeichen (nur wenn in den Einstellungen eingeschaltet).
 */
import { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink, Columns2, ListChecks, ArrowLeft, ArrowRight, Send, Bot, Hand, AlertTriangle, PartyPopper, Pencil, CheckCircle2, Wand, Bookmark } from 'lucide-react';
import { ACCESSORIES, type Recipe, type RecipeSummary } from '../../../shared/model.ts';
import { findSettings, describeSetting, formatSeconds } from '../../../shared/tm.ts';
import { formatIngredient } from '../../../shared/ingredients.ts';
import { stepText } from '../../../shared/cookidoo.ts';
import { Api } from '../lib/api.ts';
import { go } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { markGuide } from './ImportPage.tsx';
import { CookidooBadge, RecipeVisual, fmtMin } from '../components/recipe-bits.tsx';
import { Empty, PageHeader, useToast } from '../components/ui.tsx';

export const TRANSFER_MARK = 'PETRAS-REZEPTE-APP:';

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fallback */ }
  const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* egal */ }
  ta.remove(); return ok;
}

function CopyButton({ text, label = 'Kopieren', big, onCopied }: { text: string; label?: string; big?: boolean; onCopied?: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <button className={`${big ? 'btn-primary' : 'btn-soft btn-sm'} shrink-0`} onClick={async () => { if (await copyText(text)) { setDone(true); onCopied?.(); setTimeout(() => setDone(false), 1800); } }}>
      {done ? <><Check size={16} /> Kopiert</> : <><Copy size={16} /> {label}</>}
    </button>
  );
}

/** Abhaken: zeigt, ob ein Feld schon in Cookidoo eingetragen ist */
function Tick({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button onClick={() => onChange(!on)} aria-pressed={on} aria-label={`${label}: ${on ? 'übertragen' : 'noch offen'}`} title={on ? 'Übertragen – zum Zurücksetzen klicken' : 'Als übertragen abhaken'}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 transition ${on ? 'border-sage-600 bg-sage-600 text-white' : 'border-cream-300 bg-white text-transparent hover:border-sage-400 hover:text-sage-300'}`}>
      <Check size={18} strokeWidth={3} />
    </button>
  );
}

function Row({ label, value, done, onDone }: { label: string; value: string; done?: boolean; onDone?: (v: boolean) => void }) {
  return (
    <div className={`flex items-center gap-4 rounded-2xl p-4 ${done ? 'bg-sage-50' : 'bg-cream-100'}`}>
      {onDone && <Tick on={!!done} onChange={onDone} label={label} />}
      <div className="min-w-0 flex-1"><span className="label mb-0.5">{label}</span><div className="whitespace-pre-line text-lg font-semibold">{value || '—'}</div></div>
      {value && <CopyButton text={value} onCopied={() => onDone?.(true)} />}
    </div>
  );
}

/** Cookidoo in einem zweiten Fenster rechts daneben öffnen – die App rückt nach links (kein Fenstersuchen). */
function openSideBySide(url: string): boolean {
  const W = screen.availWidth, H = screen.availHeight, L = (screen as any).availLeft ?? 0, T = (screen as any).availTop ?? 0;
  const half = Math.floor(W / 2);
  try { window.moveTo(L, T); window.resizeTo(half, H); } catch { /* Browser erlaubt es evtl. nicht */ }
  const w = window.open(url, 'pra-cookidoo', `popup=yes,left=${L + half},top=${T},width=${W - half},height=${H}`);
  try { w?.focus(); } catch { /* egal */ }
  return !!w;
}

/** Thermomix-Display: zeigt die Werte so, wie man sie im Cookidoo-Editor auswählt */
function TmDisplay({ text }: { text: string }) {
  const ops = findSettings(text);
  if (!ops.length) return <p className="rounded-2xl bg-cream-100 p-4 text-ink-soft">Keine Thermomix-Einstellung in diesem Schritt.</p>;
  return (
    <div className="space-y-3">
      {ops.map((o, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-3xl bg-sage-900 p-4 text-white sm:grid-cols-4">
          {[
            { k: 'Modus', v: o.mode === 'manual' ? 'Manuell' : o.mode === 'dough' ? 'Teig kneten' : o.mode === 'turbo' ? 'Turbo' : o.mode === 'browning' ? 'Anbraten' : 'Dampfgaren' },
            { k: 'Zeit', v: o.mode === 'turbo' ? `${formatSeconds(o.time ?? 1)} × ${o.pulses ?? 1}` : formatSeconds(o.time) || '—' },
            { k: 'Temperatur', v: o.temp == null ? 'aus' : o.temp === 'Varoma' ? 'Varoma' : `${o.temp} °C` },
            { k: 'Stufe', v: o.speed == null ? '—' : o.speed === 'soft' ? '🥄 Sanft' : `${o.speed.replace('.', ',')}${o.reverse ? '  ↺' : ''}` },
          ].map((c) => (
            <div key={c.k} className="rounded-2xl bg-white/10 px-3 py-2">
              <div className="text-xs uppercase tracking-wider text-sage-100">{c.k}</div>
              <div className="text-xl font-bold tabular-nums">{c.v}</div>
            </div>
          ))}
          {o.reverse && <div className="col-span-full text-sm text-sage-100">↺ Linkslauf einschalten</div>}
        </div>
      ))}
    </div>
  );
}

const STEPS = ['Start', 'Name', 'Portionen & Zeiten', 'Zutaten', 'Arbeitsschritte', 'Fertig'];

export function Transfer({ id }: { id: number | null }) {
  const { session } = useSession();
  const toast = useToast();
  const [list, setList] = useState<RecipeSummary[] | null>(null);
  const [r, setR] = useState<Recipe | null>(null);
  const [step, setStep] = useState(0);
  const [k, setK] = useState(0);
  const settings = session?.settings;

  useEffect(() => {
    if (id) Api.get(id).then(setR).catch((e) => toast(e.message, 'fehler'));
    else Api.list({ sort: 'geändert' }).then(setList).catch((e) => toast(e.message, 'fehler'));
  }, [id]);

  // ---------- Übersicht ----------
  if (!id) {
    const open = list?.filter((x) => x.cookidooStatus !== 'übertragen') ?? [];
    const done = list?.filter((x) => x.cookidooStatus === 'übertragen') ?? [];
    return (
      <div>
        <PageHeader title="Cookidoo übertragen" subtitle="Wähle ein Rezept – der Assistent führt dich Schritt für Schritt bis in „Meine Kreationen“." />
        {list && !list.length ? <Empty icon={<Send />} title="Noch keine Rezepte" text="Importiere zuerst ein Rezept." action={<button className="btn-primary" onClick={() => go('importieren')}>Rezept importieren</button>} /> : (
          <div className="space-y-8">
            {[{ t: 'Noch zu übertragen', l: open }, { t: 'Bereits in Cookidoo', l: done }].filter((g) => g.l.length).map((g) => (
              <section key={g.t}>
                <h2 className="mb-3 text-xl font-bold">{g.t} <span className="text-ink-faint">({g.l.length})</span></h2>
                <div className="card divide-y divide-cream-300/70 overflow-hidden">
                  {g.l.map((x) => (
                    <button key={x.id} onClick={() => go(`cookidoo/${x.id}`)} className="flex w-full items-center gap-4 p-3 text-left hover:bg-cream-100">
                      <RecipeVisual category={x.category} photo={x.photo} className="h-14 w-14 shrink-0 rounded-2xl text-[0] [&_span]:text-2xl" />
                      <span className="min-w-0 flex-1"><b className="block truncate">{x.title}</b><span className="text-sm text-ink-soft">{x.category}</span></span>
                      <CookidooBadge status={x.cookidooStatus} /><ArrowRight className="text-ink-faint" />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (!r || !settings) return null;

  const steps = r.steps.filter((s) => s.text.trim());
  const pending = steps.filter((s) => s.suggestions.length).length;
  const ingredientsText = (() => {
    let g = ''; const out: string[] = [];
    for (const i of r.ingredients) { if (i.group && i.group !== g) { out.push(`${i.group}:`); g = i.group; } out.push(formatIngredient(i)); }
    return out.join('\n');
  })();

  const allStepsText = steps.map((s, i) => `${i + 1}. ${stepText(s)}`).join('\n\n');

  // ---------- Fortschritt je Feld (wird im Rezept gespeichert und synchronisiert) ----------
  const progress = r.cookidoo?.progress ?? {};
  const isDone = (key: string) => !!progress[key];
  const setDone = async (keys: string[], v: boolean) => {
    const next = { ...progress };
    for (const key of keys) { if (v) next[key] = true; else delete next[key]; }
    const status = r.cookidoo?.status === 'offen' && v ? 'in Arbeit' : null;
    setR({ ...r, cookidoo: { ...r.cookidoo, status: status ?? r.cookidoo.status, progress: next } });
    try { setR(await Api.cookidoo(r.id!, status, next)); } catch (e: any) { toast(e.message, 'fehler'); }
  };
  const checklist: { key: string; label: string; done: number; total: number; wizard: number; optional?: boolean }[] = [
    { key: 'name', label: 'Rezeptname', done: +isDone('name'), total: 1, wizard: 1 },
    ...(r.description ? [{ key: 'description', label: 'Beschreibung', done: +isDone('description'), total: 1, wizard: 1, optional: true }] : []),
    { key: 'times', label: 'Portionen & Zeiten', done: +isDone('times'), total: 1, wizard: 2 },
    { key: 'ing', label: 'Zutaten', done: r.ingredients.filter((i) => isDone(`ing:${i.id}`)).length, total: r.ingredients.length, wizard: 3 },
    { key: 'step', label: 'Arbeitsschritte', done: steps.filter((x) => isDone(`step:${x.id}`)).length, total: steps.length, wizard: 4 },
    ...(r.photo ? [{ key: 'photo', label: 'Foto (nur eigene Fotos)', done: +isDone('photo'), total: 1, wizard: 1, optional: true }] : []),
  ];
  const required = checklist.filter((c) => !c.optional);
  const doneCount = required.reduce((n, c) => n + c.done, 0);
  const totalCount = required.reduce((n, c) => n + c.total, 0) || 1;
  const percent = Math.round((doneCount / totalCount) * 100);

  const openCookidoo = async (side = false) => {
    if (!side || !openSideBySide(settings.cookidooUrl)) window.open(settings.cookidooUrl, '_blank', 'noopener');
    if (r.cookidoo?.status === 'offen') setR(await Api.cookidoo(r.id!, 'in Arbeit'));
  };
  const markDone = async () => { setR(await Api.cookidoo(r.id!, 'übertragen')); markGuide(5); toast('Als „In Cookidoo“ markiert'); };
  const startHelper = async () => {
    const ok = await copyText(TRANSFER_MARK + JSON.stringify({ v: 2, allowApi: settings.experimentalTransfer, recipe: { ...r, steps } }));
    if (!ok) { toast('Kopieren hat nicht geklappt.', 'fehler'); return; }
    await openCookidoo();
    toast('Cookidoo öffnet sich – dort auf das Lesezeichen „➜ Petras Rezepte“ klicken.', 'info');
    setStep(5);
  };

  return (
    <div className="pb-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button className="btn-ghost btn-sm" onClick={() => go('cookidoo')}><ArrowLeft size={18} /> Übersicht</button>
        <button className="btn-ghost btn-sm" onClick={() => go(`rezept/${r.id}`)}><Pencil size={16} /> Rezept bearbeiten</button>
        <span className="ml-auto"><CookidooBadge status={r.cookidoo?.status ?? 'offen'} /></span>
      </div>
      <h1 className="mb-6 text-[32px] font-bold leading-tight">„{r.title}“ nach Cookidoo übertragen</h1>

      {/* Fortschritt */}
      <ol className="mb-8 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li key={s}><button onClick={() => setStep(i)}
            className={`chip px-4 py-2 transition ${i === step ? 'bg-sage-600 text-white' : i < step ? 'bg-sage-50 text-sage-700' : 'bg-cream-200 text-ink-soft'}`}>
            {i < step ? <Check size={14} /> : <span className="font-bold">{i + 1}</span>} {s}</button></li>
        ))}
      </ol>

      {step > 0 && step < 5 && (
        <div className="card mb-5 p-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <ListChecks className="text-sage-700" />
            <b className="flex-1">Übertragen: {doneCount} von {totalCount} ({percent} %)</b>
            <button className="btn-soft btn-sm" onClick={() => openCookidoo(true)} title="Cookidoo rechts daneben öffnen – kein Fenstersuchen"><Columns2 size={16} /> Cookidoo nebenan öffnen</button>
          </div>
          <div className="mb-3 h-2.5 overflow-hidden rounded-full bg-cream-200" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-sage-600 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <ul className="flex flex-wrap gap-2 text-sm">
            {checklist.map((c) => (
              <li key={c.key}><button onClick={() => setStep(c.wizard)} className={`chip px-3 py-1.5 ${c.done >= c.total ? 'bg-sage-50 text-sage-700' : 'bg-apricot-100 text-apricot-700'}`}>
                {c.done >= c.total ? <Check size={14} /> : <AlertTriangle size={14} />} {c.label}{c.total > 1 ? ` ${c.done}/${c.total}` : ''}{c.done < c.total ? (c.optional ? ' · optional' : ' · fehlt') : ''}
              </button></li>
            ))}
          </ul>
        </div>
      )}

      <div className="card p-7">
        {step === 0 && (
          <div className="space-y-6">
            {pending > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-apricot-100 p-4 text-apricot-700">
                <AlertTriangle /> <span className="flex-1"><b>{pending} Schritt{pending > 1 ? 'e haben' : ' hat'} noch unbestätigte Vorschläge.</b> Unbestätigte Vorschläge werden nicht übertragen.</span>
                <button className="btn-ghost btn-sm bg-white" onClick={() => go(`rezept/${r.id}`)}>Jetzt prüfen</button>
              </div>
            )}

            <div className="rounded-3xl border-2 border-sage-300 bg-sage-50/60 p-6">
              <div className="mb-1 flex flex-wrap items-center gap-2"><Wand size={22} className="text-sage-700" /><h3 className="text-xl font-bold">Ausfüllhilfe</h3><span className="chip bg-sage-600 text-white">empfohlen</span></div>
              <p className="mb-4 text-ink-soft">Das Lesezeichen <b>„➜ Petras Rezepte“</b> trägt Name, Zutaten und Schritte mit Thermomix-Knöpfen direkt in den Cookidoo-Editor ein – über die normale Cookidoo-Oberfläche. Du prüfst und bestätigst.</p>
              <ol className="mb-5 space-y-2 text-[15px]">
                {[
                  ['Ausfüllhilfe starten', 'Rezept wird vorbereitet, Cookidoo öffnet sich bei „Meine Kreationen“.'],
                  ['Lesezeichen → „Rezept in Cookidoo anlegen“', 'Der Name wird in Cookidoos Dialog eingetragen.'],
                  ['Im Editor: Lesezeichen → „Weiter zu Zutaten & Rezeptschritte“', 'Portionen und Zeiten werden zum Eintragen angezeigt.'],
                  ['Lesezeichen → „Zutaten & Schritte eintragen“', 'Alles wird nacheinander eingetragen. Danach „Bestätigen“.'],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sage-600 text-sm font-bold text-white">{i + 1}</span><span><b>{t}</b><br /><span className="text-ink-soft">{d}</span></span></li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-3">
                <button className="btn-primary px-7 py-4 text-lg" onClick={startHelper}><Wand size={20} /> Ausfüllhilfe starten</button>
                <button className="btn-ghost" onClick={() => go('einstellungen')}><Bookmark size={18} /> Lesezeichen einrichten</button>
              </div>
            </div>

            <div className="rounded-3xl bg-cream-100 p-6">
              <h3 className="mb-1 text-lg font-bold">Oder Schritt für Schritt selbst eingeben</h3>
              <p className="mb-4 text-ink-soft">Ohne Lesezeichen: Der Assistent zeigt jeden Text zum Kopieren und die Thermomix-Werte groß an.</p>
              <div className="flex flex-wrap gap-3">
                <button className="btn-soft" onClick={async () => { await openCookidoo(true); setStep(1); }}><Columns2 size={18} /> Cookidoo nebenan öffnen & Assistent starten</button>
                <button className="btn-ghost" onClick={async () => { await openCookidoo(); setStep(1); }}><ExternalLink size={18} /> In neuem Tab</button>
                <button className="btn-ghost" onClick={() => setStep(1)}>Cookidoo ist schon offen</button>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl bg-sage-50 p-5 text-[15px]">
                <h3 className="mb-2 flex items-center gap-2 font-bold text-sage-700"><Bot size={20} /> Das erledigt die App</h3>
                <ul className="list-disc space-y-1 pl-5"><li>Rezept erkennen, prüfen, aufbereiten</li><li>Namen, Zutaten und Schritte eintragen (Ausfüllhilfe)</li><li>Thermomix-Knöpfe für Zeit · Temperatur · Stufe · Linkslauf</li></ul>
              </div>
              <div className="rounded-3xl bg-apricot-100/60 p-5 text-[15px]">
                <h3 className="mb-2 flex items-center gap-2 font-bold text-apricot-700"><Hand size={20} /> Das bestätigst du</h3>
                <ul className="list-disc space-y-1 pl-5"><li>Lesezeichen anklicken (3×)</li><li>Portionen & Zeiten eintragen</li><li>Teig/Turbo/Anbraten ggf. per „Koch-Einstellungen“ ergänzen</li><li>Ergebnis prüfen und „Bestätigen“</li></ul>
              </div>
            </div>
            <p className="text-sm text-ink-soft">Vorwerk bietet keine offizielle Schnittstelle. Die Ausfüllhilfe bedient nur die normale Cookidoo-Webseite in deinem angemeldeten Chrome – kein Passwort, kein fremder Server.</p>
            <button className="btn-ghost btn-sm" onClick={() => { markDone(); setStep(5); }}><Check size={16} /> Ist schon in Cookidoo – als übertragen markieren</button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Name des Rezepts</h2>
            <p className="text-ink-soft">In Cookidoo bei „Rezept erstellen“ den Namen einfügen.</p>
            <Row label="Rezeptname" value={r.title} done={isDone('name')} onDone={(v) => setDone(['name'], v)} />
            {r.description && <Row label="Beschreibung (optional)" value={r.description} done={isDone('description')} onDone={(v) => setDone(['description'], v)} />}
            {r.photo && (
              <div className={`flex items-center gap-4 rounded-2xl p-4 text-sm ${isDone('photo') ? 'bg-sage-50' : 'bg-cream-100'}`}>
                <Tick on={isDone('photo')} onChange={(v) => setDone(['photo'], v)} label="Foto" />
                <span className="flex-1 text-ink-soft">Foto: In Cookidoo kannst du ein eigenes Bild hochladen. Bitte nur eigene Fotos verwenden (Urheberrecht).</span>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Portionen & Zeiten</h2>
            <label className="flex items-center gap-3 font-semibold"><Tick on={isDone('times')} onChange={(v) => setDone(['times'], v)} label="Portionen & Zeiten" /> In Cookidoo eingetragen</label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Row label="Portionen" value={r.servings ? String(r.servings) : ''} />
              <Row label="Arbeitszeit (Min.)" value={r.prepTime ? String(r.prepTime) : ''} />
              <Row label="Gesamtzeit (Min.)" value={String(r.totalTime ?? ((r.prepTime ?? 0) + (r.cookTime ?? 0) + (r.restTime ?? 0) || ''))} />
              {r.restTime ? <Row label="davon Ruhe-/Gehzeit" value={fmtMin(r.restTime)} /> : null}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-bold">Zutaten ({r.ingredients.length})</h2>
              <CopyButton text={ingredientsText} label="Alle Zutaten kopieren" big onCopied={() => setDone(r.ingredients.map((i) => `ing:${i.id}`), true)} />
            </div>
            <p className="text-ink-soft">Jede Zutat steht in Cookidoo in einer eigenen Zeile. Einzeln kopieren oder alle auf einmal.</p>
            <ul className="space-y-2">
              {r.ingredients.map((i, n) => (
                <li key={i.id}>
                  {i.group && i.group !== r.ingredients[n - 1]?.group && <p className="mt-3 mb-1 text-sm font-bold uppercase tracking-wide text-sage-700">{i.group}</p>}
                  <div className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 ${isDone(`ing:${i.id}`) ? 'bg-sage-50' : 'bg-cream-100'}`}>
                    <Tick on={isDone(`ing:${i.id}`)} onChange={(v) => setDone([`ing:${i.id}`], v)} label={formatIngredient(i)} />
                    <span className="flex-1">{formatIngredient(i)}</span><CopyButton text={formatIngredient(i)} onCopied={() => setDone([`ing:${i.id}`], true)} /></div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === 4 && steps.length > 0 && (() => {
          const s = steps[Math.min(k, steps.length - 1)];
          const text = stepText(s);
          return (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-bold">Schritt {Math.min(k, steps.length - 1) + 1} von {steps.length}</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-1">{steps.map((x, j) => <button key={j} onClick={() => setK(j)} aria-label={`Schritt ${j + 1}${isDone(`step:${x.id}`) ? ' (übertragen)' : ''}`} className={`h-2.5 w-6 rounded-full ${j === k ? 'bg-sage-600 ring-2 ring-sage-300' : isDone(`step:${x.id}`) ? 'bg-sage-300' : 'bg-cream-300'}`} />)}</div>
                  <CopyButton text={allStepsText} label="Alle Schritte kopieren" onCopied={() => setDone(steps.map((x) => `step:${x.id}`), true)} />
                </div>
              </div>
              <div className={`rounded-3xl border p-5 ${isDone(`step:${s.id}`) ? 'border-sage-300 bg-sage-50/60' : 'border-cream-300 bg-white'}`}>
                <p className="mb-4 text-[19px] leading-relaxed">{text}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <CopyButton text={text} label="Schritttext kopieren" big onCopied={() => setDone([`step:${s.id}`], true)} />
                  <label className="flex items-center gap-2 font-semibold"><Tick on={isDone(`step:${s.id}`)} onChange={(v) => setDone([`step:${s.id}`], v)} label={`Schritt ${k + 1}`} /> übertragen</label>
                </div>
              </div>
              <div>
                <h3 className="mb-2 font-bold">Thermomix-Einstellung im Cookidoo-Editor auswählen</h3>
                <TmDisplay text={s.text} />
              </div>
              {s.accessories.length > 0 && <p className="text-ink-soft">Zubehör: <b>{s.accessories.map((a) => ACCESSORIES[a]).join(', ')}</b></p>}
              {(s.ingredients ?? []).length > 0 && <p className="text-ink-soft">Zutaten in diesem Schritt (im Cookidoo-Editor über „Zutaten“ ⚖ markieren): <b>{s.ingredients!.join(' · ')}</b></p>}
              {s.suggestions.length > 0 && <p className="flex items-center gap-2 rounded-2xl bg-apricot-100 p-3 text-sm text-apricot-700"><AlertTriangle size={16} /> Hier gibt es einen unbestätigten Vorschlag ({describeSetting(s.suggestions[0].setting).join(' · ')}). Er wird nur übertragen, wenn du ihn im Editor übernimmst.</p>}
              <div className="flex justify-between">
                <button className="btn-ghost" disabled={k === 0} onClick={() => setK(k - 1)}><ArrowLeft size={18} /> Vorheriger Schritt</button>
                {k < steps.length - 1 ? <button className="btn-primary" onClick={() => { if (!isDone(`step:${s.id}`)) setDone([`step:${s.id}`], true); setK(k + 1); }}>Nächster Schritt <ArrowRight size={18} /></button>
                  : <button className="btn-primary" onClick={() => { if (!isDone(`step:${s.id}`)) setDone([`step:${s.id}`], true); setStep(5); }}>Alle Schritte erledigt <Check size={18} /></button>}
              </div>
            </div>
          );
        })()}

        {step === 5 && (
          <div className="space-y-5 text-center">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-sage-50 text-sage-600"><PartyPopper size={40} /></div>
            <h2 className="text-3xl font-bold">Fast geschafft!</h2>
            {checklist.some((c) => !c.optional && c.done < c.total) && (
              <div className="mx-auto max-w-lg rounded-2xl bg-apricot-100 p-4 text-left text-apricot-700">
                <b className="flex items-center gap-2"><AlertTriangle size={18} /> Noch nicht abgehakt:</b>
                <ul className="mt-1 list-disc pl-6">{checklist.filter((c) => !c.optional && c.done < c.total).map((c) => (
                  <li key={c.key}><button className="underline" onClick={() => setStep(c.wizard)}>{c.label}{c.total > 1 ? ` (${c.total - c.done} offen)` : ''}</button></li>
                ))}</ul>
              </div>
            )}
            <ol className="mx-auto max-w-lg list-decimal space-y-2 pl-5 text-left text-[17px]">
              <li>In Cookidoo auf <b>„Speichern“</b> klicken.</li>
              <li>Am TM6: <b>Cookidoo → Meine Rezepte → Meine Kreationen</b>. Der TM6 gleicht sich automatisch ab (WLAN nötig, TM6-Software ab Version 3.0).</li>
              <li>Rezept starten – der TM6 führt Schritt für Schritt durch.</li>
            </ol>
            {r.cookidoo?.status === 'übertragen'
              ? <p className="flex items-center justify-center gap-2 font-semibold text-sage-700"><CheckCircle2 /> Als „In Cookidoo“ markiert</p>
              : <button className="btn-primary px-8 py-4 text-lg" onClick={markDone}><Check size={20} /> Als übertragen markieren</button>}
          </div>
        )}

        {step > 0 && step < 5 && step !== 4 && (
          <div className="mt-8 flex justify-between">
            <button className="btn-ghost" onClick={() => setStep(step - 1)}><ArrowLeft size={18} /> Zurück</button>
            <button className="btn-primary" onClick={() => { setStep(step + 1); setK(0); }}>Weiter <ArrowRight size={18} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
