import { answers, fill, scan, undo, visible } from './form';

/**
 * Runs in every page, isolated from its scripts. It counts (never which keys), reads the text when asked or once a page
 * has really been read, and notices a sign-in so the extension can offer to save it. It holds no token and no Vault
 * data, and answers only this extension.
 */

type Sent =
  | { type: 'page.beat'; keys: number; clicks: number; scrolls: number; playing: boolean; left?: boolean }
  | {
      type: 'page.read';
      title: string;
      text: string;
      dwellMs: number;
      first: boolean;
      hasPassword: boolean;
      price: { price: number; currency: string } | null;
    }
  | { type: 'page.login'; username: string; password: string }
  | { type: 'page.shield' }
  | { type: 'page.bypass' };

const top = window === window.top;
let dead = false;
async function send<T>(m: Sent): Promise<T | undefined> {
  if (dead) return undefined;
  try {
    return (await chrome.runtime.sendMessage(m)) as T;
  } catch {
    // the extension was updated or removed: this old copy falls silent
    if (!chrome.runtime?.id) dead = true;
    return undefined;
  }
}

// ------------------------------------------------------------------ counts

let keys = 0;
let clicks = 0;
let scrolls = 0;
let lastScroll = 0;
addEventListener('keydown', (e) => e.isTrusted && !e.repeat && keys++, { capture: true, passive: true });
addEventListener('pointerdown', (e) => e.isTrusted && clicks++, { capture: true, passive: true });
addEventListener(
  'scroll',
  () => {
    const t = Date.now();
    if (t - lastScroll > 500) scrolls++;
    lastScroll = t;
  },
  { capture: true, passive: true },
);
const playing = () =>
  [...document.querySelectorAll<HTMLMediaElement>('video,audio')].some(
    (m) => !m.paused && !m.ended && m.readyState > 2 && (m.duration > 5 || m.duration === Infinity),
  );

function beat(left = false): void {
  const busy = keys || clicks || scrolls || playing();
  // frames inside the page only report what happened in them
  if (!top && !busy) return;
  if (!left && document.visibilityState !== 'visible') return;
  void send({ type: 'page.beat', keys, clicks, scrolls, playing: playing(), ...(left ? { left } : {}) });
  keys = clicks = scrolls = 0;
}
setInterval(() => (top ? document.visibilityState === 'visible' : true) && beat(), 15_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (keys || clicks || scrolls) beat(true);
    remember();
  }
});

// ------------------------------------------------------------------ text

/** The words of the page worth reading: the article if there is one, without menus and footers. */
export function pageText(max = 20_000): string {
  const root =
    document.querySelector<HTMLElement>('article') ??
    document.querySelector<HTMLElement>('main,[role=main]') ??
    document.body;
  if (!root) return '';
  const text = (root.innerText ?? '').length > 300 ? root.innerText : (document.body?.innerText ?? '');
  return text
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*(\n\s*)*/g, '\n')
    .trim()
    .slice(0, max);
}

function price(): { price: number; currency: string } | null {
  const dig = (o: unknown, depth = 0): { price: number; currency: string } | null => {
    if (!o || typeof o !== 'object' || depth > 6) return null;
    if (Array.isArray(o)) {
      for (const x of o) {
        const r = dig(x, depth + 1);
        if (r) return r;
      }
      return null;
    }
    const r = o as Record<string, unknown>;
    const isProduct = [r['@type']].flat().includes('Product');
    if (isProduct) {
      const offer = [r.offers].flat()[0] as Record<string, unknown> | undefined;
      const p = Number(String(offer?.price ?? offer?.lowPrice ?? '').replace(/,/g, ''));
      if (p > 0) return { price: p, currency: String(offer?.priceCurrency ?? '') || 'INR' };
    }
    return dig(r['@graph'], depth + 1);
  };
  const found: { price: number; currency: string }[] = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]'))
    try {
      const r = dig(JSON.parse(s.textContent ?? ''));
      if (r) found.push(r);
    } catch {
      /* not ours to fix */
    }
  if (found[0]) return found[0];
  const meta = (p: string) =>
    document.querySelector<HTMLMetaElement>(`meta[property="${p}"],meta[itemprop="${p}"]`)?.content;
  const p = Number((meta('product:price:amount') ?? meta('og:price:amount') ?? '').replace(/,/g, ''));
  return p > 0
    ? { price: p, currency: meta('product:price:currency') ?? meta('og:price:currency') ?? 'INR' }
    : null;
}

const hasPassword = () => document.querySelector('input[type=password]') !== null;

// a page counts as read after 20 seconds in front; what was read is kept when leaving it
let front = 0;
let sentMs = 0;
let first = true;
let at = location.href;
if (top)
  setInterval(() => {
    if (location.href !== at) {
      // the same tab moved on without loading a new page
      at = location.href;
      front = sentMs = 0;
      first = true;
    }
    if (document.visibilityState === 'visible' && document.hasFocus()) front += 5000;
    if (front === 20_000) remember();
  }, 5000);
function remember(): void {
  if (!top || front < 20_000 || front === sentMs) return;
  void send({
    type: 'page.read',
    title: document.title,
    text: pageText(),
    dwellMs: front - sentMs,
    first,
    hasPassword: hasPassword(),
    price: price(),
  });
  sentMs = front;
  first = false;
}

// ------------------------------------------------------------------ sign-ins

const passwords = () => [...document.querySelectorAll<HTMLInputElement>('input[type=password]')];

