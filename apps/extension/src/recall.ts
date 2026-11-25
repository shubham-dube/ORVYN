/**
 * Recall and page memory (spec 0020): what I read, searchable, on this device only. The text never leaves the browser
 * (ADR-0018). Banks, payment pages, private addresses and pages with a password field are never kept.
 */
export interface PricePoint {
  at: number;
  price: number;
  currency: string;
}
export interface PageMemory {
  url: string;
  host: string;
  title: string;
  text: string;
  tokens: string[];
  firstAt: number;
  lastAt: number;
  visits: number;
  dwellMs: number;
  prices: PricePoint[];
  notes: { at: number; text: string }[];
}
export interface Found {
  url: string;
  title: string;
  host: string;
  lastAt: number;
  dwellMs: number;
  snippet: string;
}

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.(local|internal|lan)$)/i;
const SENSITIVE_HOST =
  /(^|[.-])(bank|netbanking|onlinesbi|hdfcbank|icicibank|axisbank|kotak|paypal|razorpay|payu|billdesk|stripe|accounts|login|signin|auth|sso|vault|1password|bitwarden|lastpass|incometax|digilocker|uidai)([.-]|$)/i;
const SENSITIVE_PATH =
  /\/(login|log-in|signin|sign-in|checkout|payment|pay|password|reset|otp|2fa|mfa|netbanking)(\/|$|\.)/i;

/** May this page's text be kept? */
export function keepable(url: string, hasPassword: boolean): boolean {
  if (hasPassword) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  return (
    !PRIVATE_HOST.test(u.hostname) && !SENSITIVE_HOST.test(u.hostname) && !SENSITIVE_PATH.test(u.pathname)
  );
}

/** One page, however it was reached: no fragment, no tracking or session parameters. */
export function pageKey(url: string): string {
  const u = new URL(url);
  u.hash = '';
  u.username = u.password = '';
  for (const k of [...u.searchParams.keys()])
    if (
      /^(utm_.*|fbclid|gclid|igshid|ref|ref_.*|mc_.*|si|spm|_ga)$/i.test(k) ||
      /token|secret|session|password|code|auth|sig|key/i.test(k)
    )
      u.searchParams.delete(k);
  return u.toString();
}

const STOP = new Set(
  'the a an and or of to in on for with is are was were be by at as it this that from you your i we our they he she not can will have has had do does did but if so about page read article'.split(
    ' ',
  ),
);
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{2,30}/gu) ?? []).filter((w) => !STOP.has(w));
}

