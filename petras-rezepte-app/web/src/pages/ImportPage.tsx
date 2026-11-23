/**
 * Rezept importieren.
 * Hauptweg: Rezeptseite im Zaubertopf Club mit Strg + S speichern → Datei hier hochladen → „Rezept jetzt erkennen“.
 * Alternativen: Internetlink (öffentlich direkt / Club über Lesezeichen) und Text einfügen.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ClipboardPaste, FileUp, Sparkles, Wand2, Bookmark, FileText, ScanText, FileType2, ImageIcon, Link2, Globe, ExternalLink, X, Loader2, Lock,
  Search, Save, Upload, ClipboardCheck, Send, Check, RotateCcw, ChevronDown, ChevronUp, FileCode2, Trash2, Info,
} from 'lucide-react';
import type { Recipe, SourceType } from '../../../shared/model.ts';
import { parseRecipeText } from '../../../shared/parser.ts';
import { extractFromDom } from '../../../shared/sites/generic.ts';
import { Api, openInChrome } from '../lib/api.ts';
import { fileToText, kindOf, resizePhoto } from '../lib/importers.ts';
import { go } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { PageHeader, ProgressOverlay, useToast } from '../components/ui.tsx';

export const IMPORT_MARK = 'PETRAS-REZEPTE-IMPORT:';
const ZAUBERTOPF_URL = 'https://www.zaubertopf-club.de/';
const COOKIDOO_URL = 'https://cookidoo.de/foundation/de-DE/for-you';

/** Websites, die Rezepte nur angemeldeten Mitgliedern vollständig zeigen */
const LOGIN_SITES = /(^|\.)zaubertopf-club\.de$/i;

interface Payload { v: number; text?: string; recipe?: Recipe; notes?: string[]; url?: string; title?: string; source?: string; subRecipes?: { title: string; url: string; recipe?: Recipe }[] }

/** Neues Rezept als Entwurf ablegen und im Editor öffnen. */
export async function openAsDraft(recipe: Recipe, notes: string[] = []) {
  await Api.saveDraft({ recipe, notes, createdAt: new Date().toISOString() });
  go('neu');
}

// ---------------- Anleitung (Status bleibt erhalten) ----------------
type GuideState = { open: boolean; done: Record<number, boolean> };
const GUIDE_KEY = 'pra.anleitung';
const loadGuide = (): GuideState => { try { return { open: true, done: {}, ...JSON.parse(localStorage.getItem(GUIDE_KEY) || '{}') }; } catch { return { open: true, done: {} }; } };
const saveGuide = (g: GuideState) => { try { localStorage.setItem(GUIDE_KEY, JSON.stringify(g)); } catch { /* egal */ } };
export function markGuide(step: number) { const g = loadGuide(); g.done[step] = true; saveGuide(g); }

const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-grid min-w-12 place-items-center rounded-xl border-2 border-b-4 border-cream-300 bg-white px-3 py-1.5 text-base font-bold text-ink shadow-sm">{children}</kbd>
);

function GuideStep({ n, icon, title, done, active, children, action }: { n: number; icon: ReactNode; title: string; done: boolean; active: boolean; children: ReactNode; action?: ReactNode }) {
  return (
    <li className={`relative flex flex-col rounded-3xl border-2 p-5 transition ${done ? 'border-sage-300 bg-sage-50/70' : active ? 'border-apricot-300 bg-white shadow-[var(--shadow-soft)]' : 'border-cream-300 bg-white'}`}>
      <div className="mb-3 flex items-center gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-bold ${done ? 'bg-sage-600 text-white' : active ? 'bg-apricot-500 text-white' : 'bg-cream-200 text-ink-soft'}`}>
          {done ? <Check size={22} strokeWidth={3} /> : n}
        </span>
        <span className={`grid h-10 w-10 place-items-center rounded-2xl ${done ? 'text-sage-600' : 'text-apricot-500'}`}>{icon}</span>
        <span className={`ml-auto text-xs font-semibold uppercase tracking-wide ${done ? 'text-sage-700' : active ? 'text-apricot-700' : 'text-ink-faint'}`}>{done ? 'Erledigt' : active ? 'Jetzt' : 'Danach'}</span>
      </div>
      <h3 className="mb-2 text-[17px] font-bold leading-snug">{title}</h3>
      <div className="flex-1 text-[15px] leading-relaxed text-ink-soft">{children}</div>
      {action && <div className="mt-4 flex flex-wrap gap-2">{action}</div>}
    </li>
  );
}