/** The user name that goes with a password: the last text-like field before it. */
function usernameFor(pw: HTMLInputElement): HTMLInputElement | null {
  const list = [...(pw.form ?? document).querySelectorAll<HTMLInputElement>('input')].filter(
    (i) => /^(text|email|tel|)$/.test(i.type) && !i.disabled,
  );
  const byHint = list.find((i) => /username|email/.test(i.autocomplete));
  if (byHint) return byHint;
  const prior = list.filter((i) => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
  return prior.findLast((i) => visible(i)) ?? prior.at(-1) ?? null;
}

let told = '';
function signIn(): void {
  if (!top) return; // only the page itself (ADR-0017)
  const filled = passwords().filter((p) => p.value.length >= 4);
  // the new password in a change form is the last one, repeated
  const pw = filled.find((p, i) => filled.findIndex((x) => x.value === p.value) !== i) ?? filled.at(-1);
  if (!pw) return;
  const username = usernameFor(pw)?.value.trim().slice(0, 200) ?? '';
  const id = `${username}\n${pw.value}`;
  if (told === id) return;
  told = id;
  void send({ type: 'page.login', username, password: pw.value.slice(0, 500) });
}
addEventListener('submit', (e) => e.isTrusted && signIn(), true);
addEventListener(
  'keydown',
  (e) => e.isTrusted && e.key === 'Enter' && passwords().some((p) => p.value) && signIn(),
  true,
);
addEventListener(
  'click',
  (e) => {
    const b =
      e.isTrusted && e.target instanceof Element
        ? e.target.closest('button,input[type=submit],[role=button]')
        : null;
    if (b && passwords().some((p) => p.value) && !/show|hide|forgot|reveal/i.test(b.textContent ?? ''))
      signIn();
  },
  true,
);

/** Puts a login in. The extension has already checked who this page is; it is checked once more here. */
function fillLogin(o: { host: string; username: string; password: string }): 'done' | 'no-field' | 'moved' {
  if (!top || location.hostname !== o.host) return 'moved';
  const pws = passwords().filter(visible);
  const pw = pws.find((p) => p.autocomplete !== 'new-password') ?? pws[0];
  const user = pw
    ? usernameFor(pw)
    : [...document.querySelectorAll<HTMLInputElement>('input')].find(
        (i) =>
          visible(i) &&
          (/username|email/.test(i.autocomplete) ||
            i.type === 'email' ||
            /user|email|login/i.test(i.name + i.id)),
      );
  if (!pw && !user) return 'no-field';
  if (user && visible(user) && o.username) typeInto(user, o.username);
  if (pw) typeInto(pw, o.password);
  return 'done';
}
/** A new password, in every empty password box of the form (password and repeat). */
function fillNew(o: { host: string; password: string }): 'done' | 'no-field' | 'moved' {
  if (!top || location.hostname !== o.host) return 'moved';
  const empty = passwords().filter((p) => visible(p) && !p.value);
  if (!empty.length) return 'no-field';
  empty.forEach((p) => typeInto(p, o.password));
  return 'done';
}
function typeInto(el: HTMLInputElement, value: string): void {
  el.focus({ preventScroll: true });
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ------------------------------------------------------------------ the focus shield

let shield: HTMLElement | null = null;
async function checkShield(): Promise<void> {
  if (!top) return;
  const s = await send<{ what: string; minutes: number } | null>({ type: 'page.shield' });
  if (!s) {
    shield?.remove();
    shield = null;
    return;
  }
  if (shield?.isConnected) return;
  for (const m of document.querySelectorAll<HTMLMediaElement>('video,audio')) m.pause();
  shield = document.createElement('div');
  shield.style.cssText = 'position:fixed;inset:0;z-index:2147483647';
  const root = shield.attachShadow({ mode: 'closed' });
  const css = document.createElement('style');
  css.textContent = `.w{position:fixed;inset:0;display:grid;place-items:center;background:#0b1020f5;color:#eef2ff;font:16px system-ui,'Segoe UI',sans-serif}
.c{max-width:440px;padding:32px;text-align:center}h1{font-size:26px;margin:0 0 10px}p{color:#a5b0cf;margin:0 0 22px}
button{font:inherit;border:0;border-radius:12px;padding:11px 18px;margin:4px;cursor:pointer}.a{background:#3b82f6;color:#fff}.b{background:#ffffff1a;color:#cbd5f5}`;
  const w = document.createElement('div');
  w.className = 'w';
  const c = document.createElement('div');
  c.className = 'c';
  c.setAttribute('role', 'dialog');
  const h = document.createElement('h1');
  h.textContent = s.what || 'You are focusing';
  const p = document.createElement('p');
  p.textContent = `${s.minutes} min left. This can wait.`;
  const back = document.createElement('button');
  back.className = 'a';
  back.textContent = 'Back to it';
  back.onclick = () => (history.length > 1 ? history.back() : window.close());
  const five = document.createElement('button');
  five.className = 'b';
  five.textContent = '5 minutes here';
  five.onclick = async (e) => {
    if (!e.isTrusted) return;
    await send({ type: 'page.bypass' });
    shield?.remove();
    shield = null;
  };
  c.append(h, p, back, five);
  w.append(c);
  root.append(css, w);
  document.documentElement.append(shield);
}
if (top) {
  void checkShield();
  setInterval(() => document.visibilityState === 'visible' && void checkShield(), 20_000);
}

// ------------------------------------------------------------------ what the extension may ask

/** Called by the extension through chrome.scripting in this isolated world; page scripts cannot see it. */
const api = {
  scan,
  fill,
  undo,
  answers,
  fillLogin,
  fillNew,
  text: () => ({
    title: document.title,
    url: location.href,
    text: pageText(24_000),
    selection: String(getSelection() ?? '').slice(0, 20_000),
    hasPassword: hasPassword(),
    forms: scan().fields.length,
  }),
  shield: checkShield,
  host: () => location.hostname,
};
export type PageApi = typeof api;
(globalThis as unknown as { __orvyn: PageApi }).__orvyn = api;
