import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BrowserContext, chromium, expect, type Page, test, type Worker } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

const EXT_DIR = resolve(__dirname, '../../extension/dist/e2e');
const EXT_ID = 'hapijaoahockgcidibcnbghpajpnnanh';
const PASS = 'correct horse battery staple';

/** A page with a form: a plain field, a "controlled" one (like React), choices, a trap and a file. */
const FORM = `<!doctype html><title>Apply</title><body><h1>Apply</h1>
<form id=f action=/sent><label>First name <input name=first></label>
<label for=e>Email address</label><input id=e>
<label>Last name <input name=last value="Mine"></label>
<div><label for=c>Country</label><select id=c><option value="">Select</option><option>India</option><option>USA</option></select></div>
<fieldset><legend>Notice period</legend><label><input type=radio name=n value=1>15 days</label><label><input type=radio name=n value=2>30 days</label></fieldset>
<label>Email <input name=trap style="opacity:0"></label>
<label>I agree to everything <input type=checkbox id=agree></label>
<label>Resume <input type=file></label><button>Send</button></form>
<script>
 // a controlled field: the framework's copy wins unless a real input event arrives
 var state='';var e=document.getElementById('e');e.addEventListener('input',function(){state=e.value});
 setInterval(function(){if(e.value!==state)e.value=state},100);
 document.getElementById('f').addEventListener('submit',function(){document.title='SENT'});
</script>`;
const LOGIN = `<!doctype html><title>Sign in</title><form action=/welcome><input name=user autocomplete=username><input type=password name=pw><button>Sign in</button></form>`;
const ARTICLE = `<!doctype html><title>Growing saffron indoors</title><article><h1>Growing saffron indoors</h1><p>${'Saffron corms need cool nights and dry soil. '.repeat(30)}</p></article>`;

let server: Server;
let ctx: BrowserContext;
let sw: Worker;
let popup: Page;
const SITE = 'http://localhost:3210';

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    const p = (req.url ?? '/').split('?')[0];
    res.end(
      p === '/form'
        ? FORM
        : p === '/signin'
          ? LOGIN
          : p === '/welcome'
            ? '<title>Welcome</title>Hello'
            : ARTICLE,
    );
  });
  await new Promise<void>((ok) => server.listen(3210, ok));
  ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'orvyn-ext-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
  const approval = ctx.waitForEvent('page');
  await popup.getByRole('button', { name: 'Connect to ORVYN' }).click();
  const auth = await approval;
  await auth.waitForLoadState();
  await expect(auth).toHaveURL(/\/sign-in\?next=/);
  const back = new URL(auth.url()).searchParams.get('next')!;
  await signInWithEmail(auth, OWNER, auth.url().replace('http://localhost:3100', ''), back);
  await auth.getByRole('button', { name: 'Connect' }).click();
  await auth.waitForEvent('close', { timeout: 10_000 });
  await expect(popup.getByText('Live')).toBeVisible({ timeout: 15_000 });
});
test.afterAll(async () => {
  await ctx?.close();
  server?.close();
});

/** Asks the background as the popup does, while `page` is in front. */
async function ask<T>(page: Page, req: object): Promise<{ ok?: T; error?: string }> {
  await page.bringToFront();
  return popup.evaluate((r) => chrome.runtime.sendMessage(r), req) as Promise<{ ok?: T; error?: string }>;
}

