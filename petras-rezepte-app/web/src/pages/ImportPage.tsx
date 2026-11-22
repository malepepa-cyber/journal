import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, FileUp, Sparkles, Wand2, Bookmark, FileText, ScanText, FileType2, ImageIcon, Link2, Globe, ExternalLink, X, Loader2, Lock } from 'lucide-react';
import type { Recipe, SourceType } from '../../../shared/model.ts';
import { parseRecipeText } from '../../../shared/parser.ts';
import { extractFromDom } from '../../../shared/sites/generic.ts';
import { Api } from '../lib/api.ts';
import { fileToText } from '../lib/importers.ts';
import { go } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { PageHeader, ProgressOverlay, useToast } from '../components/ui.tsx';

export const IMPORT_MARK = 'PETRAS-REZEPTE-IMPORT:';

/** Websites, die Rezepte nur angemeldeten Mitgliedern vollständig zeigen */
const LOGIN_SITES = /(^|\.)zaubertopf-club\.de$/i;

interface Payload { v: number; text?: string; recipe?: Recipe; notes?: string[]; url?: string; title?: string; source?: string; subRecipes?: { title: string; url: string; recipe?: Recipe }[] }

/** Neues Rezept als Entwurf ablegen und im Editor öffnen. */
export async function openAsDraft(recipe: Recipe, notes: string[] = []) {
  await Api.saveDraft({ recipe, notes, createdAt: new Date().toISOString() });
  go('neu');
}

