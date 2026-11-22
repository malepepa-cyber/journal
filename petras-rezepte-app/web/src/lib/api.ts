/** Zugriff auf den lokalen Dienst. Der Sitzungsschlüssel kommt beim Start über die Adresse (#t=…). */
import type { Profile, Recipe, RecipeSummary } from '../../../shared/model.ts';

const KEY = 'pra.token';
(function captureToken() {
  const m = location.hash.match(/[#&]t=([\w-]+)/);
  if (m) {
    try { sessionStorage.setItem(KEY, m[1]); localStorage.setItem(KEY, m[1]); } catch { /* egal */ }
    history.replaceState(null, '', `${location.pathname}#/`);
  }
})();
export const token = (): string => { try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || ''; } catch { return ''; } };

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { 'x-pra-token': token(), ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers || {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, 'Die App ist nicht erreichbar. Bitte über das Desktop-Symbol neu starten.');
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error || `Fehler ${res.status}`);
  return data as T;
}

export const photoUrl = (url: string | null) => (url ? `${url}&t=${encodeURIComponent(token())}` : null);

export interface Settings {
  experimentalTransfer: boolean; cookidooUrl: string; aiEnabled: boolean; aiModel: string;
  autoBackup: boolean; onboardingDone: boolean; bookmarkletInstalled: boolean;
}
export interface Session { version: string; dataDir: string; profileId: number; profiles: Profile[]; settings: Settings; aiKey: boolean }
export interface Stats { total: number; favorites: number; transferred: number; byCategory: Record<string, number> }
export interface BackupInfo { name: string; size: number; createdAt: string; kind: string }

export const Api = {
  session: () => api<Session>('/api/session'),
  stats: () => api<Stats>('/api/stats'),
  list: (q: Record<string, string | number | undefined> = {}) =>
    api<RecipeSummary[]>(`/api/recipes?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))}`),
  get: (id: number) => api<Recipe>(`/api/recipes/${id}`),
  create: (r: Recipe) => api<Recipe>('/api/recipes', { method: 'POST', json: r }),
  update: (r: Recipe) => api<Recipe>(`/api/recipes/${r.id}`, { method: 'PUT', json: r }),
  remove: (id: number) => api(`/api/recipes/${id}`, { method: 'DELETE' }),
  favorite: (id: number, favorite: boolean) => api(`/api/recipes/${id}/favorite`, { method: 'PATCH', json: { favorite } }),
  cookidoo: (id: number, status: string) => api<Recipe>(`/api/recipes/${id}/cookidoo`, { method: 'PATCH', json: { status } }),
  duplicate: (id: number) => api<Recipe>(`/api/recipes/${id}/duplicate`, { method: 'POST' }),
  duplicates: (r: Pick<Recipe, 'id' | 'title' | 'ingredients'>) => api<RecipeSummary[]>('/api/recipes/duplicates', { method: 'POST', json: r }),
  trash: () => api<RecipeSummary[]>('/api/trash'),
  restore: (id: number) => api(`/api/trash/${id}/restore`, { method: 'POST' }),
  purge: (id: number) => api(`/api/trash/${id}`, { method: 'DELETE' }),
  draft: () => api<{ data: any; updatedAt: string } | null>('/api/draft'),
  saveDraft: (data: unknown) => api('/api/draft', { method: 'PUT', json: data }),
  clearDraft: () => api('/api/draft', { method: 'DELETE' }),
  settings: (patch: Partial<Settings>) => api<Settings>('/api/settings', { method: 'PUT', json: patch }),
  setAiKey: (key: string) => api<{ aiKey: boolean }>('/api/ai/key', { method: 'PUT', json: { key } }),
  aiStructure: (text: string) => api<{ recipe: Recipe; issues: string[] }>('/api/ai/structure', { method: 'POST', json: { text } }),
  backups: () => api<BackupInfo[]>('/api/backups'),
  backup: () => api<BackupInfo>('/api/backups', { method: 'POST' }),
  restoreBackup: (name: string) => api('/api/backups/restore', { method: 'POST', json: { name } }),
  importJson: (data: unknown) => api<{ imported: number; skipped: number }>('/api/import', { method: 'POST', json: data }),
  createProfile: (name: string) => api<Profile>('/api/profiles', { method: 'POST', json: { name } }),
  selectProfile: (id: number) => api(`/api/profiles/${id}/select`, { method: 'POST' }),
  renameProfile: (id: number, name: string) => api(`/api/profiles/${id}`, { method: 'PATCH', json: { name } }),
  deleteProfile: (id: number) => api(`/api/profiles/${id}`, { method: 'DELETE' }),
  bookmarklet: () => api<{ code: string }>('/api/bookmarklet'),
  fetchUrl: (url: string) => api<{ html: string; url: string }>('/api/fetch-url', { method: 'POST', json: { url } }),
  shutdown: () => api('/api/shutdown', { method: 'POST' }),
  heartbeat: () => api('/api/heartbeat', { method: 'POST' }),
  log: (message: string, where = '') => api('/api/log', { method: 'POST', json: { message, where } }).catch(() => {}),
};

export async function downloadExport(ids?: number[]) {
  const r = await fetch(`/api/export${ids?.length ? `?ids=${ids.join(',')}` : ''}`, { headers: { 'x-pra-token': token() } });
  if (!r.ok) throw new ApiError(r.status, 'Export fehlgeschlagen');
  const blob = await r.blob();
  const name = decodeURIComponent(r.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? 'rezepte.json');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
