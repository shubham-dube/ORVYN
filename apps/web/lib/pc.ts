import type { ServerMessage } from '@orvyn/contracts';
import { PcChannel, pcNonce, type PcPairing, unb64 } from '@orvyn/vault-crypto';

/**
 * A terminal session with my PC (spec 0021 step 3, ADR-0019). Everything but finding it is encrypted with the key the PC
 * showed at pairing. Shells live on the PC: when the network drops, this finds the PC again and goes on where it was.
 */
export interface PcTerm {
  id: string;
  name: string;
  since: number;
  exit: number | null;
  /** tells me when what runs in it ends */
  watch?: boolean;
}
export interface PcShell {
  id: string;
  name: string;
}
export interface PcFiles {
  path: string;
  parent: string | null;
  list: { name: string; path: string; dir: boolean; size: number }[];
  cut: boolean;
}
/** What the remote deck knows (spec 0021 #11). */
export interface PcDeck {
  sound: { volume: number; muted: boolean } | null;
  files: PcFiles | null;
  clip: string | null;
  /** the last picture or file that arrived whole */
  file: { name: string; blob: Blob } | null;
  /** of the one on its way, 0..1 */
  progress: number | null;
}
export type PcDeckAsk =
  | { t: 'deck' }
  | { t: 'do'; what: 'lock' | 'sleep' | 'mute' | 'volume'; v?: number }
  | { t: 'open'; url: string }
  | { t: 'clip'; text?: string }
  | { t: 'shot' }
  | { t: 'files'; path?: string | null }
  | { t: 'get'; path: string };

export type PcStatus =
  'finding' | 'offline' | 'off' | 'locked' | 'pin' | 'open' | 'idle' | 'removed' | 'ended';

type Told =
  | { t: 'hello'; pc: string; shells: PcShell[]; terms: PcTerm[] }
  | { t: 'badpin'; left: number }
  | { t: 'opened'; id: string; terms: PcTerm[] }
  | { t: 'terms'; terms: PcTerm[] }
  | { t: 'out'; id: string; d: string; end: number; reset: boolean }
  | { t: 'exit'; id: string; code: number }
  | { t: 'deck'; sound: PcDeck['sound'] }
  | ({ t: 'files' } & PcFiles)
  | { t: 'clip'; text: string }
  | { t: 'did'; what: string }
  | { t: 'blob'; id: number; name: string; size: number; part: number }
  | { t: 'part'; id: number; n: number; d: string }
  | { t: 'error'; text: string }
  | { t: 'end'; why: string }
  | { t: 'pong' };

export interface PcTransport {
  /** false when there is no connection now */
  send(frame: { type: 'pc'; to?: string; s: string; d: string }): boolean;
  on(h: (m: ServerMessage) => void): () => void;
}
export interface PcEvents {
  changed(): void;
  output(id: string, text: string, reset: boolean): void;
  opened(id: string): void;
  problem(text: string): void;
  did(what: string): void;
}

const FIND_MS = 6_000;
const PING_MS = 20_000;
const QUIET_MS = 8_000;
const PASTE = 8_000;
/** What a terminal answers by itself (where the cursor is, what it is): the PC has answered already. */
const REPORT = /\x1b(\[(\d+;\d+R|[?>=]?[\d;]*c|\d*n|\?[\d;]*\$y|[IO])|[\]P][^\x07\x1b]*(\x07|\x1b\\))/g;

export class PcLink {
  status: PcStatus = 'finding';
  shells: PcShell[] = [];
  terms: PcTerm[] = [];
  remote: PcDeck = { sound: null, files: null, clip: null, file: null, progress: null };
  private coming: { id: number; name: string; size: number; parts: Uint8Array<ArrayBuffer>[] } | null = null;
  /** tries left after a wrong PIN */
  left: number | null = null;
  private s = '';
  private to = '';
  private chan: PcChannel | null = null;
  private pin: string | null = null;
  /** how much of each shell is here already */
  private ends = new Map<string, number>();
  private sizes = new Map<string, [number, number]>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private again = 0;
  private stopped = false;
  private readonly off: () => void;

  constructor(
    private readonly pair: PcPairing,
    private readonly net: PcTransport,
    private readonly events: PcEvents,
    private readonly deviceName: string,
  ) {
    this.off = net.on((m) => {
      if (m.type === 'hello') {
        if (
          this.status === 'finding' ||
          this.status === 'offline' ||
          this.status === 'open' ||
          this.status === 'pin'
        )
          void this.connect();
      } else if (m.type === 'pc' && m.s === this.s) this.frame(m.from, m.d);
    });
  }

