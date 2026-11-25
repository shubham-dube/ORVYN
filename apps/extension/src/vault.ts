import { VAULT_ITEM } from '@orvyn/contracts';
import {
  decryptItem,
  encryptItem,
  fromB64,
  generatePassword,
  parseTotp,
  toB64,
  totpCode,
  totpLeft,
  unlock,
  type VaultKeys,
} from '@orvyn/vault-crypto';
import { loginFits } from './match';

/**
 * The Vault in the extension (ADR-0017). The key sits in session memory only and goes away on its own; the API sees
 * ciphertext; passwords reach a page only from the popup, for a host that fits.
 */
interface Payload {
  kind: string;
  title: string;
  fields: Record<string, string>;
  notes: string;
  updatedAt: string;
  attachments?: unknown;
}
export interface LoginRow {
  id: string;
  title: string;
  username: string;
  url: string;
  fits: boolean;
  hasTotp: boolean;
  hasPassword: boolean;
}
export interface PendingLogin {
  host: string;
  url: string;
  username: string;
  password: string;
  at: number;
  /** the item this would update, once the Vault is open */
  updates?: string;
}
export interface VaultView {
  state: 'none' | 'locked' | 'open' | 'off';
  logins: LoginRow[];
  pending: Omit<PendingLogin, 'password'> | null;
  autoLockMin: number;
}

/** What it needs from outside; tests give it maps. */
export interface VaultIo {
  box(): Promise<{ keys: VaultKeys | null; items: { id: string; blob: string }[] }>;
  save(id: string, blob: string): Promise<void>;
  /** memory that dies with the browser (chrome.storage.session) */
  session: {
    get(k: string): Promise<unknown>;
    set(k: string, v: unknown): Promise<void>;
    remove(k: string): Promise<void>;
  };
  autoLockMin(): Promise<number>;
  now(): number;
}
const PENDING_MS = 5 * 60_000;

export class Vault {
  private box: Awaited<ReturnType<VaultIo['box']>> | null = null;
  private boxAt = 0;
  private open = new Map<string, { blob: string; payload: Payload }>();
  constructor(private readonly io: VaultIo) {}

  private async load(fresh = false) {
    if (!this.box || fresh || this.io.now() - this.boxAt > 60_000) {
      this.box = await this.io.box();
      this.boxAt = this.io.now();
    }
    return this.box;
  }

  /** The key while unlocked; using the Vault keeps it open a little longer. */
  private async key(touch = true): Promise<Uint8Array | null> {
    const s = (await this.io.session.get('vault')) as { key: string; until: number; min: number } | undefined;
    if (!s) return null;
    if (this.io.now() >= s.until) {
      await this.lock();
      return null;
    }
    if (touch) await this.io.session.set('vault', { ...s, until: this.io.now() + s.min * 60_000 });
    return fromB64(s.key);
  }

  async unlock(passphrase: string): Promise<void> {
    const b = await this.load(true);
    if (!b.keys) throw new Error('Set up the Vault in ORVYN first');
    const key = await unlock(b.keys, passphrase);
    const min = await this.io.autoLockMin();
    await this.io.session.set('vault', { key: toB64(key), until: this.io.now() + min * 60_000, min });
    key.fill(0);
  }

  async lock(): Promise<void> {
    this.open.clear();
    await this.io.session.remove('vault');
  }

  /** Signed out: nothing stays. */
  async wipe(): Promise<void> {
    this.box = null;
    await this.lock();
    await this.io.session.remove('pendingLogin');
  }

  /** Called every minute: locks when the time is up even if nobody asks. */
  async expire(): Promise<void> {
    await this.key(false);
    await this.pending();
  }

  private async items(key: Uint8Array): Promise<{ id: string; payload: Payload }[]> {
    const out: { id: string; payload: Payload }[] = [];
    for (const i of (await this.load()).items) {
      const had = this.open.get(i.id);
      if (had?.blob === i.blob) {
        out.push({ id: i.id, payload: had.payload });
        continue;
      }
      try {
        const payload = await decryptItem<Payload>(key, i.id, i.blob);
        this.open.set(i.id, { blob: i.blob, payload });
        out.push({ id: i.id, payload });
      } catch {
        // damaged or from another key: the web app shows these
      }
    }
    return out;
  }