export function ImportPage() {
  const { session } = useSession();
  const toast = useToast();
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<{ label: string; value: number | null } | null>(null);
  const [drag, setDrag] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [waiting, setWaiting] = useState<{ url: string; reason: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const aiAvailable = !!session?.settings.aiEnabled && !!session?.aiKey;

  /** Teilrezepte (vom Lesezeichen mitgeholt) direkt in die Bibliothek legen */
  async function saveSubRecipes(subs: Payload['subRecipes'], parent: string) {
    let n = 0;
    for (const s of subs ?? []) {
      if (!s.recipe?.title) continue;
      const dup = await Api.duplicates(s.recipe).catch(() => []);
      if (dup.length) continue;
      await Api.create({ ...s.recipe, notes: `Teilrezept von „${parent}“.` }).then(() => n++).catch(() => {});
    }
    if (n) toast(`${n} Teilrezept${n > 1 ? 'e' : ''} zusätzlich in „Meine Rezepte“ gespeichert`);
  }

  async function analyse(raw: string, source: { type: SourceType; name: string; url?: string }) {
    let t = raw.trim();
    if (t.startsWith(IMPORT_MARK)) {
      let p: Payload | null = null;
      try { p = JSON.parse(t.slice(IMPORT_MARK.length)); } catch { /* normal weiter */ }
      if (p?.recipe) {
        setWaiting(null);
        await saveSubRecipes(p.subRecipes, p.recipe.title);
        await openAsDraft(p.recipe, p.notes ?? []);
        return;
      }
      if (p?.text) { t = p.text; source = { type: 'web', name: p.title || 'Webseite', url: p.source }; }
    }
    if (t.replace(/\s/g, '').length < 20) { toast('Es wurde kaum Text gefunden. Bitte das ganze Rezept kopieren.', 'fehler'); return; }
    setBusy({ label: 'Rezept wird analysiert …', value: null });
    try {
      let recipe = parseRecipeText(t, source);
      const notes: string[] = [];
      if (useAi && aiAvailable) {
        setBusy({ label: 'KI bereitet das Rezept auf … (dauert etwa 20–60 Sekunden)', value: null });
        try {
          const r = await Api.aiStructure(t);
          recipe = { ...r.recipe, source };
          notes.push(...r.issues);
        } catch (e: any) {
          toast(`KI nicht verfügbar (${e.message}) – die normale Erkennung wurde verwendet.`, 'info');
        }
      }
      await openAsDraft(recipe, notes);
    } catch (e: any) {
      toast(e.message, 'fehler'); Api.log(e.message, 'import');
    } finally { setBusy(null); }
  }

  /** HTML (gespeicherte Seite oder per Link geladen) → Rezept */
  async function fromHtml(html: string, url: string, name: string): Promise<boolean> {
    // Fremde Skripte, Inline-Ereignisse und eingebettete Seiten vor dem Einlesen entfernen (Sicherheit)
    const safe = html
      .replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, '')
      .replace(/<(iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const doc = new DOMParser().parseFromString(safe, 'text/html');
    const res = extractFromDom(doc, url);
    if (!res.complete) return false;
    res.recipe.source = { type: 'web', name: res.method === 'ZauberTopf Club' ? 'ZauberTopf Club' : name, url: url || res.recipe.source.url };
    await openAsDraft(res.recipe, res.notes);
    return true;
  }

  async function onFile(file?: File | null) {
    if (!file) return;
    setBusy({ label: 'Datei wird geöffnet …', value: 0 });
    try {
      const r = await fileToText(file, (p) => setBusy({ label: p.label, value: p.value }));
      if (r.kind === 'html') {
        setBusy({ label: 'Gespeicherte Seite wird gelesen …', value: null });
        if (!(await fromHtml(r.text, '', file.name))) {
          toast('Die gespeicherte Seite enthält nur eine Vorschau (nicht angemeldet gespeichert?). Bitte angemeldet speichern oder das Lesezeichen verwenden.', 'fehler');
        }
        return;
      }
      if (r.ocr) toast('Gescannte Seiten wurden per Texterkennung gelesen – bitte besonders sorgfältig prüfen.', 'info');
      await analyse(r.text, { type: r.ocr ? 'ocr' : r.kind === 'docx' ? 'docx' : r.kind === 'txt' ? 'txt' : 'pdf', name: file.name });
    } catch (e: any) {
      toast(e.message || 'Die Datei konnte nicht gelesen werden.', 'fehler');
      Api.log(String(e.message), 'datei-import');
    } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ''; }
  }

  /** Link einfügen: öffentliche Seiten direkt, Club-Rezepte über Chrome + Lesezeichen */
  async function fromLink() {
    let url: URL;
    try { url = new URL(link.trim().replace(/^(?!https?:\/\/)/i, 'https://')); } catch { toast('Das ist keine gültige Internetadresse.', 'fehler'); return; }
    if (LOGIN_SITES.test(url.hostname)) {
      setWaiting({ url: url.toString(), reason: 'Der ZauberTopf Club zeigt die Zubereitung nur angemeldeten Mitgliedern. Die App liest das Rezept deshalb in deinem angemeldeten Chrome.' });
      return;
    }
    setBusy({ label: 'Seite wird geladen …', value: null });
    try {
      const r = await Api.fetchUrl(url.toString());
      setBusy({ label: 'Rezept wird erkannt …', value: null });
      if (!(await fromHtml(r.html, r.url, url.hostname))) {
        setWaiting({ url: url.toString(), reason: 'Die Seite zeigt ohne Anmeldung nur eine Vorschau.' });
      }
    } catch (e: any) {
      setWaiting({ url: url.toString(), reason: `${e.message} – über Chrome klappt es trotzdem.` });
    } finally { setBusy(null); }
  }

  const fromClipboard = useCallback(async (silent = false) => {
    try {
      const t = await navigator.clipboard.readText();
      if (silent && !t.startsWith(IMPORT_MARK)) return;
      if (!t.trim()) { toast('Die Zwischenablage ist leer.', 'info'); return; }
      setText(t.startsWith(IMPORT_MARK) ? '' : t);
      await analyse(t, { type: 'text', name: 'Zwischenablage' });
    } catch { if (!silent) toast('Bitte in das Textfeld klicken und Strg + V drücken.', 'info'); }
  }, [useAi, aiAvailable]);

  // Warten auf das Lesezeichen: sobald Petra zurück in die App wechselt, Zwischenablage prüfen
  useEffect(() => {
    if (!waiting) return;
    const onFocus = () => setTimeout(() => fromClipboard(true), 250);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [waiting, fromClipboard]);

  // Ziehen & Ablegen überall
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const enter = (e: DragEvent) => { if (has(e)) { e.preventDefault(); depth++; setDrag(true); } };
    const over = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (has(e) && --depth <= 0) { depth = 0; setDrag(false); } };
    const drop = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth = 0; setDrag(false); onFile(e.dataTransfer?.files[0]); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  });

  return (
    <div>
      <PageHeader title="Rezept importieren" subtitle="Link einfügen, Text einfügen oder eine Datei hochladen – die App erkennt Zutaten, Schritte und Thermomix-Einstellungen automatisch." />

      {/* Link */}
      <section className="card mb-6 p-7">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sage-600 text-white"><Link2 /></div>
          <div><h2 className="text-xl font-bold">Link einfügen</h2><p className="text-sm text-ink-soft">Adresse der Rezeptseite kopieren (z. B. aus dem Zaubertopf Club) und hier einfügen</p></div>
        </div>
        <form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); fromLink(); }}>
          <div className="relative min-w-64 flex-1">
            <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" size={20} />
            <input className="input pl-12" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.zaubertopf-club.de/rezept/…" aria-label="Link zur Rezeptseite" inputMode="url" />
          </div>
          <button className="btn-primary" disabled={!link.trim()}><Wand2 size={18} /> Rezept holen</button>
        </form>

        {waiting && (
          <div className="mt-5 rounded-3xl border-2 border-sage-300 bg-sage-50 p-5">
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 shrink-0 text-sage-700" />
              <div className="flex-1">
                <p className="mb-3 text-sage-900">{waiting.reason}</p>
                <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-[15px]">
                  <li><b>„Seite in Chrome öffnen“</b> klicken (du bist dort im Club angemeldet).</li>
                  <li>Auf der Rezeptseite in der Lesezeichenleiste <b>„➜ Petras Rezepte“</b> klicken → <b>„Für die App kopieren“</b>.</li>
                  <li>Zurück zu diesem Fenster – <b>die App übernimmt das Rezept automatisch</b>.</li>
                </ol>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary" onClick={() => window.open(waiting.url, '_blank')}><ExternalLink size={18} /> Seite in Chrome öffnen</button>
                  <button className="btn-ghost" onClick={() => fromClipboard(false)}><ClipboardPaste size={18} /> Aus Zwischenablage einfügen</button>
                  <button className="btn-ghost" onClick={() => setWaiting(null)} aria-label="Abbrechen"><X size={18} /></button>
                </div>
                <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft"><Loader2 size={15} className="animate-spin" /> Warte auf das Rezept … Noch kein Lesezeichen? <button className="font-semibold text-sage-700 underline" onClick={() => go('einstellungen')}>Hier einrichten</button></p>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col p-7">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sage-50 text-sage-600"><ClipboardPaste /></div>
            <div><h2 className="text-xl font-bold">Text einfügen</h2><p className="text-sm text-ink-soft">Im Rezept markieren → Strg + C → hier Strg + V</p></div>
          </div>
          <textarea className="input mb-4 min-h-[220px] flex-1 resize-y text-[15px] leading-relaxed" value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'Rezept hier einfügen …\n\nZum Beispiel:\nHefezopf\nZutaten\n500 g Mehl\n…\nZubereitung\n1. Milch, Hefe und Zucker 2 Min. | 37 °C | Stufe 2 erwärmen.'} aria-label="Rezepttext" />
          <div className="flex flex-wrap gap-3">
            <button className="btn-ghost" onClick={() => fromClipboard(false)}><ClipboardPaste size={18} /> Aus Zwischenablage einfügen</button>
            <button className="btn-primary flex-1" disabled={!text.trim()} onClick={() => analyse(text, { type: 'text', name: 'eingefügter Text' })}><Wand2 size={18} /> Rezept erkennen</button>
          </div>
        </section>

        <section className={`card flex flex-col p-7 transition ${drag ? 'ring-4 ring-sage-300' : ''}`}>
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-apricot-100 text-apricot-700"><FileUp /></div>
            <div><h2 className="text-xl font-bold">Datei hochladen</h2><p className="text-sm text-ink-soft">PDF, gespeicherte Webseite, Word, TXT, Foto</p></div>
          </div>
          <button onClick={() => fileRef.current?.click()}
            className={`mb-4 flex min-h-[220px] flex-1 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed p-8 text-center transition ${drag ? 'border-sage-600 bg-sage-50' : 'border-cream-300 bg-cream-100 hover:border-sage-500 hover:bg-sage-50'}`}>
            <FileUp size={44} className="text-sage-600" />
            <span className="text-xl font-bold">Datei hierher ziehen</span>
            <span className="text-ink-soft">oder <u className="text-sage-700 underline-offset-4">Datei auswählen</u></span>
            <span className="mt-2 flex flex-wrap justify-center gap-2 text-xs text-ink-soft">
              <span className="chip bg-white"><FileText size={13} /> PDF</span><span className="chip bg-white"><Globe size={13} /> Webseite (.html)</span><span className="chip bg-white"><ScanText size={13} /> Scan</span>
              <span className="chip bg-white"><FileType2 size={13} /> Word</span><span className="chip bg-white"><ImageIcon size={13} /> Foto</span>
            </span>
          </button>
          <input ref={fileRef} type="file" hidden accept=".pdf,.html,.htm,.mhtml,.docx,.txt,image/jpeg,image/png,image/webp,application/pdf,text/html,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
          <details className="text-sm text-ink-soft">
            <summary className="cursor-pointer font-medium text-sage-700">Rezeptseite speichern – so geht's</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5"><li>Rezept im Zaubertopf Club öffnen (angemeldet).</li><li><b>Strg + S</b> → Dateityp „Webseite, nur HTML“ oder „vollständig“ → Speichern.</li><li>Die .html-Datei hierher ziehen. (Alternativ: <b>Strg + P</b> → „Als PDF speichern“.)</li></ol>
          </details>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <label className={`card flex items-start gap-4 p-5 ${aiAvailable ? 'cursor-pointer' : 'opacity-70'}`}>
          <input type="checkbox" className="mt-1 h-5 w-5 accent-sage-600" disabled={!aiAvailable} checked={useAi && aiAvailable} onChange={(e) => setUseAi(e.target.checked)} />
          <div>
            <b className="flex items-center gap-2"><Sparkles size={18} className="text-apricot-500" /> Mit KI aufbereiten (optional)</b>
            <p className="text-sm text-ink-soft">{aiAvailable ? 'Hilft bei unübersichtlichen Texten. Thermomix-Vorschläge der KI musst du bestätigen.' : 'Ausgeschaltet. Die normale Erkennung funktioniert ohne KI und kostenlos. Einschalten unter Einstellungen → KI.'}</p>
          </div>
        </label>
        <button className="card flex items-start gap-4 p-5 text-left hover:shadow-[var(--shadow-lift)]" onClick={() => go('einstellungen')}>
          <Bookmark className="mt-0.5 shrink-0 text-sage-600" />
          <div><b>Lesezeichen „➜ Petras Rezepte“</b><p className="text-sm text-ink-soft">Liest Rezepte direkt auf der Seite – auch angemeldet im Club, inkl. Kochmodus und verlinkter Teilrezepte. Einrichten unter Einstellungen.</p></div>
        </button>
      </div>

      {busy && <ProgressOverlay label={busy.label} value={busy.value} />}
    </div>
  );
}
