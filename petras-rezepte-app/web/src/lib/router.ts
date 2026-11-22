/** Kleiner Hash-Router: #/, #/importieren, #/rezepte?kategorie=Suppen, #/rezept/12, #/neu, #/favoriten, #/cookidoo/12, #/einstellungen */
import { useEffect, useState } from 'react';

const parse = () => {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(query) };
};

export function useRoute(): string[] {
  const [route, setRoute] = useState(() => parse().parts);
  useEffect(() => {
    const on = () => setRoute(parse().parts);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function useQuery(): URLSearchParams {
  const [q, setQ] = useState(() => parse().query);
  useEffect(() => {
    const on = () => setQ(parse().query);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return q;
}

export const go = (path: string) => { location.hash = `#/${path.replace(/^\//, '')}`; };
