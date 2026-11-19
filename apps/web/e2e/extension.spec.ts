import { chromium, expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { OWNER, signInWithEmail } from './helpers';

const EXT_DIR = resolve(__dirname, '../../extension/dist/e2e');
const EXT_ID = 'hapijaoahockgcidibcnbghpajpnnanh'; // pinned by apps/extension/dev-key.json

test('the Chrome extension connects through the web app and shows live notifications', async () => {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'orvyn-ext-')), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    expect(sw.url()).toContain(EXT_ID);

    const popup = await ctx.newPage();
    const crashes: string[] = [];
    popup.on('pageerror', (e) => crashes.push(e.message));
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
    await expect(popup.getByRole('heading', { name: 'Bring ORVYN into Chrome' })).toBeVisible();

    // Connect opens the web app's approval page in its own window
    const approvalWindow = ctx.waitForEvent('page');
    await popup.getByRole('button', { name: 'Connect to ORVYN' }).click();
    const auth = await approvalWindow;
    await auth.waitForLoadState();
    await expect(auth).toHaveURL(/\/sign-in\?next=/);
    const back = new URL(auth.url()).searchParams.get('next')!;
    await signInWithEmail(auth, OWNER, auth.url().replace('http://localhost:3100', ''), back);
    await auth.getByRole('button', { name: 'Connect' }).click();

    // the extension redeems the code itself; the popup turns live
    await auth.waitForEvent('close', { timeout: 10_000 }); // Chrome closes the approval window on the redirect
    await expect(popup.getByText('Live')).toBeVisible({ timeout: 15_000 });
    await expect(popup.getByText(OWNER)).toBeVisible();

    // connecting a new device already raised a "new sign-in" alert for the owner's other devices
    const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));
    const before = Number((await badge()) || 0);
    await popup.getByRole('button', { name: 'Send a test' }).click();
    await expect(popup.getByText('Hello from ORVYN')).toBeVisible({ timeout: 10_000 });
    await expect.poll(badge).toBe(String(before + 1));

    await popup.getByRole('button', { name: 'Dismiss Hello from ORVYN' }).click();
    await expect(popup.getByText('Hello from ORVYN')).toHaveCount(0);
    await expect.poll(badge).toBe(before ? String(before) : '');

    // quick capture from any page: to Today (parsed like everywhere) and to Drop
    await popup.getByLabel('Add or drop').fill('renew driving licence @Errands');
    await popup.getByRole('button', { name: 'Add to Today' }).click();
    await expect(popup.getByRole('status')).toHaveText('Added to Today: Renew driving licence');
    await popup.getByLabel('Add or drop').fill('https://example.test/long-read');
    await popup.getByRole('button', { name: 'Drop' }).click();
    await expect(popup.getByRole('status')).toHaveText('Dropped — a suggestion is on its way');
    const web = await ctx.newPage();
    await web.goto('http://localhost:3100/today');
    await expect(web.getByText('Renew driving licence')).toBeVisible({ timeout: 15_000 });
    await web.goto('http://localhost:3100/drop');
    await expect(web.getByLabel('Dropped: https://example.test/long-read')).toBeVisible({ timeout: 15_000 });
    await web.close();

    // Today in the toolbar: the captured task is there and is ticked off right here
    await popup.getByRole('tab', { name: 'Today' }).click();
    await popup.getByRole('button', { name: 'Complete Renew driving licence' }).click();
    await expect(popup.getByText('Renew driving licence')).toHaveCount(0);

    // money in words gets its own button; the Money tab shows the month
    await popup.getByLabel('Add or drop').fill('spent 340 on dinner');
    await popup.getByRole('button', { name: /Add ₹340/ }).click();
    await expect(popup.getByRole('status')).toHaveText(/^Spent ₹340/);
    await popup.getByRole('tab', { name: 'Money' }).click();
    await expect(popup.getByLabel('Money').getByText('Spent this month')).toBeVisible();
    await expect(popup.getByLabel('Money').getByText('₹340').first()).toBeVisible();

    await popup.getByRole('button', { name: 'Disconnect' }).click();
    await expect(popup.getByRole('button', { name: 'Connect to ORVYN' })).toBeVisible();
    expect(crashes).toEqual([]);
  } finally {
    await ctx.close();
  }
});
