/** Statusanzeige der Synchronisierung (Seitenleiste) mit „Jetzt synchronisieren“. */
import { Cloud, CloudOff, RefreshCw, AlertTriangle, CheckCircle2, Laptop, Copy } from 'lucide-react';
import { useSync, SYNC_TEXT, fmtWhen } from '../lib/sync.tsx';
import { go } from '../lib/router.ts';

export function SyncBadge({ compact }: { compact?: boolean }) {
  const { status: s, syncNow } = useSync();
  if (!s) return null;
  const tone = s.state === 'ok' ? 'bg-sage-50 text-sage-900' : s.state === 'fehler' || s.state === 'entfernt' ? 'bg-red-50 text-red-800'
    : s.state === 'offline' ? 'bg-apricot-100 text-apricot-700' : 'bg-cream-100 text-ink';
  const Icon = s.state === 'ok' ? CheckCircle2 : s.state === 'läuft' ? RefreshCw : s.state === 'offline' ? CloudOff
    : s.state === 'fehler' || s.state === 'entfernt' ? AlertTriangle : s.state === 'aus' ? Laptop : Cloud;
  const active = s.signedIn && s.configured;
  if (compact) {
    return (
      <button onClick={() => (active ? syncNow() : go('einstellungen'))} title={`${SYNC_TEXT[s.state]} · zuletzt ${fmtWhen(s.lastSync)}`} aria-label={SYNC_TEXT[s.state]}
        className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium ${tone}`}>
        <Icon size={16} className={s.state === 'läuft' ? 'animate-spin' : ''} />{s.pending > 0 && <span>{s.pending}</span>}
      </button>
    );
  }
  return (
    <div className={`rounded-2xl p-4 text-sm ${tone}`} data-testid="sync-badge">
      <div className="mb-1 flex items-center gap-2 font-semibold"><Icon size={16} className={s.state === 'läuft' ? 'animate-spin' : ''} /> {SYNC_TEXT[s.state]}</div>
      {active ? (
        <>
          <p className="opacity-80">Zuletzt: {fmtWhen(s.lastSync)}{s.pending ? ` · ${s.pending} Änderung${s.pending > 1 ? 'en' : ''} offen` : ''}</p>
          {s.conflicts > 0 && <button className="mt-1 flex items-center gap-1 font-semibold underline" onClick={() => go('rezepte?konflikte=1')}><Copy size={14} /> {s.conflicts} Konflikt-Kopie{s.conflicts > 1 ? 'n' : ''} prüfen</button>}
          {s.lastError && s.state === 'fehler' && <p className="mt-1 text-xs">{s.lastError}</p>}
          <button className="mt-2 flex items-center gap-1.5 rounded-xl bg-white/80 px-3 py-1.5 font-semibold hover:bg-white disabled:opacity-60" disabled={s.state === 'läuft'} onClick={() => syncNow()}>
            <RefreshCw size={14} className={s.state === 'läuft' ? 'animate-spin' : ''} /> Jetzt synchronisieren
          </button>
        </>
      ) : (
        <>
          <p className="opacity-80">{s.state === 'entfernt' ? 'Die Rezepte auf diesem Gerät bleiben erhalten.' : 'Alle Daten bleiben auf diesem Gerät.'}</p>
          <button className="mt-2 font-semibold underline" onClick={() => go('einstellungen')}>{s.configured ? 'Anmelden' : 'Mit Notebook/PC synchronisieren'}</button>
        </>
      )}
    </div>
  );
}
