import type {
  FillProfile,
  Me,
  Mutation,
  NotificationView,
  PageMode,
  SessionResponse,
} from '@orvyn/contracts';

/** chrome.storage.local in the extension; a Map in tests. Holds only the refresh token and cached profile. */
export interface Store {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string | undefined): Promise<void>;
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export async function pkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  return { verifier, challenge, state };
}

export function connectUrl(webUrl: string, redirectUri: string, challenge: string, state: string): string {
  const u = new URL('/connect', webUrl);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('state', state);
  return u.toString();
}

/** The code from the redirect — only if it carries the state we sent (no injected codes). */
export function codeFromCallback(callbackUrl: string, expectedState: string): string {
  const u = new URL(callbackUrl);
  if (u.searchParams.get('state') !== expectedState) throw new Error('state_mismatch');
  const code = u.searchParams.get('code');
  if (!code) throw new Error('no_code');
  return code;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

type Fetch = typeof fetch;

/**
 * The extension's API client: access token in memory, refresh token in extension storage (never visible to web
 * pages), single-flight refresh, one replay after a 401. A refused refresh ends the session here.
 */
export class Client {
  private access: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  onSignedOut: () => void = () => undefined;

  constructor(
    readonly apiUrl: string,
    private readonly store: Store,
    private readonly fetchFn: Fetch = (...a) => fetch(...a),
  ) {}

  get accessToken(): string | null {
    return this.access;
  }

  async isConnected(): Promise<boolean> {
    return (await this.store.get('refresh')) !== undefined;
  }

  async me(): Promise<Me | null> {
    const raw = await this.store.get('me');
    return raw ? (JSON.parse(raw) as Me) : null;
  }

  async adopt(s: SessionResponse): Promise<void> {
    this.access = s.accessToken;
    await this.store.set('refresh', s.refreshToken);
    await this.store.set('me', JSON.stringify(s.user));
  }

  async redeem(code: string, verifier: string, deviceName: string, version: string): Promise<Me> {
    const r = await this.fetchFn(`${this.apiUrl}/auth/link/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        verifier,
        device: { name: deviceName, platform: 'extension', appVersion: version },
      }),
    });
    if (!r.ok) throw await apiError(r);
    const s = (await r.json()) as SessionResponse;
    await this.adopt(s);
    return s.user;
  }

  refresh(): Promise<boolean> {
    return (this.refreshing ??= this.doRefresh().finally(() => (this.refreshing = null)));
  }

  private async doRefresh(): Promise<boolean> {
    const token = await this.store.get('refresh');
    if (!token) return false;
    let r: Response;
    try {
      r = await this.fetchFn(`${this.apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      });
    } catch {
      return false; // offline: keep the token
    }
    if (r.ok) {
      await this.adopt((await r.json()) as SessionResponse);
      return true;
    }
    if (r.status === 401 || r.status === 403) await this.forget();
    return false;
  }

  call<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.send<T>(
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
      body === undefined ? {} : { 'content-type': 'application/json' },
    );
  }

  /** A file's bytes; returns its id. */
  async upload(blob: Blob, name: string): Promise<string> {
    const r = await this.send<{ id: string }>('POST', '/files', blob, {
      'content-type': blob.type,
      'x-file-name': encodeURIComponent(name),
      'x-file-purpose': 'drop',
    });
    return r.id;
  }

  private async send<T>(
    method: string,
    path: string,
    body: string | Blob | undefined,
    headers: Record<string, string>,
  ): Promise<T> {
    if (!this.access) await this.refresh();
    const go = () =>
      this.fetchFn(`${this.apiUrl}${path}`, {
        method,
        headers: { ...headers, ...(this.access ? { authorization: `Bearer ${this.access}` } : {}) },
        body,
      });
    let r = await go();
    if (r.status === 401 && (await this.refresh())) r = await go();
    if (!r.ok) throw await apiError(r);
    const text = await r.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async signOut(): Promise<void> {
    try {
      await this.call('POST', '/auth/sign-out');
    } catch {
      // offline or already revoked: forget locally regardless
    }
    await this.forget();
  }

  async forget(): Promise<void> {
    const had = await this.isConnected();
    this.access = null;
    await this.store.set('refresh', undefined);
    await this.store.set('me', undefined);
    if (had) this.onSignedOut();
  }
}

