/** „Kategorien verwalten“: hinzufügen, umbenennen, sortieren, entfernen (Rezepte wandern nach „Sonstiges“). */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Api } from '../lib/api.ts';
import { useCategories, useSession } from '../lib/session.tsx';
import { lookOf } from './recipe-bits.tsx';
import { Modal, useConfirm, useToast } from './ui.tsx';

export function CategoryManager({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged?: () => void }) {
  const list = useCategories();
  const { reload } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [neu, setNeu] = useState('');
  const [edit, setEdit] = useState<{ from: string; to: string } | null>(null);

  const save = async (next: string[]) => {
    try { await Api.setCategories(next); await reload(); onChanged?.(); } catch (e: any) { toast(e.message, 'fehler'); }
  };
  const exists = (n: string) => list.some((c) => c.toLowerCase() === n.trim().toLowerCase());
  const add = async () => {
    const n = neu.trim();
    if (!n) return;
    if (exists(n)) { toast(`„${n}“ gibt es schon.`, 'fehler'); return; }
    await save([...list.filter((c) => c !== 'Sonstiges'), n, 'Sonstiges']);
    setNeu('');
  };
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= list.length) return;
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; save(next);
  };
  const rename = async () => {
    if (!edit) return;
    const to = edit.to.trim();
    if (!to || to === edit.from) { setEdit(null); return; }
    if (exists(to) && to.toLowerCase() !== edit.from.toLowerCase()) { toast(`„${to}“ gibt es schon.`, 'fehler'); return; }
    try {
      const r = await Api.renameCategory(edit.from, to);
      await reload(); onChanged?.(); setEdit(null);
      toast(r.changed ? `Umbenannt – ${r.changed} Rezept${r.changed === 1 ? '' : 'e'} angepasst.` : 'Umbenannt.');
    } catch (e: any) { toast(e.message, 'fehler'); }
  };
  const remove = async (c: string) => {
    if (!(await confirm({ title: `„${c}“ entfernen?`, text: 'Rezepte dieser Kategorie kommen nach „Sonstiges“. Es wird kein Rezept gelöscht.', ok: 'Entfernen', danger: true }))) return;
    try {
      const r = await Api.renameCategory(c, 'Sonstiges');
      await Api.setCategories(r.categories.filter((x, i, a) => x !== 'Sonstiges' || a.indexOf(x) === i));
      await reload(); onChanged?.();
      toast(r.changed ? `Entfernt – ${r.changed} Rezept${r.changed === 1 ? '' : 'e'} jetzt unter „Sonstiges“.` : 'Entfernt.');
    } catch (e: any) { toast(e.message, 'fehler'); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Kategorien verwalten" footer={<button className="btn-primary" onClick={onClose}>Fertig</button>}>
      <p className="mb-4 text-ink-soft">Lege eigene Kategorien an, benenne sie um oder ändere die Reihenfolge. Beim Entfernen bleiben die Rezepte erhalten.</p>
      <ul className="space-y-2" aria-label="Kategorien">
        {list.map((c, i) => (
          <li key={c} className="flex items-center gap-2 rounded-2xl bg-cream-100 p-2">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: `linear-gradient(135deg, ${lookOf(c).from}, ${lookOf(c).to})` }}>{lookOf(c).emoji}</span>
            {edit?.from === c ? (
              <>
                <input className="input flex-1 py-2" autoFocus value={edit.to} onChange={(e) => setEdit({ from: c, to: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setEdit(null); }} aria-label="Neuer Name" maxLength={40} />
                <button className="rounded-xl p-2 text-sage-700 hover:bg-white" onClick={rename} aria-label="Übernehmen"><Check size={18} /></button>
                <button className="rounded-xl p-2 hover:bg-white" onClick={() => setEdit(null)} aria-label="Abbrechen"><X size={18} /></button>
              </>
            ) : (
              <>
                <b className="flex-1 truncate">{c}</b>
                <button className="rounded-xl p-2 hover:bg-white disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${c} nach oben`}><ArrowUp size={18} /></button>
                <button className="rounded-xl p-2 hover:bg-white disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={`${c} nach unten`}><ArrowDown size={18} /></button>
                {c !== 'Sonstiges' && <>
                  <button className="rounded-xl p-2 hover:bg-white" onClick={() => setEdit({ from: c, to: c })} aria-label={`${c} umbenennen`}><Pencil size={18} /></button>
                  <button className="rounded-xl p-2 text-red-700 hover:bg-white" onClick={() => remove(c)} aria-label={`${c} entfernen`}><Trash2 size={18} /></button>
                </>}
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <input className="input flex-1" value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Neue Kategorie, z. B. Weihnachtsbäckerei" aria-label="Neue Kategorie" maxLength={40} />
        <button className="btn-soft" onClick={add} disabled={!neu.trim()}><Plus size={18} /> Hinzufügen</button>
      </div>
    </Modal>
  );
}
