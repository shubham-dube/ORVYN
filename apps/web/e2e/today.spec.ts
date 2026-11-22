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

  // a day written: today (with nothing about a day it would wait in the Inbox, spec 0012 A5)
  await page.getByLabel('New task').fill('Pay electricity bill today');
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
  const sheet = page.getByRole('dialog', { name: 'Task' });
  await sheet.getByRole('button', { name: 'When' }).click();
  await sheet.getByLabel('Day', { exact: true }).fill(new Date().toISOString().slice(0, 10));
  await sheet.getByLabel('Time', { exact: true }).fill('23:30');
  await sheet.getByRole('button', { name: 'Priority' }).click();
  await page.getByRole('option', { name: 'High' }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
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

test('type naturally: chips show what was understood, and removing one keeps the words', async ({ page }) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/today');
  const add = page.getByLabel('New task');

  await add.fill('dentist fri 11 for 45m !!');
  const chips = page.getByRole('list', { name: 'Understood' });
  await expect(chips.getByText('45 min')).toBeVisible();
  await expect(chips.getByText('Medium')).toBeVisible();
  await expect(chips.getByText(/Fri/)).toBeVisible();
  await expect(page.getByText('Dentist', { exact: true })).toBeVisible(); // the title it will get
  await add.press('Enter');
  await expect(page.getByRole('button', { name: 'Dentist' })).toBeVisible();
  await expect(page.getByLabel('Medium priority')).toBeVisible();

  // "Friday" here is part of the name, not a date
  await add.fill('book Friday show tickets');
  await expect(page.getByText('Book show tickets', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Not a date: “Friday”' }).click();
  await expect(chips.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText('Inbox · pick a day')).toBeVisible(); // no day left: it will wait in the Inbox
  await add.press('Enter');
  await expect(page.getByRole('list', { name: 'Inbox' }).getByText('Book Friday show tickets')).toBeVisible();

  // a new @project is created on the way
  await add.fill('plan beds @garden every saturday');
  await expect(chips.getByText('garden (new project)')).toBeVisible();
  await expect(chips.getByText('every Sat')).toBeVisible();
  await add.press('Enter');
  await page.getByRole('button', { name: 'Plan beds' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Task' }).getByRole('button', { name: 'garden' }),
  ).toBeVisible();
});

test('the command bar reads naturally too', async ({ page }) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/today');
  await page.getByRole('button', { name: /Ask or do anything/ }).click();
  await page.getByRole('combobox', { name: 'Command' }).fill('pay rent every 1st');
  const option = page.getByRole('option', { name: /Add “Pay rent”/ });
  await expect(option).toContainText('every month on the 1st');
  await option.click();
  await expect(page.getByRole('list', { name: 'Upcoming' }).getByText('Pay rent')).toBeVisible();
  await expect(page.getByRole('button', { name: /Pay rent .* repeats/ })).toBeVisible();
});
