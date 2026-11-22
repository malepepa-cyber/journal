import { useEffect, useRef, useState, type ReactNode } from 'react';
import { User, Globe, Sparkles, DatabaseBackup, Trash2, Info, Power, Plus, Download, Upload, RotateCcw, Bookmark, KeyRound, Check } from 'lucide-react';
import type { RecipeSummary } from '../../../shared/model.ts';
import { Api, downloadExport, type BackupInfo } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { PageHeader, useConfirm, useToast } from '../components/ui.tsx';

const MARKETS = [
  { label: 'Deutschland (cookidoo.de)', url: 'https://cookidoo.de/created-recipes/de-DE' },
  { label: 'Österreich (cookidoo.at)', url: 'https://cookidoo.at/created-recipes/de-AT' },
  { label: 'Schweiz (cookidoo.ch)', url: 'https://cookidoo.ch/created-recipes/de-CH' },
];

function Panel({ icon, title, children, id }: { icon: ReactNode; title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="card p-7">
      <h2 className="mb-5 flex items-center gap-3 text-xl font-bold"><span className="grid h-10 w-10 place-items-center rounded-xl bg-sage-50 text-sage-600">{icon}</span>{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-4 rounded-2xl bg-cream-100 p-4">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-sage-600' : 'bg-cream-300'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </button>
      <span><b className="block">{label}</b>{hint && <span className="text-sm text-ink-soft">{hint}</span>}</span>
    </label>
  );
}

/** Zieh-Link für das Lesezeichen (React blockiert javascript:-Links, daher per Attribut gesetzt). */
function BookmarkletLink() {
  const ref = useRef<HTMLAnchorElement>(null);
  const toast = useToast();
  useEffect(() => { Api.bookmarklet().then(({ code }) => ref.current?.setAttribute('href', code)).catch((e) => toast(e.message, 'fehler')); }, []);
  return (
    <a ref={ref} href="#" draggable onClick={(e) => { e.preventDefault(); toast('Nicht anklicken – mit der Maus in die Lesezeichenleiste ziehen.', 'info'); }}
      className="inline-flex cursor-grab items-center gap-2 rounded-2xl bg-sage-600 px-5 py-3 font-bold text-white no-underline shadow-[0_6px_18px_rgba(78,122,76,.3)]">
      <Bookmark size={18} /> ➜ Petras Rezepte
    </a>
  );
}

export function SettingsPage() {
  const { session, reload } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [trash, setTrash] = useState<RecipeSummary[]>([]);
  const [key, setKey] = useState('');
  const [newProfile, setNewProfile] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const loadLists = () => { Api.backups().then(setBackups).catch(() => {}); Api.trash().then(setTrash).catch(() => {}); };
  useEffect(loadLists, [session?.profileId]);
  if (!session) return null;
  const s = session.settings;
  const save = async (patch: Partial<typeof s>) => { try { await Api.settings(patch); await reload(); toast('Gespeichert'); } catch (e: any) { toast(e.message, 'fehler'); } };
  const current = session.profiles.find((p) => p.id === session.profileId);

  return (
    <div>
      <PageHeader title="Einstellungen" subtitle="Profile, Cookidoo, KI, Datensicherung" />
      <div className="grid gap-6 xl:grid-cols-2">

        <Panel icon={<User />} title="Profil">
          <div className="space-y-2">
            {session.profiles.map((p) => (
              <div key={p.id} className={`flex items-center gap-3 rounded-2xl p-3 ${p.id === session.profileId ? 'bg-sage-50 ring-2 ring-sage-300' : 'bg-cream-100'}`}>
                <span className="grid h-10 w-10 place-items-center rounded-full bg-white font-bold text-sage-700">{p.name.slice(0, 1).toUpperCase()}</span>
                <b className="flex-1">{p.name}</b>
                {p.id === session.profileId ? <span className="chip bg-sage-600 text-white"><Check size={14} /> aktiv</span>
                  : <button className="btn-soft btn-sm" onClick={async () => { await Api.selectProfile(p.id); await reload(); toast(`Profil „${p.name}“ aktiv`); }}>Wechseln</button>}
                <button className="btn-ghost btn-sm" onClick={async () => { const n = prompt('Neuer Name', p.name); if (n?.trim()) { await Api.renameProfile(p.id, n); reload(); } }}>Umbenennen</button>
                {session.profiles.length > 1 && p.id !== session.profileId && (
                  <button className="btn-ghost btn-sm text-red-700" onClick={async () => {
                    if (await confirm({ title: 'Profil löschen?', text: <>Alle Rezepte von „{p.name}“ werden gelöscht. Vorher wird automatisch eine Sicherung erstellt.</>, ok: 'Löschen', danger: true })) {
                      await Api.backup(); await Api.deleteProfile(p.id); reload(); toast('Profil gelöscht');
                    }
                  }}><Trash2 size={16} /></button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <input className="input" value={newProfile} onChange={(e) => setNewProfile(e.target.value)} placeholder="Neues Profil, z. B. Name" />
            <button className="btn-primary" disabled={!newProfile.trim()} onClick={async () => { await Api.createProfile(newProfile); setNewProfile(''); reload(); toast('Profil angelegt'); }}><Plus size={18} /> Anlegen</button>
          </div>
          <p className="mt-3 text-sm text-ink-soft">Jedes Profil hat eigene Rezepte und Einstellungen – praktisch, wenn mehrere Personen die App nutzen. Aktuell: <b>{current?.name}</b>.</p>
        </Panel>

        <Panel icon={<Globe />} title="Cookidoo">
          <label className="block"><span className="label">Cookidoo-Land</span>
            <select className="input" value={s.cookidooUrl} onChange={(e) => save({ cookidooUrl: e.target.value })}>
              {MARKETS.map((m) => <option key={m.url} value={m.url}>{m.label}</option>)}
            </select></label>
          <p className="mt-3 text-sm text-ink-soft">Die App speichert <b>keine</b> Cookidoo-Zugangsdaten. Du meldest dich ganz normal in Chrome bei Cookidoo an.</p>

          <div className="mt-5 rounded-2xl bg-cream-100 p-4">
            <b className="mb-1 block">Lesezeichen „➜ Petras Rezepte“</b>
            <p className="mb-3 text-sm text-ink-soft">Auf einer Rezeptseite (z. B. Zaubertopf Club) anklicken → Rezept wird für die App kopiert. Einrichten: Lesezeichenleiste mit <b>Strg + Umschalt + B</b> einblenden und diesen Knopf hineinziehen:</p>
            <BookmarkletLink />
          </div>

          <div className="mt-5">
            <Toggle checked={s.experimentalTransfer} label="Schnellübertragung (experimentell)"
              hint={<>Speichert Rezepte über das Lesezeichen direkt in „Meine Kreationen“. Nutzt die Schnittstelle der Cookidoo-Webseite, die <b>nicht offiziell dokumentiert</b> ist und sich jederzeit ändern kann. Standardmäßig aus – der Assistent funktioniert immer.</>}
              onChange={async (v) => {
                if (v && !(await confirm({ title: 'Experimentelle Schnellübertragung einschalten?', ok: 'Ja, einschalten',
                  text: <div className="space-y-2"><p>Vorwerk bietet keine offizielle Schnittstelle. Die Schnellübertragung verwendet dieselben Anfragen wie die Cookidoo-Webseite in deinem angemeldeten Browser (3–5 Anfragen pro Rezept, kein Passwort, kein fremder Server).</p><p>Das ist nicht offiziell unterstützt und kann jederzeit aufhören zu funktionieren. Prüfe übertragene Rezepte in Cookidoo. Die Nutzung erfolgt auf eigene Verantwortung.</p></div> }))) return;
                save({ experimentalTransfer: v });
              }} />
          </div>
        </Panel>

        <Panel icon={<Sparkles />} title="KI-Unterstützung (optional)">
          <Toggle checked={s.aiEnabled} onChange={(v) => save({ aiEnabled: v })} label="KI beim Import anbieten"
            hint="Für schwierige Rezepte. Benötigt einen eigenen Claude-API-Schlüssel von Anthropic (kostenpflichtig pro Nutzung). Ohne KI funktioniert alles kostenlos." />
          {s.aiEnabled && (
            <div className="mt-4 space-y-3">
              <label className="block"><span className="label flex items-center gap-2"><KeyRound size={15} /> API-Schlüssel {session.aiKey && <span className="chip bg-sage-50 text-sage-700"><Check size={13} /> hinterlegt</span>}</span>
                <div className="flex gap-2">
                  <input className="input font-mono" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={session.aiKey ? '•••••••• (gespeichert)' : 'sk-ant-…'} autoComplete="off" />
                  <button className="btn-primary" disabled={!key.trim()} onClick={async () => { try { await Api.setAiKey(key); setKey(''); reload(); toast('Schlüssel sicher gespeichert'); } catch (e: any) { toast(e.message, 'fehler'); } }}>Speichern</button>
                </div></label>
              {session.aiKey && <button className="btn-ghost btn-sm text-red-700" onClick={async () => { await Api.setAiKey(''); reload(); toast('Schlüssel entfernt'); }}>Schlüssel entfernen</button>}
              <label className="block"><span className="label">Modell</span>
                <select className="input" value={s.aiModel} onChange={(e) => save({ aiModel: e.target.value })}>
                  <option value="claude-opus-5-5">Claude Opus 5.5 (beste Qualität)</option>
                  <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (günstiger)</option>
                  <option value="claude-haiku-5-5">Claude Haiku 5.5 (am günstigsten)</option>
                </select></label>
              <p className="text-sm text-ink-soft">Der Schlüssel wird mit der Windows-Datenschutz-API verschlüsselt gespeichert und nie angezeigt. An die KI geht nur der Rezepttext.</p>
            </div>
          )}
        </Panel>

        <Panel icon={<DatabaseBackup />} title="Datensicherung">
          <Toggle checked={s.autoBackup} onChange={(v) => save({ autoBackup: v })} label="Automatisch täglich sichern" hint="Die letzten 20 Sicherungen werden aufbewahrt." />
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary btn-sm" onClick={async () => { await Api.backup(); loadLists(); toast('Sicherung erstellt'); }}><DatabaseBackup size={16} /> Jetzt sichern</button>
            <button className="btn-ghost btn-sm" onClick={() => downloadExport().catch((e) => toast(e.message, 'fehler'))}><Download size={16} /> Alle Rezepte exportieren</button>
            <button className="btn-ghost btn-sm" onClick={() => importRef.current?.click()}><Upload size={16} /> Rezepte importieren (.json)</button>
            <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              try { const r = await Api.importJson(JSON.parse(await f.text())); toast(`${r.imported} importiert, ${r.skipped} übersprungen (schon vorhanden)`); }
              catch (err: any) { toast(err.message || 'Datei ungültig', 'fehler'); } finally { e.target.value = ''; }
            }} />
          </div>
          <p className="mt-2 text-xs text-ink-soft">Tipp: Den Export regelmäßig auf einen USB-Stick oder in die Cloud kopieren.</p>
          <ul className="mt-4 max-h-56 space-y-1 overflow-y-auto">
            {backups.map((b) => (
              <li key={b.name} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-cream-100">
                <span className="flex-1">{new Date(b.createdAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} <span className="text-ink-faint">· {b.kind} · {(b.size / 1024).toFixed(0)} KB</span></span>
                <button className="btn-ghost btn-sm" onClick={async () => {
                  if (!(await confirm({ title: 'Sicherung wiederherstellen?', ok: 'Wiederherstellen', text: 'Der aktuelle Stand wird vorher automatisch gesichert – es geht nichts verloren.' }))) return;
                  try { await Api.restoreBackup(b.name); await reload(); loadLists(); toast('Sicherung wiederhergestellt'); } catch (e: any) { toast(e.message, 'fehler'); }
                }}><RotateCcw size={15} /> Wiederherstellen</button>
              </li>
            ))}
            {!backups.length && <li className="text-sm text-ink-soft">Noch keine Sicherung vorhanden.</li>}
          </ul>
        </Panel>

        <Panel icon={<Trash2 />} title={`Papierkorb (${trash.length})`}>
          {trash.length ? (
            <ul className="space-y-1">
              {trash.map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-cream-100">
                  <span className="flex-1 truncate">{t.title}</span>
                  <button className="btn-soft btn-sm" onClick={async () => { await Api.restore(t.id); loadLists(); toast('Wiederhergestellt'); }}><RotateCcw size={15} /> Zurückholen</button>
                  <button className="btn-ghost btn-sm text-red-700" onClick={async () => { if (await confirm({ title: 'Endgültig löschen?', text: `„${t.title}“ wird endgültig gelöscht.`, ok: 'Endgültig löschen', danger: true })) { await Api.purge(t.id); loadLists(); } }}><Trash2 size={15} /></button>
                </li>
              ))}
            </ul>
          ) : <p className="text-ink-soft">Leer. Gelöschte Rezepte bleiben hier 30 Tage, dann werden sie automatisch entfernt.</p>}
        </Panel>

        <Panel icon={<Info />} title="Über die App">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[15px]">
            <dt className="text-ink-soft">Version</dt><dd>{session.version}</dd>
            <dt className="text-ink-soft">Daten</dt><dd className="break-all font-mono text-sm">{session.dataDir}</dd>
            <dt className="text-ink-soft">Entwickler</dt><dd>© Patrick S.</dd>
          </dl>
          <p className="mt-4 text-sm text-ink-soft">Alle Rezepte bleiben lokal auf diesem PC. Importierte Rezepte sind nur für den privaten Gebrauch – bitte keine fremden Rezepte oder Bilder weiterverbreiten. Thermomix® und Cookidoo® sind Marken der Vorwerk-Gruppe; diese App steht in keiner Verbindung zu Vorwerk.</p>
          <p className="mt-2 text-xs text-ink-faint">Enthält Open-Source-Software: React (MIT), pdf.js (Apache-2.0), Tesseract.js (Apache-2.0), mammoth (BSD-2), lucide (ISC), Anthropic SDK (MIT). Details in LIZENZEN.txt im Programmordner.</p>
          <button className="btn-ghost mt-5" onClick={async () => { await Api.shutdown(); document.body.innerHTML = '<div style="font:20px Segoe UI,sans-serif;text-align:center;margin-top:20vh">Petras Rezepte App wurde beendet.<br><small>Dieses Fenster kann geschlossen werden.</small></div>'; }}>
            <Power size={18} /> App beenden
          </button>
        </Panel>
      </div>
    </div>
  );
}