  /** Looks for the PC (again). The PIN is kept in memory only, until the session ends. */
  async connect(): Promise<void> {
    if (this.stopped) return;
    this.clear();
    this.chan = null;
    this.to = '';
    this.coming = null;
    this.remote = { ...this.remote, progress: null };
    const s = await pcNonce();
    if (this.stopped) return;
    this.s = s;
    this.set('finding');
    this.net.send({ type: 'pc', s, d: `o.${this.pair.id}` });
    this.later(FIND_MS, () => {
      if (this.status === 'finding') this.set('offline');
    });
  }

  stop(): void {
    if (this.stopped) return;
    if (this.chan) this.ask({ t: 'bye' });
    this.stopped = true;
    this.pin = null;
    this.clear();
    this.off();
  }

  enterPin(pin: string): void {
    this.pin = pin;
    if (this.chan) this.ask({ t: 'auth', pin, name: this.deviceName });
  }
  open(shell: string | undefined, cols: number, rows: number): void {
    this.ask({ t: 'new', shell, cols, rows });
  }
  attach(id: string, cols: number, rows: number): void {
    this.sizes.set(id, [cols, rows]);
    this.ask({ t: 'attach', id, cols, rows, from: this.ends.get(id) ?? 0 });
  }
  /** The screen here is gone; next time from the start. */
  detach(id: string): void {
    this.ends.delete(id);
    this.sizes.delete(id);
    if (this.status === 'open') this.ask({ t: 'detach', id });
  }
  resize(id: string, cols: number, rows: number): void {
    this.sizes.set(id, [cols, rows]);
    if (this.status === 'open') this.ask({ t: 'size', id, cols, rows });
  }
  /** False when it did not go out: nothing typed is sent later by surprise. */
  type(id: string, text: string): boolean {
    const clean = text.replace(REPORT, '');
    if (this.status !== 'open') return false;
    for (let i = 0; i < clean.length; i += PASTE) this.ask({ t: 'in', id, d: clean.slice(i, i + PASTE) });
    return true;
  }
  deck(m: PcDeckAsk): void {
    if (this.status === 'open') this.ask({ ...m });
    else this.events.problem('Not connected');
  }
  watch(id: string, on: boolean): void {
    this.ask({ t: 'watch', id, on });
  }
  close(id: string): void {
    this.ends.delete(id);
    this.sizes.delete(id);
    this.ask({ t: 'close', id });
  }

  // ------------------------------------------------------------------ inside
  private set(s: PcStatus) {
    this.status = s;
    this.events.changed();
  }
  private later(ms: number, f: () => void) {
    this.timers.push(setTimeout(f, ms));
  }
  private clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private ask(m: Record<string, unknown>) {
    if (!this.chan) return;
    if (!this.net.send({ type: 'pc', to: this.to, s: this.s, d: this.chan.seal(JSON.stringify(m)) }))
      this.chan = null; // the next connection starts again
  }

  private frame(from: string, d: string) {
    if (!this.chan && !this.to && d.startsWith('r.')) {
      this.to = from;
      this.chan = new PcChannel(this.pair.key, `${this.s}.${d.slice(2)}`, 'c');
      this.clear();
      if (this.pin) this.enterPin(this.pin);
      else this.set('pin');
      // a device that only claims to be the PC can't answer anything
      if (this.pin) this.later(FIND_MS * 2, () => this.status === 'finding' && this.set('offline'));
      return;
    }
    if (this.to && from !== this.to) return;
    if (d.startsWith('x.')) return this.ended(d.slice(2));
    if (!this.chan) return;
    let m: Told;
    try {
      m = JSON.parse(this.chan.open(d)) as Told;
    } catch {
      return this.ended('gone');
    }
    this.told(m);
  }

  private ended(why: string) {
    this.chan = null;
    this.s = '';
    this.clear();
    if (why === 'gone') {
      // a message went missing on the way: start again, slower each time
      this.set('finding');
      return this.later(Math.min(10_000, 300 * 2 ** this.again++), () => void this.connect());
    }
    this.pin = null;
    this.left = null;
    this.set(
      why === 'off' || why === 'locked' || why === 'idle' || why === 'removed' ? why : ('ended' as const),
    );
  }

