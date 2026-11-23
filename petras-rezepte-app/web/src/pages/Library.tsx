import { useEffect, useMemo, useState } from 'react';
import { Search, Heart, BookOpen, FileDown, LayoutGrid, List, Tags } from 'lucide-react';
import { CategoryManager } from '../components/CategoryManager.tsx';
import { useCategories } from '../lib/session.tsx';
import { type RecipeSummary } from '../../../shared/model.ts';
import { Api } from '../lib/api.ts';
import { go, useQuery } from '../lib/router.ts';
import { RecipeCard, RecipeVisual, CookidooBadge, fmtMin } from '../components/recipe-bits.tsx';
import { Empty, PageHeader, useToast } from '../components/ui.tsx';

export function Library({ mode }: { mode: 'alle' | 'favoriten' }) {
  const toast = useToast();
  const query = useQuery();
  const [list, setList] = useState<RecipeSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState(query.get('kategorie') ?? '');
  const [sort, setSort] = useState<'neu' | 'name' | 'geändert'>('neu');
  const categories = useCategories();
  const [manage, setManage] = useState(false);
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<'karten' | 'liste'>(() => (localStorage.getItem('pra.view') as 'karten' | 'liste') || 'karten');

  useEffect(() => { setCat(query.get('kategorie') ?? ''); }, [query]);
  useEffect(() => {
    const t = setTimeout(() => {
      Api.list({ q, category: cat, sort, favorite: mode === 'favoriten' ? 1 : undefined }).then(setList).catch((e) => toast(e.message, 'fehler'));
    }, 150);
    return () => clearTimeout(t);
  }, [q, cat, sort, mode, tick]);

  const fav = async (r: RecipeSummary) => {
    await Api.favorite(r.id, !r.favorite);
    setList((l) => (l ?? []).map((x) => (x.id === r.id ? { ...x, favorite: !r.favorite } : x)).filter((x) => mode !== 'favoriten' || x.favorite));
  };
  const counts = useMemo(() => list?.length ?? 0, [list]);
  const setV = (v: 'karten' | 'liste') => { setView(v); try { localStorage.setItem('pra.view', v); } catch { /* egal */ } };

  return (
    <div>
      <PageHeader title={mode === 'favoriten' ? 'Favoriten' : 'Meine Rezepte'}
        subtitle={list ? `${counts} Rezept${counts === 1 ? '' : 'e'}${cat ? ` in „${cat}“` : ''}` : ' '}
        actions={<button className="btn-primary" onClick={() => go('importieren')}><FileDown size={18} /> Rezept importieren</button>} />

      <div className="card mb-6 flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" size={20} />
          <input className="input border-0 bg-cream-100 pl-12" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen: Name, Zutat, Notiz …" aria-label="Rezepte suchen" />
        </div>
        <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sortierung">
          <option value="neu">Neueste zuerst</option><option value="name">Nach Name (A–Z)</option><option value="geändert">Zuletzt bearbeitet</option>
        </select>
        <div className="flex rounded-2xl bg-cream-200 p-1">
          <button className={`rounded-xl p-2 ${view === 'karten' ? 'bg-white shadow' : ''}`} onClick={() => setV('karten')} aria-label="Kartenansicht"><LayoutGrid size={18} /></button>
          <button className={`rounded-xl p-2 ${view === 'liste' ? 'bg-white shadow' : ''}`} onClick={() => setV('liste')} aria-label="Listenansicht"><List size={18} /></button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {['', ...categories].map((c) => (
          <button key={c || 'alle'} onClick={() => setCat(c)}
            className={`chip px-4 py-2 transition ${cat === c ? 'bg-sage-600 text-white' : 'bg-cream-50 text-ink ring-1 ring-cream-300 hover:ring-sage-300'}`}>{c || 'Alle'}</button>
        ))}
        <button onClick={() => setManage(true)} className="chip px-4 py-2 text-sage-700 border border-dashed border-sage-400 hover:bg-cream-100"><Tags size={16} /> Kategorien verwalten</button>
      </div>
      <CategoryManager open={manage} onClose={() => setManage(false)} onChanged={() => setTick((t) => t + 1)} />

      {list && list.length === 0 ? (
        mode === 'favoriten' && !q && !cat
          ? <Empty icon={<Heart />} title="Noch keine Favoriten" text="Tippe bei einem Rezept auf das Herz, dann findest du es hier wieder." action={<button className="btn-primary" onClick={() => go('rezepte')}>Zu meinen Rezepten</button>} />
          : <Empty icon={<BookOpen />} title={q || cat ? 'Nichts gefunden' : 'Noch keine Rezepte'} text={q || cat ? 'Versuche einen anderen Suchbegriff oder eine andere Kategorie.' : 'Importiere dein erstes Rezept – als Text oder PDF.'}
              action={<button className="btn-primary" onClick={() => go('importieren')}>Rezept importieren</button>} />
      ) : view === 'karten' ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{(list ?? []).map((r) => <RecipeCard key={r.id} r={r} onFavorite={fav} />)}</div>
      ) : (
        <div className="card divide-y divide-cream-300/70 overflow-hidden">
          {(list ?? []).map((r) => (
            <div key={r.id} className="flex items-center gap-4 p-3 hover:bg-cream-100">
              <button className="flex min-w-0 flex-1 items-center gap-4 text-left" onClick={() => go(`rezept/${r.id}`)}>
                <RecipeVisual category={r.category} photo={r.photo} className="h-14 w-14 shrink-0 rounded-2xl text-[0] [&_span]:text-2xl" />
                <span className="min-w-0"><b className="block truncate">{r.title}</b><span className="text-sm text-ink-soft">{r.category}{r.totalTime ? ` · ${fmtMin(r.totalTime)}` : ''}</span></span>
              </button>
              <span className="hidden md:block"><CookidooBadge status={r.cookidooStatus} /></span>
              <button onClick={() => fav(r)} className={`rounded-xl p-2 ${r.favorite ? 'text-apricot-500' : 'text-ink-faint'}`} aria-label="Favorit"><Heart size={20} fill={r.favorite ? 'currentColor' : 'none'} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