  async view(pageUrl: string | null): Promise<VaultView> {
    const autoLockMin = await this.io.autoLockMin();
    const b = await this.load();
    const key = await this.key();
    const p = await this.pending();
    const pending = p
      ? { host: p.host, url: p.url, username: p.username, at: p.at, updates: p.updates }
      : null;
    if (!b.keys) return { state: 'none', logins: [], pending, autoLockMin };
    if (!key) return { state: 'locked', logins: [], pending, autoLockMin };
    const logins = (await this.items(key))
      .filter((i) => i.payload.kind === 'login')
      .map((i): LoginRow => ({
        id: i.id,
        title: i.payload.title,
        username: i.payload.fields.username ?? '',
        url: i.payload.fields.url ?? '',
        fits: !!pageUrl && loginFits(i.payload.fields.url ?? '', pageUrl),
        hasTotp: !!parseTotp(i.payload.fields.totp ?? ''),
        hasPassword: !!i.payload.fields.password,
      }))
      .sort((a, b2) => Number(b2.fits) - Number(a.fits) || a.title.localeCompare(b2.title));
    if (pending) pending.updates = await this.updates(key, p!);
    return { state: 'open', logins, pending, autoLockMin };
  }

  /** The login for this page, only if it fits. The caller hands it to the page and forgets it. */
  async forPage(id: string, pageUrl: string): Promise<{ host: string; username: string; password: string }> {
    const item = await this.item(id);
    if (!loginFits(item.fields.url ?? '', pageUrl)) throw new Error('This login is for another site');
    return {
      host: new URL(pageUrl).hostname,
      username: item.fields.username ?? '',
      password: item.fields.password ?? '',
    };
  }

  async code(id: string): Promise<{ code: string; left: number }> {
    const t = parseTotp((await this.item(id)).fields.totp ?? '');
    if (!t) throw new Error('No one-time codes here');
    return { code: await totpCode(t, this.io.now()), left: totpLeft(t, this.io.now()) };
  }

  private async item(id: string): Promise<Payload> {
    const key = await this.key();
    if (!key) throw new Error('The Vault is locked');
    const item = (await this.items(key)).find((i) => i.id === id);
    if (!item) throw new Error('Not in the Vault any more');
    return item.payload;
  }

  generate(length = 20, symbols = true): string {
    return generatePassword({ length, symbols });
  }

  // ---------------------------------------------------------------- saving a sign-in

  /** A sign-in seen on a page. Kept for five minutes, only in memory. Returns whether it is worth asking about. */
  async seen(pageUrl: string, username: string, password: string): Promise<boolean> {
    const u = new URL(pageUrl);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return false;
    const key = await this.key(false);
    if (key) {
      const same = (await this.items(key)).some(
        (i) =>
          i.payload.kind === 'login' &&
          loginFits(i.payload.fields.url ?? '', pageUrl) &&
          i.payload.fields.password === password &&
          (!username || i.payload.fields.username === username),
      );
      if (same) return false;
    }
    const p: PendingLogin = { host: u.hostname, url: u.origin, username, password, at: this.io.now() };
    await this.io.session.set('pendingLogin', p);
    return true;
  }

  async pending(): Promise<PendingLogin | null> {
    const p = (await this.io.session.get('pendingLogin')) as PendingLogin | undefined;
    if (!p) return null;
    if (this.io.now() - p.at > PENDING_MS) {
      await this.io.session.remove('pendingLogin');
      return null;
    }
    return p;
  }

  private async updates(key: Uint8Array, p: PendingLogin): Promise<string | undefined> {
    const hits = (await this.items(key)).filter(
      (i) => i.payload.kind === 'login' && loginFits(i.payload.fields.url ?? '', p.url),
    );
    const byName = hits.find((i) => i.payload.fields.username === p.username);
    // a change-password page often shows no user name; one login for the site is then clear enough
    return (byName ?? (!p.username && hits.length === 1 ? hits[0] : undefined))?.id;
  }

  async savePending(username?: string, title?: string): Promise<string> {
    const p = await this.pending();
    if (!p) throw new Error('Nothing to save any more');
    const key = await this.key();
    if (!key) throw new Error('The Vault is locked');
    if (username !== undefined) p.username = username;
    const old = await this.updates(key, p);
    const id = old ?? crypto.randomUUID();
    const was = old ? (await this.items(key)).find((i) => i.id === old)!.payload : null;
    const payload: Payload = was
      ? { ...was, fields: { ...was.fields, password: p.password } }
      : {
          kind: 'login',
          title: title?.trim() || p.host.replace(/^www\./, ''),
          fields: { username: p.username, password: p.password, url: p.url, totp: '' },
          notes: '',
          updatedAt: '',
        };
    payload.updatedAt = new Date(this.io.now()).toISOString();
    await this.io.save(id, await encryptItem(key, id, payload));
    await this.dismissPending();
    await this.load(true);
    return was ? 'Password updated in the Vault' : 'Saved in the Vault';
  }

  async dismissPending(): Promise<void> {
    await this.io.session.remove('pendingLogin');
  }
}

export const vaultMutation = (id: string, blob: string, stamp: string, mutationId: string) => ({
  mutationId,
  entity: VAULT_ITEM,
  entityId: id,
  op: 'upsert' as const,
  fields: { blob },
  hlc: stamp,
});