/** The server's own words when it gives them. */
async function apiError(r: Response): Promise<ApiError> {
  try {
    const j = (await r.json()) as { error?: { code?: string; message?: string } };
    return new ApiError(r.status, j.error?.code ?? `http_${r.status}`, j.error?.message);
  } catch {
    return new ApiError(r.status, `http_${r.status}`);
  }
}

/** Badge text: nothing at zero, "9+" past nine. */
export const badgeText = (unread: number) => (unread <= 0 ? '' : unread > 9 ? '9+' : String(unread));

export const unreadCount = (items: NotificationView[]) => items.filter((n) => !n.readAt).length;

/** Messages between the popup and the background worker. */
export type Request =
  | { type: 'status' }
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'dismiss'; id: string }
  | { type: 'act'; id: string; action: string }
  | { type: 'test' }
  | { type: 'quickAdd'; text: string }
  | { type: 'drop'; text: string }
  | { type: 'expense'; text: string }
  | { type: 'complete'; id: string };

/** Asks that answer with data rather than the status: `{ ok }` or `{ error }`. */
export type DataRequest =
  | { type: 'glance' }
  | { type: 'search'; q: string }
  | { type: 'page' }
  | { type: 'dropPage' }
  | { type: 'readLater' }
  | { type: 'screenshot' }
  | { type: 'note'; text: string }
  | { type: 'unnote'; at: number }
  | { type: 'forget'; url: string }
  | { type: 'think'; mode: PageMode; question?: string }
  | { type: 'recall'; q: string }
  | { type: 'fill' }
  | { type: 'undoFill' }
  | { type: 'learn' }
  | { type: 'draft'; question: string; maxChars?: number }
  | { type: 'profile' }
  | { type: 'saveProfile'; profile: FillProfile }
  | { type: 'structure'; text: string }
  | { type: 'vault' }
  /** is the page in front a sign-in? (the popup opens on Vault then) */
  | { type: 'here' }
  | { type: 'unlock'; passphrase: string }
  | { type: 'lock' }
  | { type: 'fillLogin'; id: string }
  | { type: 'totp'; id: string }
  | { type: 'newPassword' }
  | { type: 'savePending'; username?: string }
  | { type: 'dropPending' }
  | { type: 'day'; date: string }
  | { type: 'focus'; what: string; minutes: number }
  | { type: 'unfocus' }
  | { type: 'stash'; name: string; on: string | null }
  | { type: 'stashes' }
  | { type: 'unstash'; id: string; open: boolean }
  | { type: 'prefs' }
  | { type: 'setPrefs'; prefs: Partial<Prefs> }
  | { type: 'jobos' };
export type Answer<T> = { ok: T } | { error: string };

export interface Prefs {
  /** My Day: record which pages I'm on */
  track: boolean;
  /** Recall: keep the text of pages I read, on this device */
  recall: boolean;
  /** offer to save sign-ins */
  offerSave: boolean;
  autoLockMin: number;
  skipHosts: string[];
  jobos: string;
}
export const DEFAULT_PREFS: Prefs = {
  track: true,
  recall: true,
  offerSave: true,
  autoLockMin: 15,
  skipHosts: [],
  jobos: 'http://localhost:3000',
};
export interface Stash {
  id: string;
  name: string;
  at: number;
  on: string | null;
  tabs: { url: string; title: string }[];
}
export interface FocusState {
  what: string;
  from: number;
  until: number;
  bypassed: number;
  /** host → allowed until */
  pass: Record<string, number>;
}
export interface PageView {
  url: string;
  title: string;
  host: string;
  selection: string;
  forms: number;
  memory: {
    firstAt: number;
    lastAt: number;
    visits: number;
    dwellMs: number;
    notes: { at: number; text: string }[];
    price: string | null;
  } | null;
  focus: FocusState | null;
}
export interface FillReport {
  filled: { label: string; value: string; from: 'rule' | 'taught' | 'ai' }[];
  left: { label: string; long: boolean }[];
  files: number;
  aiProblem: string | null;
}

