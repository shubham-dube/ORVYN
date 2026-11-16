import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

test('Today: add, complete, and the task follows you to another device — live, and offline-first', async ({
  page,
  browser,
}) => {
  await signInWithEmail(page, OWNER);
  await page.getByRole('link', { name: 'Today' }).first().click();
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();

  // a second device, signed in separately, watching Today
  const other = await (await browser.newContext()).newPage();
  await signInWithEmail(other, OWNER);
  await other.goto('/today');
  await expect(other.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();

  await page.getByLabel('New task').fill('Pay electricity bill');
  await page.keyboard.press('Enter');
  const todayList = page.getByRole('list', { name: 'Today' });
  await expect(todayList.getByText('Pay electricity bill')).toBeVisible();

  // arrives on the other device through the socket nudge, no reload
  await expect(other.getByRole('list', { name: 'Today' }).getByText('Pay electricity bill')).toBeVisible({
    timeout: 10_000,
  });

  // offline on the first device: still works, syncs when back
  await page.context().setOffline(true);
  await page.getByLabel('New task').fill('Call the plumber');
  await page.getByRole('radio', { name: 'Someday' }).click();
  await page.keyboard.press('Enter');
  await page.getByLabel('New task').press('Enter');
  await expect(page.getByRole('list', { name: 'Inbox' }).getByText('Call the plumber')).toBeVisible();
  await expect(page.getByText(/waiting to sync/)).toBeVisible();
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/waiting to sync/)).toHaveCount(0, { timeout: 10_000 });
  await expect(other.getByRole('list', { name: 'Inbox' }).getByText('Call the plumber')).toBeVisible({
    timeout: 10_000,
  });

  // complete on the second device → it settles into "Done today" on both
  await other.getByRole('checkbox', { name: 'Complete Pay electricity bill' }).click();
  await expect(
    other.getByRole('list', { name: 'Done today' }).getByText('Pay electricity bill'),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Done today' }).getByText('Pay electricity bill')).toBeVisible({
    timeout: 10_000,
  });

  // edit in the sheet: give it a time and high priority
  await page.getByRole('button', { name: 'Call the plumber' }).click();
  await page.getByLabel('Day', { exact: true }).fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel('Time', { exact: true }).fill('23:30');
  await page.getByRole('radio', { name: 'High' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('list', { name: 'Today' }).getByText('Call the plumber')).toBeVisible();
  await expect(page.getByLabel('High priority')).toBeVisible();

  // survives a reload (persisted locally and on the server)
  await page.reload();
  await expect(page.getByRole('list', { name: 'Today' }).getByText('Call the plumber')).toBeVisible();
});

test('the command bar turns anything typed into a task, from any page', async ({ page }) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
  await page.getByRole('button', { name: /Ask or do anything/ }).click(); // same bar as Ctrl/⌘-K
  await page.getByRole('combobox', { name: 'Command' }).fill('Renew passport');
  await page.getByRole('option', { name: /Add “Renew passport” to Today/ }).click();
  await expect(page.getByText('Added to Today')).toBeVisible();
  await page.getByRole('link', { name: 'Today' }).first().click();
  await expect(page.getByRole('list', { name: 'Today' }).getByText('Renew passport')).toBeVisible();
});
