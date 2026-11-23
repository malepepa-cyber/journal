import { Clock, Heart, Users, CheckCircle2, CircleDashed, Loader } from 'lucide-react';
import type { Category, RecipeSummary, TmSetting } from '../../../shared/model.ts';
import { describeSetting } from '../../../shared/tm.ts';
import { photoUrl } from '../lib/api.ts';
import { go } from '../lib/router.ts';

/** Bildmotiv je Kategorie (wenn kein eigenes Foto vorhanden ist) */
export const CATEGORY_LOOK: Record<string, { emoji: string; from: string; to: string }> = {
  Hauptgerichte: { emoji: '🍲', from: '#F6D9C3', to: '#E9A77C' },
  Suppen: { emoji: '🥣', from: '#FBE7C4', to: '#EDB86A' },
  Salate: { emoji: '🥗', from: '#DDEBCF', to: '#9EC383' },
  Kuchen: { emoji: '🍰', from: '#F9DDE0', to: '#E7A8B0' },
  'Brot und Brötchen': { emoji: '🥖', from: '#F4E3C8', to: '#D6A86A' },
  Desserts: { emoji: '🍮', from: '#F7E1EC', to: '#D9A3C1' },
  Frühstück: { emoji: '🥐', from: '#FCEFD0', to: '#F0C46C' },
  Beilagen: { emoji: '🥔', from: '#EFE6D2', to: '#C9B58A' },
  Soßen: { emoji: '🫙', from: '#F8DCCF', to: '#DB8F6E' },
  Getränke: { emoji: '🥤', from: '#D9EEF0', to: '#88C3C9' },
  Sonstiges: { emoji: '🍽️', from: '#E9E5DB', to: '#BDB5A3' },
};

/** Aussehen einer Kategorie – eigene Kategorien bekommen ein neutrales Aussehen */
export const lookOf = (c: Category) => CATEGORY_LOOK[c] ?? CATEGORY_LOOK.Sonstiges;

export function RecipeVisual({ category, photo, className = '' }: { category: Category; photo: string | null; className?: string }) {
  const look = lookOf(category);
  const src = photo?.startsWith('data:') ? photo : photoUrl(photo);
  if (src) return <img src={src} alt="" className={`object-cover ${className}`} loading="lazy" />;
  return (
    <div className={`grid place-items-center ${className}`} style={{ background: `linear-gradient(135deg, ${look.from}, ${look.to})` }}>
      <span className="text-5xl drop-shadow-sm" aria-hidden>{look.emoji}</span>
    </div>
  );
}

export const fmtMin = (m: number | null | undefined) => {
  if (!m) return '';
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} Std.${r ? ` ${r} Min.` : ''}` : `${m} Min.`;
};

export function CookidooBadge({ status }: { status: string }) {
  if (status === 'übertragen') return <span className="chip bg-sage-50 text-sage-700"><CheckCircle2 size={14} /> In Cookidoo</span>;
  if (status === 'in Arbeit') return <span className="chip bg-apricot-100 text-apricot-700"><Loader size={14} /> Übertragung begonnen</span>;
  return <span className="chip bg-cream-200 text-ink-soft"><CircleDashed size={14} /> Noch nicht übertragen</span>;
}

export function RecipeCard({ r, onFavorite }: { r: RecipeSummary; onFavorite?: (r: RecipeSummary) => void }) {
  return (
    <article className="card group overflow-hidden transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
      <button className="block w-full text-left" onClick={() => go(`rezept/${r.id}`)}>
        <RecipeVisual category={r.category} photo={r.photo} className="h-40 w-full" />
        <div className="p-5 pb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-sage-600">{r.category}{r.conflict && <span className="ml-2 rounded-full bg-apricot-100 px-2 py-0.5 normal-case tracking-normal text-apricot-700">Konflikt-Kopie</span>}</p>
          <h3 className="line-clamp-2 min-h-[2.6em] text-lg font-bold leading-snug">{r.title}</h3>
        </div>
      </button>
      <div className="flex items-center justify-between gap-2 px-5 pb-5 text-sm text-ink-soft">
        <div className="flex items-center gap-4">
          {r.totalTime ? <span className="flex items-center gap-1"><Clock size={15} />{fmtMin(r.totalTime)}</span> : null}
          {r.servings ? <span className="flex items-center gap-1"><Users size={15} />{r.servings}</span> : null}
          {r.cookidooStatus === 'übertragen' && <span title="In Cookidoo" className="text-sage-600"><CheckCircle2 size={16} /></span>}
        </div>
        {onFavorite && (
          <button onClick={() => onFavorite(r)} aria-label={r.favorite ? 'Aus Favoriten entfernen' : 'Als Favorit merken'}
            className={`rounded-xl p-2 transition ${r.favorite ? 'text-apricot-500' : 'text-ink-faint hover:text-apricot-500'}`}>
            <Heart size={20} fill={r.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
    </article>
  );
}

/** Thermomix-Einstellung als Anzeige-Knopf */
export function TmPill({ s, warn, suggestion, onClick, title }: { s: TmSetting; warn?: boolean; suggestion?: boolean; onClick?: () => void; title?: string }) {
  const parts = describeSetting(s);
  const cls = suggestion
    ? 'tm-pill bg-white text-sage-700 ring-2 ring-dashed ring-sage-300'
    : warn ? 'tm-pill bg-apricot-100 text-apricot-700' : 'tm-pill';
  const content = parts.map((p, i) => <span key={i} className="flex items-center gap-1.5">{i > 0 && <span className="opacity-40">·</span>}{p}</span>);
  return onClick
    ? <button type="button" onClick={onClick} title={title ?? 'Einstellung bearbeiten'} className={`${cls} cursor-pointer hover:brightness-110`} style={suggestion ? { outline: '2px dashed var(--color-sage-300)' } : undefined}>{content}</button>
    : <span className={cls} title={title} style={suggestion ? { outline: '2px dashed var(--color-sage-300)' } : undefined}>{content}</span>;
}
