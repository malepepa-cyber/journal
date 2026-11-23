/**
 * Anschluss an Firebase (Authentication + Cloud Firestore) über die offiziellen REST-Schnittstellen.
 * Kein zusätzliches SDK nötig. Alle Verbindungen laufen verschlüsselt (HTTPS) zu festen Google-Adressen.
 *
 * Datenablage in der Cloud (jeder Benutzer nur unter seiner eigenen Kennung, siehe firebase/firestore.rules):
 *   users/{uid}/recipes/{uuid}   Rezept (ohne Bild), Version, Löschmarker
 *   users/{uid}/photos/{uuid}    Rezeptbild (nur übertragen, wenn sich der Fingerabdruck ändert)
 *   users/{uid}/devices/{id}     verbundene Geräte
 *   users/{uid}/meta/settings    Kategorien
 */

export interface FirebaseConfig {
  apiKey: string;
  projectId: string;
  /** Nur für automatische Tests mit den Firebase-Emulatoren (PRA_ALLOW_EMULATOR=1) */
  emulator?: { auth: string; firestore: string } | null;
}

export class SyncError extends Error {
  constructor(message: string, public kind: 'offline' | 'auth' | 'conflict' | 'notfound' | 'server' | 'config' = 'server', public status = 0) { super(message); }
}

export function validateConfig(c: Partial<FirebaseConfig>): FirebaseConfig {
  const apiKey = String(c.apiKey ?? '').trim();
  const projectId = String(c.projectId ?? '').trim();
  if (!/^[\w-]{20,60}$/.test(apiKey)) throw new SyncError('Der „Web-API-Schlüssel“ sieht nicht richtig aus (beginnt meist mit „AIza…“).', 'config');
  if (!/^[a-z0-9-]{4,40}$/.test(projectId)) throw new SyncError('Die „Projekt-ID“ sieht nicht richtig aus (nur Kleinbuchstaben, Ziffern, Bindestriche).', 'config');
  let emulator: FirebaseConfig['emulator'] = null;
  if (c.emulator) {
    if (process.env.PRA_ALLOW_EMULATOR !== '1') throw new SyncError('Testumgebung nicht erlaubt.', 'config');
    const ok = (h: unknown) => /^(127\.0\.0\.1|localhost):\d{2,5}$/.test(String(h));
    if (!ok(c.emulator.auth) || !ok(c.emulator.firestore)) throw new SyncError('Ungültige Testumgebung.', 'config');
    emulator = { auth: String(c.emulator.auth), firestore: String(c.emulator.firestore) };
  }
  return { apiKey, projectId, emulator };
}