/** The words that say what a page is about (title first), for the index. */
export function tokensOf(title: string, text: string, max = 300): string[] {
  const n = new Map<string, number>();
  for (const w of words(title)) n.set(w, (n.get(w) ?? 0) + 8);
  for (const w of words(text)) n.set(w, (n.get(w) ?? 0) + 1);
  return [...n]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

/** "…the page about X I read on tuesday" → the words and, if a time was said, since when and until when. */
export function parseRecall(q: string, now: Date): { words: string[]; from?: number; to?: number } {
  let rest = q.toLowerCase();
  const start = (daysAgo: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo).getTime();
  let from: number | undefined;
  let to: number | undefined;
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const day = new RegExp(`\\b(?:on |last )?(${days.join('|')})\\b`).exec(rest);
  if (/\btoday\b/.test(rest)) from = start(0);
  else if (/\byesterday\b/.test(rest)) [from, to] = [start(1), start(0)];
  else if (/\b(this|past|last) week\b/.test(rest)) from = start(7);
  else if (/\b(this|past|last) month\b/.test(rest)) from = start(31);
  else if (day) {
    const back = (now.getDay() - days.indexOf(day[1]!) + 7) % 7 || 7;
    [from, to] = [start(back), start(back - 1)];
    rest = rest.replace(day[0], ' ');
  }
  rest = rest.replace(/\b(today|yesterday|(this|past|last) (week|month))\b/g, ' ');
  return { words: [...new Set(words(rest))], from, to };
}

/** Best first: how many of the words match, how rare they are, the title, time spent, and how recent. */
export function rank(
  pages: PageMemory[],
  q: { words: string[]; from?: number; to?: number },
  now: number,
): PageMemory[] {
  const inTime = pages.filter(
    (p) => (q.from === undefined || p.lastAt >= q.from) && (q.to === undefined || p.firstAt < q.to),
  );
  const hit = (p: PageMemory, w: string) =>
    p.tokens.some((t) => t === w || (w.length > 3 && t.startsWith(w)));
  const df = new Map(q.words.map((w) => [w, inTime.filter((p) => hit(p, w)).length]));
  return inTime
    .map((p) => {
      let s = 0;
      let matched = 0;
      const title = p.title.toLowerCase();
      for (const w of q.words) {
        if (!hit(p, w)) continue;
        matched++;
        s += Math.log(1 + inTime.length / (df.get(w) || 1)) * (title.includes(w) ? 2 : 1);
      }
      if (q.words.length && matched < Math.ceil(q.words.length / 2)) return { p, s: -1 };
      s += Math.min(1, p.dwellMs / 600_000) + Math.max(0, 1 - (now - p.lastAt) / (30 * 86_400_000));
      return { p, s };
    })
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}

export function snippet(text: string, ws: string[]): string {
  const low = text.toLowerCase();
  const at = ws.map((w) => low.indexOf(w)).filter((i) => i >= 0);
  const i = at.length ? Math.max(0, Math.min(...at) - 60) : 0;
  return (
    (i > 0 ? '…' : '') +
    text
      .slice(i, i + 180)
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Says whether today's price is good, from what was seen before. */
export function priceLine(prices: PricePoint[]): string | null {
  if (prices.length < 2) return null;
  const now = prices.at(-1)!;
  const before = prices.slice(0, -1).filter((p) => p.currency === now.currency);
  if (!before.length) return null;
  const low = Math.min(...before.map((p) => p.price));
  const high = Math.max(...before.map((p) => p.price));
  const day = (t: number) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const cheapest = before.find((p) => p.price === low)!;
  if (now.price < low) return `Lowest you have seen (was ${low} on ${day(cheapest.at)})`;
  if (now.price > low) return `Was ${low} on ${day(cheapest.at)}; highest seen ${Math.max(high, now.price)}`;
  return `Same as the lowest you have seen (${day(cheapest.at)})`;
}

// ------------------------------------------------------------------ the store

const KEEP_DAYS = 120;
const MAX_PAGES = 6000;

export class Recall {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private readonly name = 'orvyn-recall') {}

  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise((ok, no) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => {
        const s = r.result.createObjectStore('pages', { keyPath: 'url' });
        s.createIndex('tokens', 'tokens', { multiEntry: true });
        s.createIndex('lastAt', 'lastAt');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error ?? new Error('no database'));
    }));
  }

  private async run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((ok, no) => {
      const r = f(db.transaction('pages', mode).objectStore('pages'));
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error ?? new Error('database'));
    });
  }

  get(url: string): Promise<PageMemory | undefined> {
    return this.run('readonly', (s) => s.get(pageKey(url)) as IDBRequest<PageMemory | undefined>);
  }

  /** Read, change, write in one transaction, so two tabs can't lose each other's changes. */
  private async change(url: string, host: string, f: (p: PageMemory) => void): Promise<void> {
    const db = await this.open();
    const key = pageKey(url);
    const now = Date.now();
    return new Promise((ok, no) => {
      const tx = db.transaction('pages', 'readwrite');
      const s = tx.objectStore('pages');
      const r = s.get(key) as IDBRequest<PageMemory | undefined>;
      r.onsuccess = () => {
        const p: PageMemory = r.result ?? {
          url: key,
          host,
          title: '',
          text: '',
          tokens: [],
          firstAt: now,
          lastAt: now,
          visits: 0,
          dwellMs: 0,
          prices: [],
          notes: [],
        };
        f(p);
        s.put(p);
      };
      tx.oncomplete = () => ok();
      tx.onerror = () => no(tx.error ?? new Error('database'));
    });
  }

  seen(
    url: string,
    o: {
      title: string;
      text: string;
      dwellMs: number;
      first: boolean;
      price?: Omit<PricePoint, 'at'> | null;
    },
  ): Promise<void> {
    const now = Date.now();
    return this.change(url, new URL(url).hostname, (p) => {
      p.title = o.title.slice(0, 300) || p.title;
      p.text = o.text.slice(0, 20_000);
      p.tokens = tokensOf(p.title, p.text);
      p.lastAt = now;
      p.dwellMs += o.dwellMs;
      if (o.first) p.visits++;
      const last = p.prices.at(-1);
      if (o.price && (!last || last.price !== o.price.price || now - last.at > 86_400_000))
        p.prices = [...p.prices, { ...o.price, at: now }].slice(-60);
    });
  }

  note(url: string, title: string, text: string): Promise<void> {
    return this.change(url, new URL(url).hostname, (p) => {
      p.title ||= title;
      if (!p.tokens.length) p.tokens = tokensOf(p.title, text);
      p.notes = [...p.notes, { at: Date.now(), text: text.slice(0, 2000) }].slice(-30);
    });
  }

  unnote(url: string, at: number): Promise<void> {
    return this.change(url, new URL(url).hostname, (p) => {
      p.notes = p.notes.filter((n) => n.at !== at);
    });
  }

  async search(q: string, now = new Date()): Promise<Found[]> {
    const parsed = parseRecall(q, now);
    const db = await this.open();
    const seen = new Map<string, PageMemory>();
    await new Promise<void>((ok, no) => {
      const tx = db.transaction('pages', 'readonly');
      const s = tx.objectStore('pages');
      const add = (r: IDBRequest<PageMemory[]>) => {
        r.onsuccess = () => r.result.forEach((p) => seen.set(p.url, p));
      };
      for (const w of parsed.words)
        add(
          s
            .index('tokens')
            .getAll(w.length > 3 ? IDBKeyRange.bound(w, `${w}￿`) : IDBKeyRange.only(w), 600) as IDBRequest<
            PageMemory[]
          >,
        );
      if (!parsed.words.length && parsed.from !== undefined)
        add(s.index('lastAt').getAll(IDBKeyRange.lowerBound(parsed.from), 600) as IDBRequest<PageMemory[]>);
      tx.oncomplete = () => ok();
      tx.onerror = () => no(tx.error ?? new Error('database'));
    });
    return rank([...seen.values()], parsed, now.getTime())
      .slice(0, 25)
      .map((p) => ({
        url: p.url,
        title: p.title || p.url,
        host: p.host,
        lastAt: p.lastAt,
        dwellMs: p.dwellMs,
        snippet: snippet(p.text, parsed.words),
      }));
  }

  forget(url: string): Promise<unknown> {
    return this.run('readwrite', (s) => s.delete(pageKey(url)));
  }

  clear(): Promise<unknown> {
    return this.run('readwrite', (s) => s.clear());
  }

  /** Old pages go (never ones with a note), and the store stays a sensible size. */
  async tidy(now = Date.now()): Promise<void> {
    const total = await this.run('readonly', (s) => s.count());
    let over = Math.max(0, total - MAX_PAGES);
    const db = await this.open();
    await new Promise<void>((ok, no) => {
      const tx = db.transaction('pages', 'readwrite');
      const c = tx.objectStore('pages').index('lastAt').openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return;
        const p = cur.value as PageMemory;
        if (p.lastAt > now - KEEP_DAYS * 86_400_000 && over <= 0) return;
        if (!p.notes.length) {
          cur.delete();
          over--;
        }
        cur.continue();
      };
      tx.oncomplete = () => ok();
      tx.onerror = () => no(tx.error ?? new Error('database'));
    });
  }
}
