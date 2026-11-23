import { useEffect, useState } from 'react';
import { FileDown, BookOpen, Heart, Send, ArrowRight, PencilLine } from 'lucide-react';
import { type RecipeSummary } from '../../../shared/model.ts';
import { Api, type Stats } from '../lib/api.ts';
import { go } from '../lib/router.ts';
import { useSession, useCategories } from '../lib/session.tsx';
import { lookOf } from '../components/recipe-bits.tsx';
import { RecipeCard } from '../components/recipe-bits.tsx';
import { useToast } from '../components/ui.tsx';

function greeting(): string {
  const h = new Date().getHours();
  return h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : 'Guten Abend';
}

export function Dashboard() {
  const { session } = useSession();
  const categories = useCategories();
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<RecipeSummary[]>([]);
  const [favs, setFavs] = useState<RecipeSummary[]>([]);
  const [draft, setDraft] = useState<{ title: string; updatedAt: string } | null>(null);
  const name = session?.profiles.find((p) => p.id === session.profileId)?.name ?? '';

  const load = () => {
    Api.stats().then(setStats).catch((e) => toast(e.message, 'fehler'));
    Api.list({ limit: 4 }).then(setRecent).catch(() => {});
    Api.list({ favorite: 1, sort: 'name', limit: 4 }).then(setFavs).catch(() => {});
    Api.draft().then((d) => setDraft(d?.data?.recipe?.title || d?.data?.recipe?.steps?.length ? { title: d.data.recipe.title || 'Ohne Namen', updatedAt: d.updatedAt } : null)).catch(() => {});
  };
  useEffect(load, [session?.profileId]);

  const fav = async (r: RecipeSummary) => { await Api.favorite(r.id, !r.favorite); load(); };

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-sage-600 to-sage-700 px-8 py-10 text-white shadow-[var(--shadow-lift)] md:px-12 md:py-12">
        <div className="pointer-events-none absolute -right-10 -top-10 text-[220px] leading-none opacity-15 select-none" aria-hidden>🍲</div>
        <p className="mb-2 text-sage-100">{greeting()}{name ? `, ${name}` : ''}!</p>
        <h1 className="mb-8 max-w-xl text-[40px] font-bold leading-tight">Was kochen wir heute?</h1>
        <div className="flex flex-wrap gap-3">
          <button className="btn bg-white px-7 py-4 text-lg text-sage-700 shadow-lg hover:bg-cream-100" onClick={() => go('importieren')}>
            <FileDown size={22} /> Neues Rezept importieren
          </button>
          <button className="btn border border-white/40 px-6 py-4 text-white hover:bg-white/10" onClick={() => go('rezepte')}>
            <BookOpen size={20} /> Meine Rezepte
          </button>
        </div>
      </section>

      {draft && (
        <div className="card flex flex-wrap items-center justify-between gap-4 border-apricot-300 bg-apricot-100/50 p-5">
          <div className="flex items-center gap-3"><PencilLine className="text-apricot-700" />
            <div><b>Nicht gespeichertes Rezept: „{draft.title}“</b><p className="text-sm text-ink-soft">Automatisch zwischengespeichert – du kannst genau dort weitermachen.</p></div></div>
          <button className="btn-accent" onClick={() => go('neu')}>Weiter bearbeiten</button>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Gespeicherte Rezepte', value: stats?.total, icon: BookOpen, path: 'rezepte', tone: 'bg-sage-50 text-sage-700' },
          { label: 'Favoriten', value: stats?.favorites, icon: Heart, path: 'favoriten', tone: 'bg-apricot-100 text-apricot-700' },
          { label: 'In Cookidoo übertragen', value: stats?.transferred, icon: Send, path: 'cookidoo', tone: 'bg-cream-200 text-ink' },
        ].map((t) => (
          <button key={t.label} onClick={() => go(t.path)} className="card flex items-center gap-4 p-5 text-left transition hover:shadow-[var(--shadow-lift)]">
            <div className={`grid h-14 w-14 place-items-center rounded-2xl ${t.tone}`}><t.icon size={26} /></div>
            <div><div className="text-3xl font-bold">{t.value ?? '–'}</div><div className="text-ink-soft">{t.label}</div></div>
          </button>
        ))}
      </section>

      <Section title="Zuletzt hinzugefügt" link="rezepte">
        {recent.length ? <Grid>{recent.map((r) => <RecipeCard key={r.id} r={r} onFavorite={fav} />)}</Grid>
          : <div className="card flex flex-wrap items-center justify-center gap-4 p-8 text-center text-ink-soft">
              <span>Noch keine Rezepte – importiere dein erstes Rezept aus dem Zaubertopf Club!</span>
              <button className="btn-ghost btn-sm" onClick={async () => {
                try {
                  const data = await (await fetch('/beispielrezepte.json')).json();
                  const res = await Api.importJson(data);
                  toast(`${res.imported} Beispielrezepte geladen`); load();
                } catch (e: any) { toast(e.message, 'fehler'); }
              }}>Beispielrezepte laden</button>
            </div>}
      </Section>

      {favs.length > 0 && (
        <Section title="Meine Favoriten" link="favoriten">
          <Grid>{favs.map((r) => <RecipeCard key={r.id} r={r} onFavorite={fav} />)}</Grid>
        </Section>
      )}

      <Section title="Rezeptkategorien">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((c) => (
            <button key={c} onClick={() => go(`rezepte?kategorie=${encodeURIComponent(c)}`)}
              className="card flex items-center gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: `linear-gradient(135deg, ${lookOf(c).from}, ${lookOf(c).to})` }}>{lookOf(c).emoji}</span>
              <span className="min-w-0"><b className="block truncate">{c}</b><span className="text-sm text-ink-soft">{stats?.byCategory[c] ?? 0} Rezepte</span></span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, link, children }: { title: string; link?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-2xl font-bold">{title}</h2>
        {link && <button className="flex items-center gap-1 font-semibold text-sage-600 hover:text-sage-700" onClick={() => go(link)}>Alle ansehen <ArrowRight size={18} /></button>}
      </div>
      {children}
    </section>
  );
}
const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