test('fills a form from my details, never sends it, and puts it back (AC3)', async () => {
  const page = await ctx.newPage();
  await page.goto(`${SITE}/form`);
  const facts = [
    ['first_name', 'First name', 'Asha'],
    ['last_name', 'Last name', 'Rao'],
    ['email', 'Email', 'asha@example.test'],
    ['country', 'Country', 'India'],
    ['notice_period', 'Notice period', '30 days'],
  ].map(([key, label, value]) => ({ key, label, value, group: 'other' }));
  expect(
    (await ask(page, { type: 'saveProfile', profile: { facts, answers: [], story: '' } })).error,
  ).toBeUndefined();
  const r = await ask<{ filled: { label: string }[]; files: number }>(page, { type: 'fill' });
  expect(r.error).toBeUndefined();
  await page.waitForTimeout(400); // the controlled field would have undone a fake value by now
  expect(await page.locator('[name=first]').inputValue()).toBe('Asha');
  expect(await page.locator('#e').inputValue()).toBe('asha@example.test');
  expect(await page.locator('[name=last]').inputValue()).toBe('Mine'); // what I typed stays
  expect(await page.locator('#c').inputValue()).toBe('India');
  expect(await page.locator('[name=n][value="2"]').isChecked()).toBe(true);
  expect(await page.locator('[name=trap]').inputValue()).toBe(''); // hidden: not given
  expect(await page.locator('#agree').isChecked()).toBe(false); // consent stays mine
  expect(await page.title()).toBe('Apply'); // not sent
  expect(r.ok!.files).toBe(1);
  expect((await ask<number>(page, { type: 'undoFill' })).ok).toBe(4);
  expect(await page.locator('[name=first]').inputValue()).toBe('');
  expect(await page.locator('[name=n][value="2"]').isChecked()).toBe(false);

  // it learns what I answered here
  await page.locator('[name=first]').fill('Ash');
  expect((await ask<number>(page, { type: 'learn' })).ok).toBeGreaterThan(0);
  await page.locator('[name=first]').fill('');
  await ask(page, { type: 'fill' });
  expect(await page.locator('[name=first]').inputValue()).toBe('Ash');
  await page.close();
});

