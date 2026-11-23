/** Einstellungen → „Geräte und Synchronisierung“ */
import { useEffect, useState } from 'react';
import { Cloud, Laptop, Monitor, RefreshCw, LogOut, KeyRound, Copy, Check, Trash2, Link2, DatabaseBackup, RotateCcw, Pencil, ExternalLink, ShieldCheck } from 'lucide-react';
import { Api, openInChrome, type DeviceInfo } from '../lib/api.ts';
import { useSync, SYNC_TEXT, fmtWhen } from '../lib/sync.tsx';
import { useConfirm, useToast } from './ui.tsx';

function CopyField({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-cream-100 p-2 pl-4">
      <code className="min-w-0 flex-1 truncate text-sm" title={value}>{value}</code>
      <button className="btn-soft btn-sm" onClick={async () => { await navigator.clipboard.writeText(value).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1500); }}>
        {done ? <><Check size={15} /> Kopiert</> : <><Copy size={15} /> Kopieren</>}
      </button>
    </div>
  );
}

export function SyncSettings() {
  const { status: s, refresh, syncNow } = useSync();
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<'code' | 'project'>('code');
  const [code, setCode] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [myCode, setMyCode] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  const loadDevices = () => Api.syncDevices().then(setDevices).catch(() => setDevices(null));
  useEffect(() => { if (s?.signedIn) { loadDevices(); Api.syncCode().then((r) => setMyCode(r.code)).catch(() => {}); } }, [s?.signedIn, s?.lastSync]);
  if (!s) return null;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); } catch (e: any) { toast(e.message, 'fehler'); } finally { setBusy(false); await refresh(); }
  };

  // ---------- 1. Noch nicht eingerichtet ----------
  if (!s.configured) {
    return (
      <div className="space-y-4">
        <p className="text-ink-soft">Halte deine Rezepte auf PC und Notebook automatisch gleich – inklusive Bildern, Favoriten, Notizen und Kategorien.
          Jedes Gerät behält eine vollständige eigene Kopie und funktioniert auch ohne Internet.</p>
        <div className="flex rounded-2xl bg-cream-200 p-1 text-sm font-semibold">
          <button className={`flex-1 rounded-xl px-3 py-2 ${setup === 'code' ? 'bg-white shadow' : ''}`} onClick={() => setSetup('code')}>Ich habe einen Verbindungscode</button>
          <button className={`flex-1 rounded-xl px-3 py-2 ${setup === 'project' ? 'bg-white shadow' : ''}`} onClick={() => setSetup('project')}>Erstes Gerät einrichten</button>
        </div>
        {setup === 'code' ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">Den Code findest du auf dem bereits eingerichteten Gerät unter <b>Einstellungen → Geräte und Synchronisierung → Weiteres Gerät verbinden</b>.</p>
            <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="PRA1-…" aria-label="Verbindungscode" />
            <button className="btn-primary" disabled={busy || !code.trim()} onClick={() => run(() => Api.syncConfig({ code }), 'Verbunden – jetzt anmelden')}><Link2 size={18} /> Verbinden</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">Einmalig nötig: ein <b>kostenloses Firebase-Projekt</b> (Google, Spark-Tarif, ohne Zahlungsart – es können keine Kosten entstehen).
              Die Schritt-für-Schritt-Anleitung steht in <b>SYNC-ANLEITUNG</b> im Programmordner.</p>
            <button className="btn-ghost btn-sm" onClick={() => openInChrome('https://console.firebase.google.com/')}><ExternalLink size={16} /> Firebase-Konsole öffnen</button>
            <label className="block"><span className="label">Web-API-Schlüssel</span><input className="input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIza…" autoComplete="off" /></label>
            <label className="block"><span className="label">Projekt-ID</span><input className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="petras-rezepte-1234" autoComplete="off" /></label>
            <button className="btn-primary" disabled={busy || !apiKey || !projectId} onClick={() => run(() => Api.syncConfig({ apiKey, projectId }), 'Gespeichert – jetzt Konto anlegen')}><Cloud size={18} /> Speichern</button>
          </div>
        )}
      </div>
    );
  }

  // ---------- 2. Eingerichtet, nicht angemeldet ----------
  if (!s.signedIn) {
    return (
      <div className="space-y-4">
        {s.state === 'entfernt' && <p className="rounded-2xl bg-red-50 p-4 text-red-800">{s.message || 'Dieses Gerät wurde vom Konto getrennt.'} Zum Wiederverbinden einfach erneut anmelden.</p>}
        <div className="flex rounded-2xl bg-cream-200 p-1 text-sm font-semibold">
          {([['login', 'Anmelden'], ['register', 'Konto erstellen'], ['reset', 'Passwort vergessen']] as const).map(([m, l]) => (
            <button key={m} className={`flex-1 rounded-xl px-3 py-2 ${mode === m ? 'bg-white shadow' : ''}`} onClick={() => setMode(m)}>{l}</button>
          ))}
        </div>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'reset') run(() => Api.syncReset(email), 'E-Mail zum Zurücksetzen wurde gesendet.');
          else run(async () => { await (mode === 'register' ? Api.syncRegister(email, password) : Api.syncLogin(email, password)); setPassword(''); await syncNow(); }, mode === 'register' ? 'Konto erstellt – Synchronisierung läuft' : 'Angemeldet – Synchronisierung läuft');
        }}>
          <label className="block"><span className="label">E-Mail-Adresse</span><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          {mode !== 'reset' && <label className="block"><span className="label">Passwort {mode === 'register' && <span className="font-normal text-ink-soft">(mindestens 8 Zeichen)</span>}</span>
            <input className="input" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 8 : 1} /></label>}
          <button className="btn-primary" disabled={busy}>{mode === 'login' ? <><KeyRound size={18} /> Anmelden</> : mode === 'register' ? <><Cloud size={18} /> Konto erstellen</> : 'Link zum Zurücksetzen senden'}</button>
        </form>
        <p className="flex items-start gap-2 text-sm text-ink-soft"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-sage-600" />
          Das Passwort wird nicht gespeichert. Die App merkt sich nur einen verschlüsselten Anmeldeschlüssel (Windows-Datenschutz-API). Tipp: Auf PC und Notebook dasselbe Konto verwenden.</p>
        <button className="btn-ghost btn-sm" onClick={async () => { if (await confirm({ title: 'Projektdaten entfernen?', text: 'Die Rezepte bleiben erhalten. Danach kannst du ein anderes Projekt oder einen anderen Verbindungscode eintragen.', ok: 'Entfernen' })) run(() => Api.syncClearConfig()); }}>Anderes Projekt verwenden</button>
      </div>
    );
  }

  // ---------- 3. Angemeldet ----------
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-cream-100 p-4"><span className="label mb-0.5">Konto</span><b className="block truncate">{s.email}</b></div>
        <div className="rounded-2xl bg-cream-100 p-4"><span className="label mb-0.5">Status</span>
          <b className={`block ${s.state === 'fehler' ? 'text-red-700' : s.state === 'offline' ? 'text-apricot-700' : 'text-sage-700'}`}>{SYNC_TEXT[s.state]}</b>
          <span className="text-sm text-ink-soft">Zuletzt: {fmtWhen(s.lastSync)}{s.pending ? ` · ${s.pending} offen` : ''}</span>
          {s.lastError && s.state === 'fehler' && <span className="block text-sm text-red-700">{s.lastError}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary btn-sm" disabled={s.state === 'läuft'} onClick={() => syncNow()}><RefreshCw size={16} className={s.state === 'läuft' ? 'animate-spin' : ''} /> Jetzt synchronisieren</button>
        <button className="btn-ghost btn-sm" onClick={async () => { if (await confirm({ title: 'Abmelden?', text: 'Alle Rezepte bleiben auf diesem Gerät. Änderungen werden erst nach erneutem Anmelden wieder übertragen.', ok: 'Abmelden' })) run(() => Api.syncLogout(), 'Abgemeldet'); }}><LogOut size={16} /> Abmelden</button>
      </div>

      <div>
        <h3 className="mb-2 font-bold">Dieses Gerät</h3>
        {name === null ? (
          <div className="flex items-center gap-3 rounded-2xl bg-sage-50 p-4"><Monitor className="text-sage-700" /><b className="flex-1">{s.deviceName}</b>
            <button className="btn-ghost btn-sm" onClick={() => setName(s.deviceName)}><Pencil size={15} /> Umbenennen</button></div>
        ) : (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => Api.syncDeviceName(name), 'Gerätename gespeichert'); setName(null); }}>
            <input className="input flex-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} aria-label="Gerätename" autoFocus />
            <button className="btn-primary btn-sm">Speichern</button>
          </form>
        )}
      </div>

      <div>
        <h3 className="mb-2 font-bold">Verbundene Geräte</h3>
        <ul className="space-y-2">
          {(devices ?? []).map((d) => (
            <li key={d.id} className={`flex items-center gap-3 rounded-2xl p-3 ${d.removed ? 'bg-cream-100 opacity-60' : 'bg-cream-100'}`}>
              {/lap|note/i.test(d.name) ? <Laptop size={20} /> : <Monitor size={20} />}
              <span className="min-w-0 flex-1"><b className="block truncate">{d.name}{d.current ? ' (dieses Gerät)' : ''}</b>
                <span className="text-sm text-ink-soft">{d.removed ? 'getrennt' : `zuletzt aktiv: ${fmtWhen(d.lastSeen)}`}{d.appVersion ? ` · Version ${d.appVersion}` : ''}</span></span>
              {!d.current && !d.removed && (
                <button className="btn-ghost btn-sm text-red-700" onClick={async () => {
                  if (await confirm({ title: `„${d.name}“ entfernen?`, text: 'Das Gerät wird beim nächsten Start abgemeldet und erhält keine Änderungen mehr. Seine Rezepte bleiben dort erhalten.', ok: 'Entfernen', danger: true }))
                    run(async () => { await Api.syncRemoveDevice(d.id); await loadDevices(); }, 'Gerät entfernt');
                }}><Trash2 size={15} /> Entfernen</button>
              )}
            </li>
          ))}
          {devices === null && <li className="text-sm text-ink-soft">Geräteliste ist nur mit Internetverbindung verfügbar.</li>}
        </ul>
      </div>

      <details className="rounded-2xl border-2 border-sage-300 bg-sage-50/60 p-4">
        <summary className="cursor-pointer font-bold"><Link2 size={16} className="mr-1 inline" /> Weiteres Gerät verbinden (z. B. Notebook)</summary>
        <ol className="mt-3 list-decimal space-y-1 pl-6 text-[15px]">
          <li>Petras Rezepte App auf dem anderen Gerät installieren.</li>
          <li>Dort <b>Einstellungen → Geräte und Synchronisierung → „Ich habe einen Verbindungscode“</b> wählen.</li>
          <li>Diesen Code einfügen (er enthält kein Passwort):</li>
        </ol>
        {myCode && <div className="mt-2"><CopyField value={myCode} /></div>}
        <p className="mt-2 text-[15px]">4. Mit derselben E-Mail-Adresse und demselben Passwort anmelden – fertig.</p>
      </details>

      <div>
        <h3 className="mb-2 font-bold">Sicherung</h3>
        <div className="flex flex-wrap gap-2">
          <button className="btn-soft btn-sm" onClick={() => run(() => Api.backup(), 'Sicherung erstellt')}><DatabaseBackup size={16} /> Sicherung erstellen</button>
          <button className="btn-ghost btn-sm" onClick={() => document.getElementById('sicherung')?.scrollIntoView({ behavior: 'smooth' })}><RotateCcw size={16} /> Sicherung wiederherstellen …</button>
        </div>
        <p className="mt-2 text-sm text-ink-soft">Zusätzlich zur Cloud sichert jedes Gerät täglich lokal. Jede Änderung bleibt außerdem im Versionsverlauf des Rezepts.</p>
      </div>
    </div>
  );
}
