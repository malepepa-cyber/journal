/** Synchronisierungsstatus für die ganze Oberfläche (fragt den lokalen Dienst regelmäßig ab). */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Api, type SyncStatus } from './api.ts';

interface Ctx { status: SyncStatus | null; refresh: () => Promise<void>; syncNow: () => Promise<SyncStatus | null> }
const SyncCtx = createContext<Ctx>({ status: null, refresh: async () => {}, syncNow: async () => null });
export const useSync = () => useContext(SyncCtx);

/** Seiten, die Rezeptlisten zeigen, laden nach einem Abgleich mit neuen Daten neu */
export function useAfterSync(fn: () => void) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    const h = () => ref.current();
    window.addEventListener('pra-synced', h);
    return () => window.removeEventListener('pra-synced', h);
  }, []);
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const last = useRef<string | null>(null);
  const apply = useCallback((s: SyncStatus) => {
    setStatus(s);
    if (s.lastSync && last.current && s.lastSync !== last.current) window.dispatchEvent(new Event('pra-synced'));
    last.current = s.lastSync;
  }, []);
  const refresh = useCallback(async () => { try { apply(await Api.syncStatus()); } catch { /* Dienst nicht erreichbar */ } }, [apply]);
  const syncNow = useCallback(async () => {
    setStatus((s) => (s ? { ...s, state: 'läuft', message: 'Synchronisierung läuft …' } : s));
    try { const s = await Api.syncNow(); apply(s); return s; } catch { await refresh(); return null; }
  }, [apply, refresh]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);
  return <SyncCtx.Provider value={{ status, refresh, syncNow }}>{children}</SyncCtx.Provider>;
}

export const SYNC_TEXT: Record<SyncStatus['state'], string> = {
  aus: 'Nur auf diesem Gerät', abgemeldet: 'Nicht angemeldet', bereit: 'Bereit', läuft: 'Synchronisierung läuft',
  ok: 'Synchronisiert', offline: 'Offline – Änderungen lokal gespeichert', fehler: 'Synchronisierung fehlgeschlagen', entfernt: 'Gerät wurde getrennt',
};

export function fmtWhen(iso: string | null): string {
  if (!iso) return 'noch nie';
  const d = new Date(iso); const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.round(diff / 60)} Min.`;
  if (diff < 86400 && d.getDate() === new Date().getDate()) return `heute, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
  return d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}