  private arrived() {
    const c = this.coming;
    if (!c) return;
    const have = c.parts.reduce((n, p) => n + p.length, 0);
    this.remote = { ...this.remote, progress: c.size ? have / c.size : 1 };
    if (have >= c.size) {
      const type = c.name === 'screen.jpg' ? 'image/jpeg' : 'application/octet-stream';
      this.remote = {
        ...this.remote,
        progress: null,
        file: { name: c.name, blob: new Blob(c.parts, { type }) },
      };
      this.coming = null;
    }
    this.events.changed();
  }

  private beat() {
    this.clear();
    this.later(PING_MS, () => {
      this.ask({ t: 'ping' });
      this.later(QUIET_MS, () => void this.connect());
    });
  }

  private told(m: Told) {
    if (this.status === 'open') this.beat();
    switch (m.t) {
      case 'hello': {
        this.shells = m.shells;
        this.terms = m.terms;
        this.left = null;
        this.again = 0;
        this.set('open');
        this.beat();
        for (const [id, [c, r]] of this.sizes)
          if (m.terms.some((t) => t.id === id)) this.attach(id, c, r);
          else this.ends.delete(id);
        break;
      }
      case 'badpin':
        this.pin = null;
        this.left = m.left;
        this.set('pin');
        break;
      case 'opened':
        this.terms = m.terms;
        this.ends.set(m.id, 0);
        this.events.opened(m.id);
        this.events.changed();
        break;
      case 'terms':
        this.terms = m.terms;
        this.events.changed();
        break;
      case 'out':
        this.ends.set(m.id, m.end);
        this.events.output(m.id, m.d, m.reset);
        this.ask({ t: 'ack', id: m.id, end: m.end });
        break;
      case 'exit':
        this.terms = this.terms.map((t) => (t.id === m.id ? { ...t, exit: m.code } : t));
        this.events.changed();
        break;
      case 'deck':
        this.remote = { ...this.remote, sound: m.sound };
        this.events.changed();
        break;
      case 'files':
        this.remote = { ...this.remote, files: { path: m.path, parent: m.parent, list: m.list, cut: m.cut } };
        this.events.changed();
        break;
      case 'clip':
        this.remote = { ...this.remote, clip: m.text };
        this.events.changed();
        this.remote = { ...this.remote, clip: null };
        break;
      case 'blob':
        this.coming = { id: m.id, name: m.name, size: m.size, parts: [] };
        this.remote = { ...this.remote, progress: 0 };
        this.arrived();
        break;
      case 'part': {
        const c = this.coming;
        if (!c || c.id !== m.id || c.parts.length !== m.n) break;
        c.parts.push(new Uint8Array(unb64(m.d)));
        this.ask({ t: 'got', id: c.id, n: c.parts.length });
        this.arrived();
        break;
      }
      case 'did':
        this.events.did(m.what);
        break;
      case 'error':
        this.events.problem(m.text);
        break;
      case 'end':
        this.ended(m.why);
        break;
      case 'pong':
        break;
    }
  }
}

// ------------------------------------------------------------------ the pairings of this browser
// The key is encrypted under a browser key that can't be read out, so a copy of the saved data is not enough. The PIN is
// never kept: it is checked on the PC, which counts the tries.

interface Saved {
  id: string;
  user: string;
  name: string;
  iv: Uint8Array<ArrayBuffer>;
  key: ArrayBuffer;
  wrap: CryptoKey;
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('orvyn-pc', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('pairs', { keyPath: 'id' });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('indexedDB'));
  });
}
async function store<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = f(d.transaction('pairs', mode).objectStore('pairs'));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('indexedDB'));
    });
  } finally {
    d.close();
  }
}

export async function savePairing(user: string, p: PcPairing): Promise<void> {
  const wrap = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrap, new Uint8Array(p.key));
  await store('readwrite', (s) => s.put({ id: p.id, user, name: p.name, iv, key, wrap } satisfies Saved));
}
export async function pairings(user: string): Promise<PcPairing[]> {
  const all = (await store('readonly', (s) => s.getAll())) as Saved[];
  return Promise.all(
    all
      .filter((x) => x.user === user)
      .map(async (x) => ({
        id: x.id,
        name: x.name,
        key: new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: x.iv }, x.wrap, x.key)),
      })),
  );
}
export async function forgetPairing(id: string): Promise<void> {
  await store('readwrite', (s) => s.delete(id));
}
