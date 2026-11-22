import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Api, type Session } from './api.ts';

interface Ctx { session: Session | null; reload: () => Promise<void>; error: string | null }
const SessionCtx = createContext<Ctx>({ session: null, reload: async () => {}, error: null });
export const useSession = () => useContext(SessionCtx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { setSession(await Api.session()); setError(null); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => {
    reload();
    // Lebenszeichen an den lokalen Dienst (er beendet sich, wenn das Fenster lange zu ist)
    Api.heartbeat().catch(() => {});
    const t = setInterval(() => Api.heartbeat().catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, [reload]);
  return <SessionCtx.Provider value={{ session, reload, error }}>{children}</SessionCtx.Provider>;
}