export interface TodayGlance {
  today: string;
  tasks: {
    id: string;
    title: string;
    dueDate: string | null;
    dueAt: string | null;
    priority: number;
    overdue: boolean;
  }[];
  events: { id: string; title: string; start: string | null; end: string | null; location: string }[];
}
export interface MoneyGlance {
  month: string;
  spentMinor: number;
  earnedMinor: number;
  toReview: number;
  categories: { id: string; name: string; slug: string | null }[];
  recent: {
    id: string;
    amountMinor: number;
    currency: string;
    direction: 'debit' | 'credit';
    merchant: string;
    occurredAt: string;
    reviewed: boolean;
    category: string | null;
  }[];
}
export interface Glance {
  today: TodayGlance | null;
  money: MoneyGlance | null;
}
export interface FoundDoc {
  id: string;
  title: string;
  category: string;
  summary: string;
  expiresOn: string | null;
}

export interface Status {
  connected: boolean;
  me: Me | null;
  live: boolean;
  notifications: NotificationView[];
  error?: string;
  /** what the last quick add / drop saved, to say so */
  saved?: string;
}

/** Buttons for a desktop notification: the notification's own (Done, Snooze…) when it has them, else Open/Dismiss. */
export function notificationButtons(n: Pick<NotificationView, 'actions'>): { id: string; title: string }[] {
  // Chrome has no box to type in: a reply opens ORVYN instead
  const own = n.actions.filter((a) => !a.open && !a.reply).slice(0, 2); // Chrome shows at most two
  return own.length
    ? own.map((a) => ({ id: a.id, title: a.label }))
    : [
        { id: 'orvyn:open', title: 'Open' },
        { id: 'orvyn:dismiss', title: 'Dismiss' },
      ];
}

/** What the popup's field turns into (step 2/3 quick capture): a Today task from the parser's reading, or a Drop item. */
export function captureMutations(
  target: 'today' | 'drop',
  text: string,
  parsed: {
    title: string;
    dueDate: string | null;
    dueAt: string | null;
    durationMin: number | null;
    rrule: string | null;
    priority: number;
    tags: string[];
    projectId: string | null;
    projectName: string | null;
  } | null,
  o: { stamp(): string; id(): string; today: string },
): Mutation[] {
  const m = (entity: string, fields: Record<string, unknown>, entityId = o.id()): Mutation => ({
    mutationId: o.id(),
    entity,
    entityId,
    op: 'upsert',
    fields,
    hlc: o.stamp(),
  });
  const t = text.trim();
  if (target === 'drop') {
    const link = /^https?:\/\/\S+$/i.test(t);
    return [
      m('drop.item', {
        kind: link ? 'link' : 'text',
        text: link ? '' : t,
        url: link ? t : null,
        source: 'extension',
        status: 'new',
      }),
    ];
  }
  const p = parsed ?? {
    title: t,
    dueDate: null,
    dueAt: null,
    durationMin: null,
    rrule: null,
    priority: 0,
    tags: [],
    projectId: null,
    projectName: null,
  };
  const out: Mutation[] = [];
  let projectId = p.projectId;
  if (!projectId && p.projectName) {
    projectId = o.id();
    out.push(m('today.project', { name: p.projectName }, projectId));
  }
  out.push(
    m('today.task', {
      title: p.title,
      dueAt: p.dueAt,
      dueDate: p.dueAt ? null : (p.dueDate ?? o.today),
      durationMin: p.durationMin,
      rrule: p.rrule,
      priority: p.priority,
      tags: p.tags,
      projectId,
      source: 'extension',
    }),
  );
  return out;
}