// ---------------- Dateien aus Drag & Drop (auch ganze Ordner) ----------------
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const readEntry = async (entry: any): Promise<void> => {
    if (!entry) return;
    if (entry.isFile) { out.push(await new Promise<File>((ok, fail) => entry.file(ok, fail))); return; }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch: any[] = await new Promise((ok, fail) => reader.readEntries(ok, fail));
        if (!batch.length) break;
        for (const e of batch) await readEntry(e);
      }
    }
  };
  const items = Array.from(dt.items ?? []);
  if (items.length && typeof (items[0] as any).webkitGetAsEntry === 'function') {
    for (const it of items) await readEntry((it as any).webkitGetAsEntry());
  } else out.push(...Array.from(dt.files));
  return out;
}

/** Hauptdatei auswählen: Rezeptdatei bevorzugt (HTML/PDF/Word/TXT), Bilder nur wenn sonst nichts da ist */
function pickMain(files: File[]): File | null {
  const rank = (f: File) => { const k = kindOf(f); return k === 'html' ? 0 : k === 'pdf' ? 1 : k === 'docx' || k === 'doc' ? 2 : k === 'txt' ? 3 : k === 'image' ? 4 : 9; };
  return [...files].filter((f) => kindOf(f)).sort((a, b) => rank(a) - rank(b) || b.size - a.size)[0] ?? null;
}

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function ImportPage() {
  const { session } = useSession();
  const toast = useToast();
  const [guide, setGuide] = useState<GuideState>(loadGuide);
  const [file, setFile] = useState<File | null>(null);
  const [extras, setExtras] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [showText, setShowText] = useState(false);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<{ label: string; value: number | null } | null>(null);
  const [drag, setDrag] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [waiting, setWaiting] = useState<{ url: string; reason: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLElement>(null);
  const aiAvailable = !!session?.settings.aiEnabled && !!session?.aiKey;

  const updateGuide = (fn: (g: GuideState) => GuideState) => setGuide((g) => { const n = fn(g); saveGuide(n); return n; });
  const done = (step: number) => updateGuide((g) => ({ ...g, done: { ...g.done, [step]: true } }));
  const firstOpen = [1, 2, 3, 4, 5].find((s) => !guide.done[s]) ?? 6;

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

  async function finish(recipe: Recipe, notes: string[]) {
    done(3); done(4);
    await openAsDraft(recipe, notes);
  }

  async function analyse(raw: string, source: { type: SourceType; name: string; url?: string }) {
    let t = raw.trim();
    if (t.startsWith(IMPORT_MARK)) {
      let p: Payload | null = null;
      try { p = JSON.parse(t.slice(IMPORT_MARK.length)); } catch { /* normal weiter */ }
      if (p?.recipe) {
        setWaiting(null);
        await saveSubRecipes(p.subRecipes, p.recipe.title);
        await finish(p.recipe, p.notes ?? []);
        return;
      }
      if (p?.text) { t = p.text; source = { type: 'web', name: p.title || 'Webseite', url: p.source }; }
    }
    if (t.replace(/\s/g, '').length < 20) { toast('Es wurde kaum Text gefunden. Bitte das ganze Rezept kopieren.', 'fehler'); return; }
    setBusy({ label: 'Rezept wird erkannt …', value: null });
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
      await finish(recipe, notes);
    } catch (e: any) {
      toast(e.message, 'fehler'); Api.log(e.message, 'import');
    } finally { setBusy(null); }
  }

  /** Rezeptbild: zuerst aus dem mitgespeicherten Ordner, sonst von der Quelle */
  async function loadPhoto(imageUrl: string | undefined, folder: File[]): Promise<{ photo: string | null; note?: string }> {
    if (!imageUrl) return { photo: null };
    const base = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() ?? '').toLowerCase();
    const local = folder.find((f) => f.name.toLowerCase() === base || (base && f.name.toLowerCase().startsWith(base.replace(/\.[a-z]+$/, ''))));
    try {
      if (local) return { photo: await resizePhoto(local), note: 'Rezeptbild aus dem gespeicherten Ordner übernommen – nur für den privaten Gebrauch.' };
      const img = await Api.fetchImage(imageUrl);
      const blob = await (await fetch(img.data)).blob();
      return { photo: await resizePhoto(blob), note: 'Rezeptbild von der Rezeptseite übernommen – nur für den privaten Gebrauch.' };
    } catch { return { photo: null, note: 'Das Rezeptbild konnte nicht geladen werden (kann im Editor ergänzt werden).' }; }
  }

  /** HTML (gespeicherte Seite oder per Link geladen) → Rezept */
  async function fromHtml(html: string, url: string, name: string, folder: File[] = []): Promise<boolean> {
    // Fremde Skripte, Inline-Ereignisse und eingebettete Seiten vor dem Einlesen entfernen (Sicherheit)
    const safe = html
      .replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, '')
      .replace(/<(iframe|object|embed)[\s\S]*?<\/\1>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const doc = new DOMParser().parseFromString(safe, 'text/html');
    const res = extractFromDom(doc, url);
    if (!res.complete) return false;
    res.recipe.source = { type: 'web', name: res.method === 'ZauberTopf Club' ? 'ZauberTopf Club' : name, url: url || res.recipe.source.url };
    setBusy({ label: 'Rezeptbild wird geladen …', value: 0.85 });
    const { photo, note } = await loadPhoto(res.imageUrl, folder);
    if (photo) res.recipe.photo = photo;
    await finish(res.recipe, note ? [...res.notes, note] : res.notes);
    return true;
  }

  function chooseFiles(list: File[]) {
    const main = pickMain(list);
    if (!main) { toast('Keine passende Rezeptdatei gefunden. Möglich sind PDF, HTML, Word, TXT und Bilder.', 'fehler'); return; }
    setFile(main);
    setExtras(list.filter((f) => f !== main && kindOf(f) === 'image'));
    done(1); done(2);
    setTimeout(() => document.getElementById('erkennen')?.focus(), 50);
  }

  async function recognise() {
    if (!file) return;
    setBusy({ label: 'Datei wird gelesen …', value: 0.05 });
    try {
      const r = await fileToText(file, (p) => setBusy({ label: p.label, value: Math.min(0.8, p.value) }));
      if (r.kind === 'html') {
        setBusy({ label: 'Rezept wird erkannt …', value: 0.6 });
        if (!(await fromHtml(r.text, '', file.name, extras))) {
          toast('Die gespeicherte Seite enthält nur eine Vorschau – sie wurde vermutlich ohne Anmeldung gespeichert. Bitte im Club anmelden und erneut speichern.', 'fehler');
        }
        return;
      }
      if (r.ocr) toast('Gescannte Seiten wurden per Texterkennung gelesen – bitte besonders sorgfältig prüfen.', 'info');
      if (r.kind === 'doc') toast('Ältere Word-Datei: Der Text wurde nach bestem Vermögen gelesen – bitte prüfen (besser: als .docx oder PDF speichern).', 'info');
      await analyse(r.text, { type: r.ocr ? 'ocr' : r.kind === 'docx' || r.kind === 'doc' ? 'docx' : r.kind === 'txt' ? 'txt' : 'pdf', name: file.name });
    } catch (e: any) {
      toast(e.message || 'Die Datei konnte nicht gelesen werden.', 'fehler');
      Api.log(String(e.message), 'datei-import');
    } finally { setBusy(null); }
  }

  /** Link: öffentliche Seiten direkt, Club-Rezepte über Chrome + Lesezeichen */
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
      if (!(await fromHtml(r.html, r.url, url.hostname))) setWaiting({ url: url.toString(), reason: 'Die Seite zeigt ohne Anmeldung nur eine Vorschau.' });
    } catch (e: any) {
      setWaiting({ url: url.toString(), reason: `${e.message} – über Chrome klappt es trotzdem.` });
    } finally { setBusy(null); }
  }

  const fromClipboard = useCallback(async (silent = false) => {
    try {
      const t = await navigator.clipboard.readText();
      if (silent && !t.startsWith(IMPORT_MARK)) return;
      if (!t.trim()) { toast('Die Zwischenablage ist leer.', 'info'); return; }
      if (!t.startsWith(IMPORT_MARK)) { setText(t); setShowText(true); }
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

  // Ziehen & Ablegen überall auf der Seite (auch ganze Ordner)
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const enter = (e: DragEvent) => { if (has(e)) { e.preventDefault(); depth++; setDrag(true); } };
    const over = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (has(e) && --depth <= 0) { depth = 0; setDrag(false); } };
    const drop = async (e: DragEvent) => {
      if (!has(e)) return; e.preventDefault(); depth = 0; setDrag(false);
      chooseFiles(await filesFromDrop(e.dataTransfer!));
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  });

  const kindLabel = (f: File) => ({ html: 'Gespeicherte Webseite', pdf: 'PDF-Dokument', docx: 'Word-Dokument', doc: 'Word-Dokument (alt)', txt: 'Textdatei', image: 'Bild (Texterkennung)' } as Record<string, string>)[kindOf(f) ?? ''] ?? 'Datei';

  return (
    <div>
      <PageHeader title="Rezept importieren" subtitle="Rezept im Zaubertopf Club speichern, hier hochladen – den Rest erledigt die App." />

      {/* ============ 1) Schritt-für-Schritt-Anleitung ============ */}
      <section className="card mb-6 p-6" aria-labelledby="anleitung-titel">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="anleitung-titel" className="text-xl font-bold">So geht's – in 5 Schritten</h2>
          <span className="chip bg-sage-50 text-sage-700">{Object.values(guide.done).filter(Boolean).length} von 5 erledigt</span>
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost btn-sm" onClick={() => updateGuide(() => ({ open: true, done: {} }))}><RotateCcw size={16} /> Neu starten</button>
            <button className="btn-ghost btn-sm" onClick={() => updateGuide((g) => ({ ...g, open: !g.open }))} aria-expanded={guide.open}>
              {guide.open ? <><ChevronUp size={16} /> Einklappen</> : <><ChevronDown size={16} /> Anleitung zeigen</>}
            </button>
          </div>
        </div>
        {guide.open && (
          <ol className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-5">
            <GuideStep n={1} icon={<Search size={26} />} title="Öffne den Zaubertopf Club" done={!!guide.done[1]} active={firstOpen === 1}
              action={<button className="btn-primary btn-sm" onClick={() => { openInChrome(ZAUBERTOPF_URL); done(1); }}><ExternalLink size={16} /> Zaubertopf Club öffnen</button>}>
              Suche dir im Zaubertopf Club dein Lieblingsrezept aus und öffne es. Melde dich dort mit deinem Benutzerkonto an.
            </GuideStep>
            <GuideStep n={2} icon={<Save size={26} />} title="Speichere dein Rezept auf deinem PC" done={!!guide.done[2]} active={firstOpen === 2}
              action={!guide.done[2] && <button className="btn-ghost btn-sm" onClick={() => done(2)}><Check size={16} /> Erledigt</button>}>
              <p className="mb-2">Drücke auf der Rezeptseite gleichzeitig:</p>
              <p className="mb-3 flex items-center gap-2" aria-label="Strg plus S"><Kbd>Strg</Kbd><span className="text-lg font-bold">+</span><Kbd>S</Kbd></p>
              <ol className="mb-2 list-decimal space-y-0.5 pl-5 text-sm">
                <li>Das Fenster „Speichern unter“ öffnet sich.</li>
                <li>Speicherort wählen, z. B. <b>Desktop</b> oder <b>Downloads</b>.</li>
                <li>Dateityp <b>„Webseite, vollständig“</b> wählen.</li>
                <li>Auf <b>„Speichern“</b> klicken.</li>
              </ol>
              <p className="text-sm">Datei und Ordner „…_files“ gehören zusammen – bitte nicht trennen. Alternativ: <b>Strg + P → „Als PDF speichern“</b>.</p>
            </GuideStep>
            <GuideStep n={3} icon={<Upload size={26} />} title="Lade dein Rezept in Petras Rezepte App" done={!!guide.done[3]} active={firstOpen === 3}
              action={<button className="btn-ghost btn-sm" onClick={() => { uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); fileRef.current?.click(); }}><FileUp size={16} /> Datei auswählen</button>}>
              Ziehe die gespeicherte Rezeptdatei in das große Upload-Feld unten – oder klicke auf „Datei auswählen“. Danach auf <b>„Rezept jetzt erkennen“</b>.
            </GuideStep>
            <GuideStep n={4} icon={<ClipboardCheck size={26} />} title="Kontrolliere dein Rezept" done={!!guide.done[4]} active={firstOpen === 4}>
              Petras Rezepte App erkennt Zutaten, Mengen, Zeiten und Zubereitungsschritte automatisch. Im Rezepteditor kannst du alles prüfen, ändern, ergänzen und speichern.
            </GuideStep>
            <GuideStep n={5} icon={<Send size={26} />} title="Übertrage dein Rezept nach Cookidoo" done={!!guide.done[5]} active={firstOpen === 5}
              action={<>
                <button className="btn-primary btn-sm" onClick={() => { openInChrome(COOKIDOO_URL); done(5); }}><ExternalLink size={16} /> Cookidoo öffnen</button>
                <button className="btn-ghost btn-sm" onClick={() => go('cookidoo')}>Zum Assistenten</button>
              </>}>
              Übernimm dein fertiges Rezept in Cookidoo unter „Meine Kreationen“. Danach steht es auf deinem Thermomix TM6 bereit, sobald es gespeichert und synchronisiert ist.
            </GuideStep>
          </ol>
        )}
      </section>

      {/* ============ 2) Datei hochladen (Hauptfunktion) ============ */}
      <section ref={uploadRef} className={`card mb-6 p-7 md:p-9 transition ${drag ? 'ring-4 ring-sage-300' : firstOpen === 3 ? 'ring-4 ring-apricot-100' : ''}`} aria-labelledby="upload-titel">
        <div className="mb-6 flex flex-wrap items-start gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-sage-600 text-white"><FileUp size={28} /></div>
          <div>
            <h2 id="upload-titel" className="text-2xl font-bold">Rezeptdatei hochladen</h2>
            <p className="text-ink-soft">Speichere dein Lieblingsrezept vom Zaubertopf Club auf deinem PC und lade es hier hoch. Wir übernehmen den Rest!</p>
          </div>
        </div>

        {!file ? (
          <div className={`flex min-h-[300px] flex-col items-center justify-center gap-3 rounded-[28px] border-[3px] border-dashed p-10 text-center transition ${drag ? 'border-sage-600 bg-sage-50' : 'border-sage-300 bg-cream-100'}`}>
            <span className="grid h-20 w-20 place-items-center rounded-full bg-white text-sage-600 shadow-[var(--shadow-soft)]"><Upload size={40} /></span>
            <span className="text-2xl font-bold">Rezeptdatei hier ablegen</span>
            <span className="text-ink-soft">oder</span>
            <button className="btn-primary px-8 py-4 text-lg" onClick={() => fileRef.current?.click()}><FileUp size={20} /> Datei auswählen</button>
            <span className="mt-3 text-sm text-ink-soft">Unterstützte Dateien: PDF, HTML, Word, TXT und Bilder</span>
            <span className="flex flex-wrap justify-center gap-2 text-xs text-ink-soft">
              <span className="chip bg-white"><Globe size={13} /> HTML / HTM</span><span className="chip bg-white"><FileText size={13} /> PDF</span><span className="chip bg-white"><ScanText size={13} /> Scan (OCR)</span>
              <span className="chip bg-white"><FileType2 size={13} /> DOCX / DOC</span><span className="chip bg-white"><FileCode2 size={13} /> TXT</span><span className="chip bg-white"><ImageIcon size={13} /> JPG / PNG</span>
            </span>
          </div>
        ) : (
          <div className="rounded-[28px] border-2 border-sage-300 bg-sage-50/60 p-6">
            <div className="flex flex-wrap items-center gap-4">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-sage-600 shadow-sm">{kindOf(file) === 'pdf' ? <FileText size={28} /> : kindOf(file) === 'image' ? <ImageIcon size={28} /> : kindOf(file) === 'html' ? <Globe size={28} /> : <FileType2 size={28} />}</span>
              <div className="min-w-0 flex-1">
                <b className="block truncate text-lg">{file.name}</b>
                <span className="text-sm text-ink-soft">{kindLabel(file)} · {fmtSize(file.size)}{extras.length ? ` · ${extras.length} Bild${extras.length > 1 ? 'er' : ''} aus dem Ordner` : ''}</span>
              </div>
              <button className="btn-ghost btn-sm" onClick={() => { setFile(null); setExtras([]); }}><Trash2 size={16} /> Andere Datei</button>
            </div>
            <button id="erkennen" className="btn-accent mt-5 w-full py-5 text-xl" onClick={recognise}><Wand2 size={24} /> Rezept jetzt erkennen</button>
            {kindOf(file) === 'image' && <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft"><Info size={15} /> Fotos werden per Texterkennung gelesen – bitte das Ergebnis besonders sorgfältig prüfen.</p>}
          </div>
        )}
        <input ref={fileRef} type="file" hidden multiple aria-label="Rezeptdatei auswählen"
          accept=".pdf,.html,.htm,.mhtml,.docx,.doc,.txt,.jpg,.jpeg,.png,.webp,application/pdf,text/html,text/plain,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => { if (e.target.files?.length) chooseFiles(Array.from(e.target.files)); e.target.value = ''; }} />

        <label className={`mt-5 flex items-start gap-3 text-[15px] ${aiAvailable ? 'cursor-pointer' : 'opacity-70'}`}>
          <input type="checkbox" className="mt-1 h-5 w-5 accent-sage-600" disabled={!aiAvailable} checked={useAi && aiAvailable} onChange={(e) => setUseAi(e.target.checked)} />
          <span><b className="inline-flex items-center gap-1.5"><Sparkles size={16} className="text-apricot-500" /> Mit KI aufbereiten (optional)</b> – {aiAvailable ? 'hilft bei unübersichtlichen PDFs/Texten. KI-Einstellungen sind immer Vorschläge.' : 'ausgeschaltet; die normale Erkennung funktioniert ohne KI und kostenlos (Einstellungen → KI).'}</span>
        </label>
      </section>

      {/* ============ 3) + 4) Alternativen ============ */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-faint">Andere Wege</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h3 className="mb-1 flex items-center gap-2 text-lg font-bold"><Link2 size={20} className="text-sage-600" /> Rezept über Internetlink</h3>
          <p className="mb-3 text-sm text-ink-soft">Öffentliche Rezeptseiten liest die App direkt. Club-Rezepte über dein angemeldetes Chrome und das Lesezeichen.</p>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); fromLink(); }}>
            <input className="input min-w-52 flex-1 py-2.5" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" aria-label="Link zur Rezeptseite" inputMode="url" />
            <button className="btn-soft" disabled={!link.trim()}><Wand2 size={18} /> Rezept holen</button>
          </form>
          {waiting && (
            <div className="mt-4 rounded-2xl border-2 border-sage-300 bg-sage-50 p-4">
              <p className="mb-2 flex gap-2 text-sage-900"><Lock size={18} className="mt-0.5 shrink-0" /> {waiting.reason}</p>
              <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">
                <li><b>„Seite in Chrome öffnen“</b> (dort bist du angemeldet).</li>
                <li>Lesezeichen <b>„➜ Petras Rezepte“</b> → <b>„Für die App kopieren“</b>.</li>
                <li>Zurück zu diesem Fenster – das Rezept wird automatisch übernommen.</li>
              </ol>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary btn-sm" onClick={() => openInChrome(waiting.url)}><ExternalLink size={16} /> Seite in Chrome öffnen</button>
                <button className="btn-ghost btn-sm" onClick={() => fromClipboard(false)}><ClipboardPaste size={16} /> Aus Zwischenablage einfügen</button>
                <button className="btn-ghost btn-sm" onClick={() => setWaiting(null)} aria-label="Abbrechen"><X size={16} /></button>
              </div>
              <p className="mt-2 flex items-center gap-2 text-xs text-ink-soft"><Loader2 size={13} className="animate-spin" /> Warte auf das Rezept … <button className="font-semibold text-sage-700 underline" onClick={() => go('einstellungen')}>Lesezeichen einrichten</button></p>
            </div>
          )}
        </section>

        <section className="card p-6">
          <h3 className="mb-1 flex items-center gap-2 text-lg font-bold"><ClipboardPaste size={20} className="text-sage-600" /> Rezepttext einfügen</h3>
          <p className="mb-3 text-sm text-ink-soft">Rezept markieren, kopieren (Strg + C) und hier einfügen (Strg + V).</p>
          {showText || text ? (
            <>
              <textarea className="input mb-3 min-h-[180px] resize-y text-[15px] leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} autoFocus
                placeholder={'Rezept hier einfügen …\n\nZutaten\n500 g Mehl\n…\nZubereitung\n1. Milch, Hefe und Zucker 2 Min. | 37 °C | Stufe 2 erwärmen.'} aria-label="Rezepttext" />
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost btn-sm" onClick={() => fromClipboard(false)}><ClipboardPaste size={16} /> Aus Zwischenablage</button>
                <button className="btn-soft flex-1" disabled={!text.trim()} onClick={() => analyse(text, { type: 'text', name: 'eingefügter Text' })}><Wand2 size={18} /> Rezept erkennen</button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button className="btn-soft" onClick={() => setShowText(true)}><ClipboardPaste size={18} /> Text einfügen</button>
              <button className="btn-ghost" onClick={() => fromClipboard(false)}>Aus Zwischenablage einfügen</button>
            </div>
          )}
        </section>
      </div>

      <button className="card mt-6 flex w-full items-start gap-4 p-5 text-left hover:shadow-[var(--shadow-lift)]" onClick={() => go('einstellungen')}>
        <Bookmark className="mt-0.5 shrink-0 text-sage-600" />
        <div><b>Tipp: Lesezeichen „➜ Petras Rezepte“</b><p className="text-sm text-ink-soft">Liest Rezepte direkt auf der Seite (auch angemeldet im Club, inkl. Kochmodus) und füllt den Cookidoo-Editor aus. Einrichten unter Einstellungen.</p></div>
      </button>

      {busy && <ProgressOverlay label={busy.label} value={busy.value} />}
    </div>
  );
}
