import { expect, test } from '@playwright/test';
import { b64, chatReady, PcChannel } from '@orvyn/vault-crypto';
import { API, OWNER, signInWithEmail } from './helpers';

/** The PC side, played here: the real one is Rust and has its own tests against this API (live_api.rs). */
test('My PC: pair by link, PIN, a live terminal, back after the PC drops', async ({
  page,
  request,
}, info) => {
  await chatReady();
  await signInWithEmail(page, OWNER);
  const device = { name: 'ORVYN on TEST-PC', platform: 'windows', appVersion: '1' };
  await expect
    .poll(async () => (await request.post(`${API}/auth/email/start`, { data: { email: OWNER } })).status())
    .toBe(200);
  const mail = (await (await request.get(`${API}/dev/mailbox?email=${OWNER}`)).json()) as { subject: string };
  const code = /\d{6}/.exec(mail.subject)![0];
  const session = (await (
    await request.post(`${API}/auth/email/verify`, { data: { email: OWNER, code, device } })
  ).json()) as { accessToken: string };

  const key = new Uint8Array(32).fill(9);
  const id = b64(new Uint8Array(12).fill(5));
  const PIN = 'a right pin';
  let chan: PcChannel | null = null;
  let at = { to: '', s: '' };
  let typed = '';
  let size = '';
  let half = 0;
  let sent = 0;
  const ws = new WebSocket(`${API.replace('http', 'ws')}/ws`);
  const say = (m: unknown) =>
    ws.send(JSON.stringify({ type: 'pc', ...at, d: chan!.seal(JSON.stringify(m)) }));
  const term = { id: 't1', name: 'PowerShell', since: 0, exit: null };
  const out = (d: string) => say({ t: 'out', id: 't1', d, end: (sent += d.length), reset: false });
  let terms: unknown[] = [];
  const inputs: Record<string, unknown>[] = [];
  // a 1×1 JPEG
  const PIXEL = Uint8Array.from(
    atob(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    ),
    (c) => c.charCodeAt(0),
  );
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: session.accessToken }));
  ws.onmessage = (e) => {
    const f = JSON.parse(String(e.data)) as { type: string; from: string; s: string; d: string };
    if (f.type !== 'pc') return;
    if (f.d === `o.${id}`) {
      at = { to: f.from, s: f.s };
      chan = new PcChannel(key, `${f.s}.h${++half}`, 'p');
      return ws.send(JSON.stringify({ type: 'pc', ...at, d: `r.h${half}` }));
    }
    const m = JSON.parse(chan!.open(f.d)) as Record<string, string>;
    if (m.t === 'auth' && m.pin !== PIN) say({ t: 'badpin', left: 4 });
    else if (m.t === 'auth')
      say({ t: 'hello', pc: 'PC', shells: [{ id: 'powershell', name: 'PowerShell' }], terms });
    else if (m.t === 'new') say({ t: 'opened', id: 't1', terms: (terms = [term]) });
    else if (m.t === 'attach') {
      size = `${m.cols}x${m.rows}`;
      if (!sent) out('PS C:\\> ');
      else out('still here ');
    } else if (m.t === 'watch') say({ t: 'terms', terms: [{ ...term, watch: m.on }] });
    else if (m.t === 'deck') say({ t: 'deck', sound: { volume: 40, muted: false } });
    else if (m.t === 'files')
      say({
        t: 'files',
        path: 'C:\\Users\\me',
        parent: 'C:\\Users',
        cut: false,
        list: [{ name: 'notes.txt', path: 'C:\\Users\\me\\notes.txt', dir: false, size: 5 }],
      });
    else if (m.t === 'places')
      say({ t: 'places', list: [{ name: 'Downloads', path: 'C:\Users\me\Downloads', dir: true, size: 0 }] });
    else if (m.t === 'live' && m.on) {
      say({ t: 'blob', id: 7, name: 'live.jpg', size: PIXEL.length, part: 24576 });
      say({ t: 'part', id: 7, n: 0, d: b64(PIXEL) });
    } else if (m.t === 'input') inputs.push(m as unknown as Record<string, unknown>);
    else if (m.t === 'get') {
      say({ t: 'blob', id: 1, name: 'notes.txt', size: 5, part: 24576 });
      say({ t: 'part', id: 1, n: 0, d: b64(new TextEncoder().encode('hello')) });
    } else if (m.t === 'in') {
      typed += m.d;
      out(m.d === '\r' ? '\r\nhello from the PC\r\n' : m.d!);
    }
  };

  await page.goto(`/pc#ORVYN-PC1.${id}.${b64(key)}.${b64(new TextEncoder().encode('Study PC'))}`);
  await expect(page.getByRole('heading', { name: 'Study PC' })).toBeVisible();
  expect(page.url()).not.toContain('ORVYN-PC1'); // the key is not left in the address bar
  await page.getByLabel('PIN').fill('wrong');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('Wrong PIN. 4 tries left.')).toBeVisible();
  await page.getByLabel('PIN').fill(PIN);
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('Live · encrypted')).toBeVisible();
  await page.getByRole('button', { name: 'PowerShell' }).click();
  const rows = page.locator('.xterm-rows');
  await expect(rows).toContainText('PS C:\\>');
  expect(size).toMatch(/^\d+x\d+$/);
  await page.keyboard.type('dir');
  await page.keyboard.press('Enter');
  await expect(rows).toContainText('hello from the PC');
  await page.getByRole('button', { name: 'Ctrl', exact: true }).click();
  await page.keyboard.type('c');
  await expect.poll(() => typed).toBe('dir\r\x03');
  await page.screenshot({ path: info.outputPath('terminal.png') });

  await page.getByRole('button', { name: 'Tell me when done' }).click();
  await expect(page.getByRole('button', { name: 'Will tell you' })).toBeVisible();
  // a suggestion runs only when Run is pressed (AC7)
  await page.route('**/pc/suggest', (r) =>
    r.fulfill({
      json: { command: 'Get-Date', why: 'Shows the time', careful: false },
      headers: {
        'access-control-allow-origin': 'http://localhost:3100',
        'access-control-allow-credentials': 'true',
      },
    }),
  );
  typed = '';
  await page.getByRole('button', { name: 'Say it' }).click();
  await page.getByLabel('What do you want to do?').fill('what time is it');
  await page.getByRole('button', { name: 'Suggest' }).click();
  await expect(page.getByLabel('Command', { exact: true })).toHaveValue('Get-Date');
  expect(typed).toBe('');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect.poll(() => typed).toBe('Get-Date\r');

  await page
    .getByRole('radio', { name: 'Deck' })
    .or(page.getByRole('tab', { name: 'Deck' }))
    .first()
    .click();
  // the screen live; a tap is a click where it was tapped
  await page.getByRole('button', { name: 'Show the screen live' }).click();
  const screen = page.getByAltText('The PC’s screen, live');
  await expect(screen).toBeVisible();
  const box = (await screen.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.75);
  await expect
    .poll(() => inputs.find((i) => i.k === 'click'))
    .toMatchObject({ k: 'click', x: expect.closeTo(0.25, 1), y: expect.closeTo(0.75, 1) });
  await page.getByRole('button', { name: 'Ctrl+C' }).click();
  await expect.poll(() => inputs.some((i) => i.k === 'key' && i.key === 'ctrl+c')).toBe(true);
  await page.getByRole('radio', { name: 'Controls' }).click();
  await expect(page.getByLabel('Volume')).toHaveValue('40');
  await page.getByRole('radio', { name: 'Files' }).click();
  await expect(page.getByRole('button', { name: 'Downloads' })).toBeVisible();
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download notes.txt' }).click();
  expect((await saved).suggestedFilename()).toBe('notes.txt');
  await page.screenshot({ path: info.outputPath('deck.png') });
  await page
    .getByRole('radio', { name: 'Terminal' })
    .or(page.getByRole('tab', { name: 'Terminal' }))
    .first()
    .click();

  // the PC comes back on a new session: the same terminal, without the PIN again
  ws.send(JSON.stringify({ type: 'pc', ...at, d: 'x.gone' }));
  await expect(rows).toContainText('still here');
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(page.getByRole('button', { name: 'Esc' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('phone.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // paired for next time, and forgotten on request
  await page.reload();
  await page.getByRole('button', { name: /Study PC/ }).click();
  await expect(page.getByLabel('PIN')).toBeVisible();
  ws.send(JSON.stringify({ type: 'pc', ...at, d: 'x.off' }));
  await expect(page.getByText('switched off on the PC')).toBeVisible();
  await page.getByRole('button', { name: 'Forget this PC here' }).click();
  await expect(page.getByText('Your PC, from here')).toBeVisible();
  ws.close();
});