// ---------------- HTTP ----------------
async function http(url: string, init: RequestInit & { timeout?: number } = {}): Promise<{ status: number; body: any }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeout ?? 30_000) });
  } catch {
    throw new SyncError('Keine Verbindung zum Internet.', 'offline');
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

// ---------------- Anmeldung ----------------
export interface Tokens { idToken: string; refreshToken: string; uid: string; email: string; expiresAt: number }

const AUTH_ERRORS: Record<string, string> = {
  EMAIL_EXISTS: 'Für diese E-Mail-Adresse gibt es schon ein Konto. Bitte „Anmelden“ wählen.',
  EMAIL_NOT_FOUND: 'E-Mail-Adresse oder Passwort stimmt nicht.',
  INVALID_PASSWORD: 'E-Mail-Adresse oder Passwort stimmt nicht.',
  INVALID_LOGIN_CREDENTIALS: 'E-Mail-Adresse oder Passwort stimmt nicht.',
  INVALID_EMAIL: 'Die E-Mail-Adresse ist ungültig.',
  MISSING_PASSWORD: 'Bitte ein Passwort eingeben.',
  USER_DISABLED: 'Dieses Konto ist gesperrt.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Zu viele Versuche – bitte später noch einmal.',
  TOKEN_EXPIRED: 'Bitte erneut anmelden.',
  INVALID_REFRESH_TOKEN: 'Bitte erneut anmelden.',
  USER_NOT_FOUND: 'Das Konto gibt es nicht mehr. Bitte erneut anmelden.',
  OPERATION_NOT_ALLOWED: 'Im Firebase-Projekt ist die Anmeldung mit E-Mail/Passwort noch nicht aktiviert (siehe Sync-Anleitung).',
  CONFIGURATION_NOT_FOUND: 'Im Firebase-Projekt ist „Authentication“ noch nicht eingerichtet (siehe Sync-Anleitung).',
  API_KEY_INVALID: 'Der Web-API-Schlüssel ist ungültig.',
};
function authError(body: any): SyncError {
  const code = String(body?.error?.message ?? body?.error ?? '').split(/[ :]/)[0];
  if (code === 'WEAK_PASSWORD') return new SyncError('Das Passwort ist zu kurz – bitte mindestens 8 Zeichen.', 'auth');
  return new SyncError(AUTH_ERRORS[code] ?? `Anmeldung fehlgeschlagen (${code || 'unbekannt'}).`, 'auth');
}

const authBase = (c: FirebaseConfig) => (c.emulator ? `http://${c.emulator.auth}/identitytoolkit.googleapis.com/v1` : 'https://identitytoolkit.googleapis.com/v1');
const tokenBase = (c: FirebaseConfig) => (c.emulator ? `http://${c.emulator.auth}/securetoken.googleapis.com/v1` : 'https://securetoken.googleapis.com/v1');

async function authCall(c: FirebaseConfig, op: string, payload: object): Promise<any> {
  const r = await http(`${authBase(c)}/accounts:${op}?key=${encodeURIComponent(c.apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (r.status !== 200) throw authError(r.body);
  return r.body;
}

const toTokens = (b: any): Tokens => ({
  idToken: b.idToken ?? b.id_token, refreshToken: b.refreshToken ?? b.refresh_token,
  uid: b.localId ?? b.user_id, email: b.email ?? '', expiresAt: Date.now() + (Number(b.expiresIn ?? b.expires_in ?? 3600) - 120) * 1000,
});

export async function signUp(c: FirebaseConfig, email: string, password: string): Promise<Tokens> {
  if (password.length < 8) throw new SyncError('Das Passwort ist zu kurz – bitte mindestens 8 Zeichen.', 'auth');
  return toTokens(await authCall(c, 'signUp', { email, password, returnSecureToken: true }));
}
export async function signIn(c: FirebaseConfig, email: string, password: string): Promise<Tokens> {
  return toTokens(await authCall(c, 'signInWithPassword', { email, password, returnSecureToken: true }));
}
export async function sendPasswordReset(c: FirebaseConfig, email: string): Promise<void> {
  await authCall(c, 'sendOobCode', { requestType: 'PASSWORD_RESET', email });
}
export async function refresh(c: FirebaseConfig, refreshToken: string, email: string): Promise<Tokens> {
  const r = await http(`${tokenBase(c)}/token?key=${encodeURIComponent(c.apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  });
  if (r.status !== 200) throw authError(r.body);
  return { ...toTokens(r.body), email };
}

// ---------------- Firestore ----------------
export type Fields = Record<string, string | number | boolean | null | { timestamp: string }>;
export interface Doc { id: string; fields: Fields; updateTime: string }

function encode(f: Fields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === null || v === undefined) out[k] = { nullValue: null };
    else if (typeof v === 'string') out[k] = { stringValue: v };
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else if (typeof v === 'number') out[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else out[k] = { timestampValue: v.timestamp };
  }
  return out;
}
function decode(f: Record<string, any> = {}): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(f)) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = Number(v.doubleValue);
    else if ('booleanValue' in v) out[k] = Boolean(v.booleanValue);
    else if ('timestampValue' in v) out[k] = { timestamp: v.timestampValue };
    else out[k] = null;
  }
  return out;
}
const toDoc = (d: any): Doc => ({ id: String(d.name).split('/').pop()!, fields: decode(d.fields), updateTime: d.updateTime });

export class Firestore {
  constructor(private c: FirebaseConfig, private token: () => Promise<string>, private uid: string) {}

  private get root() {
    const host = this.c.emulator ? `http://${this.c.emulator.firestore}` : 'https://firestore.googleapis.com';
    return `${host}/v1/projects/${this.c.projectId}/databases/(default)/documents`;
  }
  private docName(path: string) { return `projects/${this.c.projectId}/databases/(default)/documents/users/${this.uid}/${path}`; }

