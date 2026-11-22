/**
 * Cookidoo übertragen.
 * Standard: geführter Assistent (vollständig mit den Cookidoo-Nutzungsbedingungen vereinbar).
 * Optional: experimentelle Schnellübertragung per Lesezeichen (nur wenn in den Einstellungen eingeschaltet).
 */
import { useEffect, useState } from 'react';
import { Copy, Check, ExternalLink, ArrowLeft, ArrowRight, Send, Zap, Bot, Hand, AlertTriangle, PartyPopper, Pencil, CheckCircle2 } from 'lucide-react';
import { ACCESSORIES, type Recipe, type RecipeSummary } from '../../../shared/model.ts';
import { findSettings, describeSetting, formatSeconds } from '../../../shared/tm.ts';
import { formatIngredient } from '../../../shared/ingredients.ts';
import { stepText } from '../../../shared/cookidoo.ts';
import { Api } from '../lib/api.ts';
import { go } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
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

function CopyButton({ text, label = 'Kopieren', big }: { text: string; label?: string; big?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button className={`${big ? 'btn-primary' : 'btn-soft btn-sm'} shrink-0`} onClick={async () => { if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1800); } }}>
      {done ? <><Check size={16} /> Kopiert</> : <><Copy size={16} /> {label}</>}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-cream-100 p-4">
      <div className="min-w-0 flex-1"><span className="label mb-0.5">{label}</span><div className="text-lg font-semibold">{value || '—'}</div></div>
      {value && <CopyButton text={value} />}
    </div>
  );
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

  const openCookidoo = async () => {
    window.open(settings.cookidooUrl, '_blank', 'noopener');
    if (r.cookidoo?.status === 'offen') setR(await Api.cookidoo(r.id!, 'in Arbeit'));
  };
  const markDone = async () => { setR(await Api.cookidoo(r.id!, 'übertragen')); toast('Als „In Cookidoo“ markiert'); };
  const quick = async () => {
    const ok = await copyText(TRANSFER_MARK + JSON.stringify({ v: 1, allowApi: true, recipe: r }));
    if (!ok) { toast('Kopieren hat nicht geklappt.', 'fehler'); return; }
    await openCookidoo();
    toast('Kopiert – jetzt in Cookidoo auf das Lesezeichen „➜ Petras Rezepte“ klicken.', 'info');
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

      <div className="card p-7">
        {step === 0 && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl bg-sage-50 p-5">
                <h3 className="mb-2 flex items-center gap-2 font-bold text-sage-700"><Bot size={20} /> Das erledigt die App</h3>
                <ul className="list-disc space-y-1 pl-5 text-[15px]"><li>Rezept ist erkannt, geprüft und im Cookidoo-Format aufbereitet</li><li>Jeder Text lässt sich mit einem Klick kopieren</li><li>Thermomix-Werte werden pro Schritt groß angezeigt</li><li>Cookidoo wird in Chrome geöffnet</li></ul>
              </div>
              <div className="rounded-3xl bg-apricot-100/60 p-5">
                <h3 className="mb-2 flex items-center gap-2 font-bold text-apricot-700"><Hand size={20} /> Das bestätigst du in Cookidoo</h3>
                <ul className="list-disc space-y-1 pl-5 text-[15px]"><li>„Rezept erstellen“ anklicken</li><li>Texte einfügen (Strg + V)</li><li>Thermomix-Einstellungen in den Schritten auswählen</li><li>Auf „Speichern“ klicken</li></ul>
              </div>
            </div>
            <p className="text-sm text-ink-soft">Warum nicht vollautomatisch? Vorwerk bietet für Cookidoo keine offizielle Schnittstelle an. Der Assistent nutzt nur die normale Cookidoo-Webseite – so bleibt alles zuverlässig und im Rahmen der Nutzungsbedingungen.</p>
            {pending > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-apricot-100 p-4 text-apricot-700">
                <AlertTriangle /> <span className="flex-1"><b>{pending} Schritt{pending > 1 ? 'e haben' : ' hat'} noch unbestätigte Vorschläge.</b> Unbestätigte Vorschläge werden nicht übertragen.</span>
                <button className="btn-ghost btn-sm bg-white" onClick={() => go(`rezept/${r.id}`)}>Jetzt prüfen</button>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <button className="btn-primary px-7 py-4 text-lg" onClick={async () => { await openCookidoo(); setStep(1); }}><ExternalLink size={20} /> Cookidoo öffnen & loslegen</button>
              <button className="btn-ghost" onClick={() => setStep(1)}>Cookidoo ist schon offen</button>
            </div>
            <p className="text-sm text-ink-soft">In Cookidoo: <b>Meine Rezepte → Meine Kreationen → „Rezept erstellen“</b>. Danach hier Schritt für Schritt weiter.</p>

            {settings.experimentalTransfer && (
              <div className="rounded-3xl border-2 border-dashed border-apricot-300 p-5">
                <h3 className="mb-1 flex items-center gap-2 font-bold"><Zap size={20} className="text-apricot-500" /> Schnellübertragung (experimentell)</h3>
                <p className="mb-3 text-sm text-ink-soft">Füllt „Meine Kreationen“ automatisch über das Lesezeichen in deinem angemeldeten Chrome. Nutzt die Schnittstelle der Cookidoo-Webseite, die nicht offiziell dokumentiert ist – kann jederzeit aufhören zu funktionieren. Ergebnis bitte in Cookidoo prüfen.</p>
                <ol className="mb-4 list-decimal space-y-1 pl-5 text-[15px]"><li>„Vorbereiten & Cookidoo öffnen“ klicken</li><li>In Cookidoo auf das Lesezeichen <b>„➜ Petras Rezepte“</b> klicken</li><li>„In ‚Meine Kreationen‘ speichern“ klicken</li></ol>
                <div className="flex flex-wrap gap-3"><button className="btn-accent" onClick={quick}><Zap size={18} /> Vorbereiten & Cookidoo öffnen</button>
                  <button className="btn-ghost" onClick={() => { markDone(); setStep(5); }}>Hat geklappt – als übertragen markieren</button></div>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Name des Rezepts</h2>
            <p className="text-ink-soft">In Cookidoo bei „Rezept erstellen“ den Namen einfügen.</p>
            <Row label="Rezeptname" value={r.title} />
            {r.description && <Row label="Beschreibung (optional)" value={r.description} />}
            {r.photo && <p className="rounded-2xl bg-cream-100 p-4 text-sm text-ink-soft">Foto: In Cookidoo kannst du ein eigenes Bild hochladen. Bitte nur eigene Fotos verwenden (Urheberrecht).</p>}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Portionen & Zeiten</h2>
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
              <CopyButton text={ingredientsText} label="Alle Zutaten kopieren" big />
            </div>
            <p className="text-ink-soft">Jede Zutat steht in Cookidoo in einer eigenen Zeile. Einzeln kopieren oder alle auf einmal.</p>
            <ul className="space-y-2">
              {r.ingredients.map((i, n) => (
                <li key={i.id}>
                  {i.group && i.group !== r.ingredients[n - 1]?.group && <p className="mt-3 mb-1 text-sm font-bold uppercase tracking-wide text-sage-700">{i.group}</p>}
                  <div className="flex items-center gap-3 rounded-2xl bg-cream-100 px-4 py-2.5"><span className="flex-1">{formatIngredient(i)}</span><CopyButton text={formatIngredient(i)} /></div>
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
                <div className="flex gap-1">{steps.map((_, j) => <button key={j} onClick={() => setK(j)} aria-label={`Schritt ${j + 1}`} className={`h-2.5 w-6 rounded-full ${j === k ? 'bg-sage-600' : j < k ? 'bg-sage-300' : 'bg-cream-300'}`} />)}</div>
              </div>
              <div className="rounded-3xl border border-cream-300 bg-white p-5">
                <p className="mb-4 text-[19px] leading-relaxed">{text}</p>
                <CopyButton text={text} label="Schritttext kopieren" big />
              </div>
              <div>
                <h3 className="mb-2 font-bold">Thermomix-Einstellung im Cookidoo-Editor auswählen</h3>
                <TmDisplay text={s.text} />
              </div>
              {s.accessories.length > 0 && <p className="text-ink-soft">Zubehör: <b>{s.accessories.map((a) => ACCESSORIES[a]).join(', ')}</b></p>}
              {s.suggestions.length > 0 && <p className="flex items-center gap-2 rounded-2xl bg-apricot-100 p-3 text-sm text-apricot-700"><AlertTriangle size={16} /> Hier gibt es einen unbestätigten Vorschlag ({describeSetting(s.suggestions[0].setting).join(' · ')}). Er wird nur übertragen, wenn du ihn im Editor übernimmst.</p>}
              <div className="flex justify-between">
                <button className="btn-ghost" disabled={k === 0} onClick={() => setK(k - 1)}><ArrowLeft size={18} /> Vorheriger Schritt</button>
                {k < steps.length - 1 ? <button className="btn-primary" onClick={() => setK(k + 1)}>Nächster Schritt <ArrowRight size={18} /></button>
                  : <button className="btn-primary" onClick={() => setStep(5)}>Alle Schritte erledigt <Check size={18} /></button>}
              </div>
            </div>
          );
        })()}

        {step === 5 && (
          <div className="space-y-5 text-center">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-sage-50 text-sage-600"><PartyPopper size={40} /></div>
            <h2 className="text-3xl font-bold">Fast geschafft!</h2>
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