test('a page cannot ask for anything', async () => {
  const page = await ctx.newPage();
  await page.goto(`${SITE}/article`);
  const seen = await page.evaluate(() => ({
    orvyn: '__orvyn' in window,
    runtime: typeof (window as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime
      ?.sendMessage,
  }));
  expect(seen).toEqual({ orvyn: false, runtime: 'undefined' });
  await page.close();
});

test('offers to save a sign-in, saves it, and fills it only on its own site (AC5, AC6)', async () => {
  let pass = PASS;
  // a Vault, made in the web app as a person would
  const web = await ctx.newPage();
  await web.goto('http://localhost:3100/vault');
  await expect(web.getByRole('heading', { name: 'Vault', level: 1 })).toBeVisible();
  await expect(web.getByLabel('Passphrase', { exact: true })).toBeVisible();
  await web.waitForLoadState('networkidle'); // until this device has synced, it can't know a Vault exists
  // the Vault test that ran before may have made it already; it leaves this passphrase
  if (await web.getByRole('button', { name: 'Create my Vault' }).isVisible()) {
    await web.getByLabel('Passphrase', { exact: true }).fill(PASS);
    await web.getByLabel('Again').fill(PASS);
    await web.getByRole('button', { name: 'Create my Vault' }).click();
    await expect(web.getByTestId('recovery-key')).toBeVisible();
    await web.waitForTimeout(1500);
  } else pass = 'a brand new passphrase';
  // ORVYN's own passphrase is never offered for saving
  expect(await sw.evaluate(() => chrome.storage.session.get('pendingLogin'))).toEqual({});
  await web.close();

  const page = await ctx.newPage();
  await page.goto(`${SITE}/signin`);
  await page.locator('[name=user]').fill('asha');
  await page.locator('[name=pw]').fill('S3cret-first');
  await page.getByRole('button').click();
  await expect(page).toHaveTitle('Welcome');
  type V = {
    state: string;
    pending: { host: string; updates?: string } | null;
    logins: { id: string; fits: boolean }[];
  };
  await expect.poll(async () => (await ask<V>(page, { type: 'vault' })).ok?.pending?.host).toBe('localhost');
  expect((await ask(page, { type: 'unlock', passphrase: 'wrong wrong wrong' })).error).toBe(
    'That is not the passphrase',
  );
  expect((await ask(page, { type: 'unlock', passphrase: pass })).error).toBeUndefined();
  expect((await ask<string>(page, { type: 'savePending' })).ok).toBe('Saved in the Vault');

  // nothing readable is on disk
  const disk = await sw.evaluate(async () => JSON.stringify(await chrome.storage.local.get()));
  expect(disk).not.toContain('S3cret');
  expect(disk).not.toContain(pass);

  await page.goto(`${SITE}/signin`);
  let v = (await ask<V>(page, { type: 'vault' })).ok!;
  expect(v.logins.filter((l) => l.fits)).toHaveLength(1);
  expect((await ask<string>(page, { type: 'fillLogin', id: v.logins[0]!.id })).ok).toMatch(/^Filled/);
  expect(await page.locator('[name=user]').inputValue()).toBe('asha');
  expect(await page.locator('[name=pw]').inputValue()).toBe('S3cret-first');
  expect(await page.title()).toBe('Sign in'); // not submitted

  // the same password: no question. A new one: an update.
  await page.getByRole('button').click();
  await expect(page).toHaveTitle('Welcome');
  expect((await ask<V>(page, { type: 'vault' })).ok!.pending).toBeNull();
  await page.goto(`${SITE}/signin`);
  await page.locator('[name=user]').fill('asha');
  await page.locator('[name=pw]').fill('S3cret-second');
  await page.getByRole('button').click();
  await expect
    .poll(async () => (await ask<V>(page, { type: 'vault' })).ok?.pending?.updates)
    .toBe(v.logins[0]!.id);
  expect((await ask<string>(page, { type: 'savePending' })).ok).toBe('Password updated in the Vault');

  // another site (another port): not offered, and refused if asked
  const mine = v.logins.find((l) => l.fits)!.id;
  await page.goto('http://localhost:3100/sign-in');
  v = (await ask<V>(page, { type: 'vault' })).ok!;
  expect(v.logins.filter((l) => l.fits)).toEqual([]);
  expect((await ask(page, { type: 'fillLogin', id: mine })).error).toBe('This login is for another site');

  await ask(page, { type: 'lock' });
  expect((await ask<V>(page, { type: 'vault' })).ok!.state).toBe('locked');
  await page.close();
});

test('My Day records the page in front; the web app shows it; focus holds a site back (AC10)', async () => {
  const page = await ctx.newPage();
  await page.goto(`${SITE}/article`);
  await page.bringToFront();
  // nobody may be at this machine while tests run: Chrome is told someone is
  await sw.evaluate(() => {
    chrome.idle.queryState = (async () => 'active') as never;
    const get = chrome.windows.getLastFocused.bind(chrome.windows);
    chrome.windows.getLastFocused = (async () => ({ ...(await get()), focused: true })) as never;
  });
  await page.mouse.click(50, 50);
  await page.keyboard.type('hello');
  await page.waitForTimeout(34_000); // two beats
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = await ask<{ places: { place: string; ms: number; whats: { what: string }[] }[]; keys: number }>(
    page,
    {
      type: 'day',
      date,
    },
  );
  expect(day.error).toBeUndefined();
  const here = day.ok!.places.find((p) => p.place === 'Local site');
  expect(here?.whats.some((w) => w.what === 'Growing saffron indoors')).toBe(true);
  expect(day.ok!.keys).toBeGreaterThanOrEqual(5);

  const web = await ctx.newPage();
  await web.goto('http://localhost:3100/day');
  await expect(web.getByRole('heading', { name: 'My Day' })).toBeVisible();
  await expect(web.getByLabel('Places').getByText('Local site')).toBeVisible({ timeout: 15_000 });
  await web.screenshot({ path: 'test-results/my-day.png', fullPage: true });
  await web.close();

  // notes and memory on this page (local pages are never kept by Recall itself)
  const noted = await ask<{ memory: { notes: { text: string }[] } }>(page, {
    type: 'note',
    text: 'Try this in winter',
  });
  expect(noted.ok!.memory.notes[0]!.text).toBe('Try this in winter');

  await sw.evaluate(() =>
    chrome.storage.local.set({
      rules: { at: Date.now(), rules: { categories: {}, blocked: ['localhost'] } },
    }),
  );
  await ask(page, { type: 'focus', what: 'Write the spec', minutes: 25 });
  await page.reload();
  await page.waitForTimeout(1500);
  const held = await page.evaluate(() => {
    const el = document.documentElement.lastElementChild as HTMLElement;
    return el.tagName === 'DIV' && el.style.position === 'fixed';
  });
  expect(held).toBe(true);
  await ask(page, { type: 'unfocus' });
  await page.close();
});

test('the popup shows every part', async () => {
  const crashes: string[] = [];
  popup.on('pageerror', (e) => crashes.push(e.message));
  await popup.bringToFront();
  await popup.reload();
  await popup.setViewportSize({ width: 380, height: 640 });
  for (const t of ['Page', 'Fill', 'Vault', 'Recall', 'Day', 'Money', 'Find', 'Today']) {
    await popup.getByRole('tab', { name: t, exact: true }).click();
    await popup.waitForTimeout(500);
    await popup.screenshot({ path: `test-results/popup-${t}.png` });
  }
  expect(crashes).toEqual([]);
});