  private async call(url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
    const r = await http(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await this.token()}`, ...(init.headers || {}) } });
    if (r.status === 401 || r.status === 403) {
      const msg = String(r.body?.error?.message ?? '');
      if (/Cloud Firestore API has not been used|is disabled|does not exist/i.test(msg)) throw new SyncError('Die Cloud-Datenbank (Firestore) ist im Firebase-Projekt noch nicht angelegt (siehe Sync-Anleitung).', 'config', r.status);
      throw new SyncError(r.status === 401 ? 'Bitte erneut anmelden.' : 'Zugriff verweigert – stimmen die Sicherheitsregeln (siehe Sync-Anleitung)?', 'auth', r.status);
    }
    if (r.status === 404 && /database.*does not exist|NOT_FOUND.*database/i.test(JSON.stringify(r.body ?? ''))) throw new SyncError('Die Cloud-Datenbank (Firestore) ist im Firebase-Projekt noch nicht angelegt (siehe Sync-Anleitung).', 'config', 404);
    if (r.status === 429) throw new SyncError('Das kostenlose Tageskontingent ist erreicht – morgen geht es automatisch weiter. Es entstehen keine Kosten.', 'server', 429);
    if (r.status >= 500) throw new SyncError(`Der Cloud-Dienst antwortet gerade nicht (${r.status}).`, 'server', r.status);
    return r;
  }

  async get(path: string): Promise<Doc | null> {
    const r = await this.call(`${this.root}/users/${this.uid}/${path}`);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new SyncError(`Lesen fehlgeschlagen (${r.status}).`, 'server', r.status);
    return toDoc(r.body);
  }

  async list(collection: string): Promise<Doc[]> {
    const out: Doc[] = []; let page = '';
    for (let i = 0; i < 50; i++) {
      const r = await this.call(`${this.root}/users/${this.uid}/${collection}?pageSize=300${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`);
      if (r.status !== 200) throw new SyncError(`Lesen fehlgeschlagen (${r.status}).`, 'server', r.status);
      out.push(...(r.body?.documents ?? []).map(toDoc));
      page = r.body?.nextPageToken; if (!page) break;
    }
    return out;
  }

  /** Dokumente einer Sammlung, die nach `after` geändert wurden (aufsteigend, max. `limit`) */
  async changedSince(collection: string, after: string, limit = 200): Promise<Doc[]> {
    const r = await this.call(`${this.root}/users/${this.uid}:runQuery`, {
      method: 'POST',
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: 'updatedAt' }, op: 'GREATER_THAN', value: { timestampValue: after } } },
        orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'ASCENDING' }],
        limit,
      } }),
    });
    if (r.status !== 200) throw new SyncError(`Abfrage fehlgeschlagen (${r.status}).`, 'server', r.status);
    return (r.body as any[]).filter((x) => x.document).map((x) => toDoc(x.document));
  }

  /**
   * Schreiben mit Vorbedingung: `ifUpdateTime` = nur wenn das Dokument noch genau diese Fassung hat,
   * `null` = nur wenn es noch nicht existiert, `undefined` = immer. `updatedAt` setzt der Server.
   * Liefert die neue Server-Zeit oder wirft SyncError('conflict').
   */
  async write(path: string, fields: Fields, ifUpdateTime?: string | null): Promise<string> {
    const write: Record<string, unknown> = {
      update: { name: this.docName(path), fields: encode(fields) },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    };
    if (ifUpdateTime === null) write.currentDocument = { exists: false };
    else if (ifUpdateTime) write.currentDocument = { updateTime: ifUpdateTime };
    const r = await this.call(`${this.root}:commit`, { method: 'POST', body: JSON.stringify({ writes: [write] }) });
    if (r.status === 200) return r.body.writeResults[0].updateTime;
    const status = String(r.body?.error?.status ?? '');
    if (r.status === 409 || r.status === 412 || status === 'FAILED_PRECONDITION' || status === 'ALREADY_EXISTS' || (r.status === 404 && ifUpdateTime)) {
      throw new SyncError('Gleichzeitige Änderung', 'conflict', r.status);
    }
    throw new SyncError(`Speichern in der Cloud fehlgeschlagen (${r.status}: ${String(r.body?.error?.message ?? '').slice(0, 120)}).`, 'server', r.status);
  }

  async remove(path: string): Promise<void> {
    const r = await this.call(`${this.root}/users/${this.uid}/${path}`, { method: 'DELETE' });
    if (r.status !== 200 && r.status !== 404) throw new SyncError(`Löschen fehlgeschlagen (${r.status}).`, 'server', r.status);
  }
}
