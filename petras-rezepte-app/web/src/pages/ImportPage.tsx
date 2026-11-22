import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, FileUp, Sparkles, Wand2, Bookmark, FileText, ScanText, FileType2, ImageIcon } from 'lucide-react';
import type { Recipe, SourceType } from '../../../shared/model.ts';
import { parseRecipeText } from '../../../shared/parser.ts';
import { Api } from '../lib/api.ts';
import { fileToText } from '../lib/importers.ts';
import { go } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { PageHeader, ProgressOverlay, useToast } from '../components/ui.tsx';

export const IMPORT_MARK = 'PETRAS-REZEPTE-IMPORT:';

/** Neues Rezept als Entwurf ablegen und im Editor öffnen. */
export async function openAsDraft(recipe: Recipe, notes: string[] = []) {
  await Api.saveDraft({ recipe, notes, createdAt: new Date().toISOString() });
  go('neu');
}

export function ImportPage() {
  const { session } = useSession();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<{ label: string; value: number | null } | null>(null);
  const [drag, setDrag] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const aiAvailable = !!session?.settings.aiEnabled && !!session?.aiKey;

  async function analyse(raw: string, source: { type: SourceType; name: string; url?: string }) {
    let t = raw.trim();
    if (t.startsWith(IMPORT_MARK)) {
      try { const p = JSON.parse(t.slice(IMPORT_MARK.length)); t = p.text; source = { type: 'web', name: p.title || 'Webseite', url: p.source }; } catch { /* normal weiter */ }
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

  async function onFile(file?: File | null) {
    if (!file) return;
    setBusy({ label: 'Datei wird geöffnet …', value: 0 });
    try {
      const r = await fileToText(file, (p) => setBusy({ label: p.label, value: p.value }));
      if (r.ocr) toast('Gescannte Seiten wurden per Texterkennung gelesen – bitte besonders sorgfältig prüfen.', 'info');
      await analyse(r.text, { type: r.ocr ? 'ocr' : r.kind === 'docx' ? 'docx' : r.kind === 'txt' ? 'txt' : 'pdf', name: file.name });
    } catch (e: any) {
      setBusy(null);
      toast(e.message || 'Die Datei konnte nicht gelesen werden.', 'fehler');
      Api.log(String(e.message), 'datei-import');
    } finally { if (fileRef.current) fileRef.current.value = ''; }
  }

  async function fromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) { toast('Die Zwischenablage ist leer.', 'info'); return; }
      setText(t.startsWith(IMPORT_MARK) ? '' : t);
      await analyse(t, { type: 'text', name: 'Zwischenablage' });
    } catch { toast('Bitte in das Textfeld klicken und Strg + V drücken.', 'info'); }
  }

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
      <PageHeader title="Rezept importieren" subtitle="Text einfügen oder eine Datei hochladen – die App erkennt Zutaten, Schritte und Thermomix-Einstellungen automatisch." />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col p-7">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sage-50 text-sage-600"><ClipboardPaste /></div>
            <div><h2 className="text-xl font-bold">Text einfügen</h2><p className="text-sm text-ink-soft">Im Zaubertopf Club markieren → Strg + C → hier Strg + V</p></div>
          </div>
          <textarea className="input mb-4 min-h-[260px] flex-1 resize-y text-[15px] leading-relaxed" value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'Rezept hier einfügen …\n\nZum Beispiel:\nHefezopf\nZutaten\n500 g Mehl\n…\nZubereitung\n1. Milch, Hefe und Zucker 2 Min./37°C/Stufe 2 erwärmen.'} aria-label="Rezepttext" />
          <div className="flex flex-wrap gap-3">
            <button className="btn-ghost" onClick={fromClipboard}><ClipboardPaste size={18} /> Aus Zwischenablage einfügen</button>
            <button className="btn-primary flex-1" disabled={!text.trim()} onClick={() => analyse(text, { type: 'text', name: 'eingefügter Text' })}><Wand2 size={18} /> Rezept erkennen</button>
          </div>
        </section>

        <section className={`card flex flex-col p-7 transition ${drag ? 'ring-4 ring-sage-300' : ''}`}>
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-apricot-100 text-apricot-700"><FileUp /></div>
            <div><h2 className="text-xl font-bold">PDF hochladen</h2><p className="text-sm text-ink-soft">Oder Word, TXT und Fotos – auch gescannte Seiten</p></div>
          </div>
          <button onClick={() => fileRef.current?.click()}
            className={`mb-4 flex min-h-[260px] flex-1 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed p-8 text-center transition ${drag ? 'border-sage-600 bg-sage-50' : 'border-cream-300 bg-cream-100 hover:border-sage-500 hover:bg-sage-50'}`}>
            <FileUp size={44} className="text-sage-600" />
            <span className="text-xl font-bold">Datei hierher ziehen</span>
            <span className="text-ink-soft">oder <u className="text-sage-700 underline-offset-4">Datei auswählen</u></span>
            <span className="mt-2 flex flex-wrap justify-center gap-2 text-xs text-ink-soft">
              <span className="chip bg-white"><FileText size={13} /> PDF</span><span className="chip bg-white"><ScanText size={13} /> Scan (OCR)</span>
              <span className="chip bg-white"><FileType2 size={13} /> Word</span><span className="chip bg-white"><ImageIcon size={13} /> Foto</span>
            </span>
          </button>
          <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.txt,image/jpeg,image/png,image/webp,application/pdf,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
          <details className="text-sm text-ink-soft">
            <summary className="cursor-pointer font-medium text-sage-700">Wie speichere ich ein Rezept als PDF?</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5"><li>Rezept im Zaubertopf Club öffnen.</li><li><b>Strg + P</b> drücken.</li><li>Ziel „<b>Als PDF speichern</b>“ wählen → Speichern.</li><li>PDF hierher ziehen.</li></ol>
          </details>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <label className={`card flex items-start gap-4 p-5 ${aiAvailable ? 'cursor-pointer' : 'opacity-70'}`}>
          <input type="checkbox" className="mt-1 h-5 w-5 accent-sage-600" disabled={!aiAvailable} checked={useAi && aiAvailable} onChange={(e) => setUseAi(e.target.checked)} />
          <div>
            <b className="flex items-center gap-2"><Sparkles size={18} className="text-apricot-500" /> Mit KI aufbereiten (optional)</b>
            <p className="text-sm text-ink-soft">{aiAvailable ? 'Hilft bei unübersichtlichen Rezepten. Thermomix-Vorschläge der KI musst du bestätigen.' : 'Ausgeschaltet. Die normale Erkennung funktioniert ohne KI und kostenlos. Einschalten unter Einstellungen → KI.'}</p>
          </div>
        </label>
        <button className="card flex items-start gap-4 p-5 text-left hover:shadow-[var(--shadow-lift)]" onClick={() => go('einstellungen')}>
          <Bookmark className="mt-0.5 shrink-0 text-sage-600" />
          <div><b>Noch schneller: Lesezeichen „➜ Petras Rezepte“</b><p className="text-sm text-ink-soft">Auf der Rezeptseite anklicken, dann hier „Aus Zwischenablage einfügen“. Einrichten unter Einstellungen.</p></div>
        </button>
      </div>

      {busy && <ProgressOverlay label={busy.label} value={busy.value} />}
    </div>
  );
}
