import { useEffect, useState } from 'react';
import type { TmMode, TmSetting } from '../../../shared/model.ts';
import { checkSetting, formatSetting } from '../../../shared/tm.ts';
import { Modal } from './ui.tsx';
import { TmPill } from './recipe-bits.tsx';

const MODES: { id: TmMode; label: string; hint: string }[] = [
  { id: 'manual', label: 'Manuell', hint: 'Zeit · Temperatur · Stufe' },
  { id: 'dough', label: 'Teig kneten', hint: 'Teigstufe' },
  { id: 'browning', label: 'Anbraten', hint: '120–160 °C' },
  { id: 'turbo', label: 'Turbo', hint: 'Impulse' },
];
const SPEEDS = ['soft', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10'];
const TEMPS: (number | 'Varoma' | null)[] = [null, 37, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 98, 100, 105, 110, 115, 120, 'Varoma'];
const BROWN_TEMPS = [120, 130, 140, 145, 150, 155, 160];

function Seg<T extends string | number | null>({ value, options, onChange, render }: { value: T; options: T[]; onChange: (v: T) => void; render: (v: T) => string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={String(o)} type="button" onClick={() => onChange(o)}
          className={`min-w-11 rounded-xl px-3 py-2 text-[15px] font-semibold transition ${value === o ? 'bg-sage-600 text-white' : 'bg-cream-200 text-ink hover:bg-cream-300'}`}>
          {render(o)}
        </button>
      ))}
    </div>
  );
}

export function SettingEditor({ open, initial, onClose, onSave, onDelete, title = 'Thermomix-Einstellung' }: {
  open: boolean; initial: TmSetting | null; onClose: () => void; onSave: (s: TmSetting) => void; onDelete?: () => void; title?: string;
}) {
  const [s, setS] = useState<TmSetting>({ mode: 'manual', time: 60, speed: '1' });
  const [min, setMin] = useState(1), [sec, setSec] = useState(0);
  useEffect(() => {
    if (!open) return;
    const v = initial ?? { mode: 'manual', time: 60, speed: '1' };
    setS({ ...v });
    const t = v.time ?? 0;
    setMin(Math.floor(t / 60)); setSec(Math.round(t % 60));
  }, [open, initial]);

  const time = min * 60 + sec || null;
  const result: TmSetting = { ...s, time: s.mode === 'turbo' ? (s.time ?? 1) : time };
  const warnings = checkSetting(result);
  const set = (p: Partial<TmSetting>) => setS((o) => ({ ...o, ...p }));

  return (
    <Modal open={open} onClose={onClose} title={title} wide
      footer={<>
        {onDelete && <button className="btn-ghost mr-auto text-red-700" onClick={onDelete}>Einstellung entfernen</button>}
        <button className="btn-ghost" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" onClick={() => onSave(result)}>Übernehmen</button>
      </>}>
      <div className="space-y-6">
        <div>
          <span className="label">Modus</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MODES.map((m) => (
              <button key={m.id} type="button" onClick={() => set({ mode: m.id, ...(m.id === 'browning' ? { temp: 160, speed: null, reverse: false } : {}), ...(m.id === 'dough' ? { temp: null, speed: null } : {}), ...(m.id === 'turbo' ? { time: 1, pulses: 2, temp: null, speed: null } : {}) })}
                className={`rounded-2xl border-2 p-3 text-left transition ${s.mode === m.id ? 'border-sage-600 bg-sage-50' : 'border-cream-300 hover:border-sage-300'}`}>
                <b className="block">{m.label}</b><span className="text-sm text-ink-soft">{m.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {s.mode === 'turbo' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div><span className="label">Impulsdauer</span><Seg value={s.time ?? 1} options={[0.5, 1, 2]} onChange={(v) => set({ time: v })} render={(v) => `${String(v).replace('.', ',')} Sek.`} /></div>
            <div><span className="label">Anzahl Impulse</span><Seg value={s.pulses ?? 1} options={[1, 2, 3, 4, 5, 6, 8, 10]} onChange={(v) => set({ pulses: v })} render={(v) => `${v}×`} /></div>
          </div>
        ) : (
          <div>
            <span className="label">Zeit</span>
            <div className="flex items-center gap-3">
              <input className="input w-24 text-center text-xl font-bold" type="number" min={0} max={99} value={min} onChange={(e) => setMin(Math.max(0, Math.min(99, Number(e.target.value) || 0)))} aria-label="Minuten" />
              <span className="text-ink-soft">Min.</span>
              <input className="input w-24 text-center text-xl font-bold" type="number" min={0} max={59} step={5} value={sec} onChange={(e) => setSec(Math.max(0, Math.min(59, Number(e.target.value) || 0)))} aria-label="Sekunden" />
              <span className="text-ink-soft">Sek.</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[[0, 5], [0, 10], [0, 30], [1, 0], [2, 0], [3, 0], [5, 0], [10, 0], [20, 0], [30, 0]].map(([m, se]) => (
                <button key={`${m}-${se}`} type="button" className="rounded-lg bg-cream-200 px-2.5 py-1 text-sm hover:bg-cream-300" onClick={() => { setMin(m); setSec(se); }}>
                  {m ? `${m} Min.` : `${se} Sek.`}
                </button>
              ))}
            </div>
          </div>
        )}

        {s.mode === 'manual' && (
          <>
            <div><span className="label">Temperatur</span><Seg value={s.temp ?? null} options={TEMPS} onChange={(v) => set({ temp: v })} render={(v) => (v == null ? 'aus' : v === 'Varoma' ? 'Varoma' : `${v}°`)} /></div>
            <div><span className="label">Stufe</span><Seg value={s.speed ?? null} options={SPEEDS} onChange={(v) => set({ speed: v })} render={(v) => (v === 'soft' ? '🥄 sanft' : String(v).replace('.', ','))} /></div>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-cream-200 p-4">
              <input type="checkbox" className="h-5 w-5 accent-sage-600" checked={!!s.reverse} onChange={(e) => set({ reverse: e.target.checked })} />
              <span><b>Linkslauf</b> <span className="text-ink-soft">– schonend rühren, Zutaten bleiben ganz</span></span>
            </label>
          </>
        )}
        {s.mode === 'browning' && (
          <div><span className="label">Temperatur</span><Seg value={(s.temp as number) ?? 160} options={BROWN_TEMPS} onChange={(v) => set({ temp: v })} render={(v) => `${v}°`} /></div>
        )}

        <div className="rounded-2xl bg-cream-200/70 p-4">
          <span className="label">So steht es im Rezept</span>
          <div className="flex flex-wrap items-center gap-3"><TmPill s={result} warn={warnings.length > 0} /><code className="text-sm text-ink-soft">{formatSetting(result)}</code></div>
          {warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-apricot-700">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      </div>
    </Modal>
  );
}
