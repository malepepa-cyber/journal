import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

// ---------------- Hinweise (Toasts) ----------------
type ToastKind = 'ok' | 'fehler' | 'info';
interface ToastMsg { id: number; text: string; kind: ToastKind }
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastMsg[]>([]);
  const show = useCallback((text: string, kind: ToastKind = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'fehler' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`flex items-center gap-3 rounded-2xl px-5 py-3 text-[15px] font-medium shadow-[var(--shadow-lift)] ${
            t.kind === 'fehler' ? 'bg-red-50 text-red-800 ring-1 ring-red-200' : t.kind === 'info' ? 'bg-ink text-cream-50' : 'bg-sage-900 text-white'}`}>
            {t.kind === 'fehler' ? <AlertTriangle size={18} /> : t.kind === 'info' ? <Info size={18} /> : <CheckCircle2 size={18} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------- Dialog ----------------
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}
      className={`m-auto rounded-[28px] bg-cream-50 p-0 text-ink shadow-[var(--shadow-lift)] backdrop:bg-ink/40 backdrop:backdrop-blur-sm`}
      style={{ width: `min(calc(100% - 2rem), ${wide ? 760 : 520}px)` }}>
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-4 px-7 pt-6 pb-3">
            <h2 className="text-xl font-bold">{title}</h2>
            <button onClick={onClose} className="rounded-xl p-2 text-ink-soft hover:bg-cream-200" aria-label="Schließen"><X size={20} /></button>
          </div>
          <div className="overflow-y-auto px-7 pb-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-3 border-t border-cream-300/70 px-7 py-4">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---------------- Bestätigen ----------------
interface ConfirmState { title: string; text: ReactNode; ok: string; danger?: boolean; resolve: (v: boolean) => void }
const ConfirmCtx = createContext<(o: Omit<ConfirmState, 'resolve'>) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<ConfirmState | null>(null);
  const ask = useCallback((o: Omit<ConfirmState, 'resolve'>) => new Promise<boolean>((resolve) => setS({ ...o, resolve })), []);
  const done = (v: boolean) => { s?.resolve(v); setS(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!s} onClose={() => done(false)} title={s?.title ?? ''}
        footer={<><button className="btn-ghost" onClick={() => done(false)}>Abbrechen</button>
          <button className={s?.danger ? 'btn bg-red-600 text-white hover:bg-red-700' : 'btn-primary'} onClick={() => done(true)}>{s?.ok}</button></>}>
        <div className="text-ink-soft">{s?.text}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

// ---------------- Fortschritt ----------------
export function ProgressOverlay({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-cream-100/80 backdrop-blur-sm">
      <div className="card w-[min(90vw,440px)] p-8 text-center">
        <div className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-4 border-sage-100 border-t-sage-600" />
        <p className="mb-4 text-lg font-semibold">{label}</p>
        {value != null && (
          <div className="h-3 overflow-hidden rounded-full bg-cream-200">
            <div className="h-full rounded-full bg-sage-600 transition-all" style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-8 py-14 text-center">
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-sage-50 text-sage-600">{icon}</div>
      <h3 className="mb-2 text-xl font-bold">{title}</h3>
      <p className="mb-6 max-w-md text-ink-soft">{text}</p>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[34px] font-bold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}
