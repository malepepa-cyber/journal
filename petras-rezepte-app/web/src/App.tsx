import { Component, type ReactNode } from 'react';
import { Home, FileDown, BookOpen, Heart, Send, Settings as Cog, ChefHat } from 'lucide-react';
import { useRoute, go } from './lib/router.ts';
import { useSession } from './lib/session.tsx';
import { Api } from './lib/api.ts';
import { Dashboard } from './pages/Dashboard.tsx';
import { ImportPage } from './pages/ImportPage.tsx';
import { Library } from './pages/Library.tsx';
import { Editor } from './pages/Editor.tsx';
import { Transfer } from './pages/Transfer.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

const NAV = [
  { path: '', label: 'Dashboard', icon: Home },
  { path: 'importieren', label: 'Rezept importieren', icon: FileDown },
  { path: 'rezepte', label: 'Meine Rezepte', icon: BookOpen },
  { path: 'favoriten', label: 'Favoriten', icon: Heart },
  { path: 'cookidoo', label: 'Cookidoo übertragen', icon: Send },
  { path: 'einstellungen', label: 'Einstellungen', icon: Cog },
];

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { Api.log(error.message, error.stack?.split('\n')[1] ?? ''); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card mx-auto mt-16 max-w-lg p-10 text-center">
        <h2 className="mb-3 text-2xl font-bold">Hoppla, da ist etwas schiefgelaufen.</h2>
        <p className="mb-6 text-ink-soft">Deine Rezepte sind sicher gespeichert. Ein Entwurf wird automatisch zwischengespeichert.</p>
        <button className="btn-primary" onClick={() => { this.setState({ error: null }); go(''); }}>Zurück zum Dashboard</button>
      </div>
    );
  }
}

export function App() {
  const route = useRoute();
  const { session, error } = useSession();
  const top = route[0] ?? '';
  const active = top === 'rezept' || top === 'neu' ? 'rezepte' : top;

  let page: ReactNode;
  switch (top) {
    case 'importieren': page = <ImportPage />; break;
    case 'rezepte': page = <Library mode="alle" />; break;
    case 'favoriten': page = <Library mode="favoriten" />; break;
    case 'rezept': page = <Editor key={route[1]} id={Number(route[1])} />; break;
    case 'neu': page = <Editor key="neu" id={null} />; break;
    case 'cookidoo': page = <Transfer key={route[1] ?? 'liste'} id={route[1] ? Number(route[1]) : null} />; break;
    case 'einstellungen': page = <SettingsPage />; break;
    default: page = <Dashboard />;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[272px] shrink-0 flex-col border-r border-cream-300/70 bg-cream-50 px-4 py-6 lg:flex">
        <button onClick={() => go('')} className="mb-8 flex items-center gap-3 px-3 text-left">
          <img src="/icon.svg" alt="" className="h-11 w-11" />
          <span className="text-[19px] font-bold leading-tight">Petras<br />Rezepte App</span>
        </button>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <button key={n.path} onClick={() => go(n.path)}
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-[16px] font-medium transition ${active === n.path ? 'bg-sage-600 text-white shadow-[0_6px_18px_rgba(78,122,76,.25)]' : 'text-ink hover:bg-cream-200'}`}>
              <n.icon size={20} /> {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl bg-sage-50 p-4 text-sm text-sage-900">
          <div className="mb-1 flex items-center gap-2 font-semibold"><ChefHat size={16} /> {session?.profiles.find((p) => p.id === session.profileId)?.name ?? '…'}</div>
          <p className="text-sage-700">Alle Daten bleiben auf diesem PC.</p>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* schmale Fenster: obere Leiste */}
        <nav className="sticky top-0 z-30 flex gap-1 overflow-x-auto border-b border-cream-300/70 bg-cream-50/95 px-3 py-2 backdrop-blur lg:hidden">
          {NAV.map((n) => (
            <button key={n.path} onClick={() => go(n.path)} title={n.label}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${active === n.path ? 'bg-sage-600 text-white' : 'text-ink'}`}>
              <n.icon size={18} /><span className="hidden sm:inline">{n.label}</span>
            </button>
          ))}
        </nav>
        <main className="mx-auto max-w-[1180px] px-6 py-8 lg:px-10 lg:py-10">
          {error && !session ? (
            <div className="card mx-auto mt-16 max-w-lg p-10 text-center">
              <h2 className="mb-3 text-2xl font-bold">Keine Verbindung</h2>
              <p className="text-ink-soft">{error}</p>
            </div>
          ) : <ErrorBoundary>{page}</ErrorBoundary>}
        </main>
        <footer className="pb-6 text-center text-xs text-ink-faint">Petras Rezepte App {session?.version} · © Patrick S. · Thermomix® und Cookidoo® sind Marken der Vorwerk-Gruppe; diese App ist kein Vorwerk-Produkt.</footer>
      </div>
    </div>
  );
}
