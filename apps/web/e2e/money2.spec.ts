import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('Money v2: an expense for another day or month, search and filters, export, and a repeating entry', async ({
  page,
}) => {
  await signInWithEmail(page, OWNER);
  await page.getByRole('link', { name: 'Money' }).first().click();
  await expect(page.getByRole('heading', { name: 'Money', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const spent = async () =>
    Number(((await page.getByLabel('Spent this month').textContent()) ?? '0').replace(/[^\d]/g, ''));
  const before = await spent();
  const now = new Date();
  const firstOfMonth = iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const lastMonth = iso(new Date(now.getFullYear(), now.getMonth() - 1, 15));

  // 1. the full form: a day earlier in this month
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  const add = page.getByRole('dialog', { name: 'Add transaction' });
  await add.getByLabel('Amount (₹)').fill('640');
  await add.getByLabel('Merchant or what for').fill('Zorba dinner');
  await add.getByLabel('Day').fill(firstOfMonth);
  await add.getByRole('button', { name: 'Add', exact: true }).click();
  const list = page.getByRole('list', { name: 'Transactions this month' });
  await expect(list.getByText('Zorba dinner')).toBeVisible();
  await expect.poll(spent).toBe(before + 640);

  // a day that hasn't happened yet is refused (unless it repeats)
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  const again = page.getByRole('dialog', { name: 'Add transaction' });
  await again.getByLabel('Amount (₹)').fill('10');
  await again.getByLabel('Day').fill(iso(new Date(now.getFullYear() + 1, 0, 1)));
  await again.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(again.getByRole('alert')).toContainText('hasn’t happened yet');

  // 2. last month: not in this month's list, but in last month's
  await again.getByLabel('Amount (₹)').fill('300');
  await again.getByLabel('Merchant or what for').fill('Old cinema');
  await again.getByLabel('Day').fill(lastMonth);
  await again.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Spent ₹300')).toBeVisible();
  await expect(list.getByText('Old cinema')).toHaveCount(0);
  expect(await spent()).toBe(before + 640);
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(list.getByText('Old cinema')).toBeVisible();
  await page.getByRole('button', { name: 'This month' }).click();

  // 3. typing a day: the chip says which
  await page.getByLabel('New transaction').fill('spent 50 on chai yesterday');
  await expect(page.getByText(/₹50 .*yesterday/)).toBeVisible();
  await page.getByLabel('New transaction').fill('');

  // 4. search and filters
  await page.getByLabel('Search transactions').fill('zorba');
  await expect(list.getByText('Zorba dinner')).toBeVisible();
  await expect(page.getByText(/1 found · ₹640 spent/)).toBeVisible();
  await page.getByLabel('Search transactions').fill('old cinema');
  await expect(page.getByText('Nothing matches')).toBeVisible();
  await page.getByLabel('All time').check();
  await expect(list.getByText('Old cinema')).toBeVisible();

  // 5. export what's shown
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to a spreadsheet' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('orvyn-money-all.csv');
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv).toContain('Date,Time,Type,Amount');
  expect(csv).toContain('Old cinema');
  expect(csv).not.toContain('Zorba dinner');
  await page.getByRole('button', { name: 'Clear' }).click();

  // 6. a repeating entry: every day since two days ago → added for each day, once
  const twoDaysAgo = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2));
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  const rep = page.getByRole('dialog', { name: 'Add transaction' });
  await rep.getByLabel('Amount (₹)').fill('100');
  await rep.getByLabel('Merchant or what for').fill('Gym pass');
  await rep.getByLabel('Day').fill(twoDaysAgo);
  await rep.getByRole('switch', { name: 'Repeats' }).click();
  await rep.getByRole('radio', { name: 'Daily' }).click();
  await expect(rep.getByText('Every day', { exact: true })).toBeVisible();
  await expect(rep.getByText(/^Next: /)).toBeVisible();
  await rep.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Scheduled', { exact: true })).toBeVisible();
  const fresh = page.getByRole('list', { name: 'New transactions' });
  await expect(fresh.getByText('Gym pass')).toHaveCount(3, { timeout: 20_000 });

  // managed in one place; pausing keeps what's there
  await page.getByRole('button', { name: /Manage accounts/ }).click();
  const manage = page.getByRole('dialog', { name: 'Manage money' });
  await expect(manage.getByText(/Every day/)).toBeVisible();
  await manage.getByRole('button', { name: 'Pause Gym pass' }).click();
  await expect(manage.getByText('Paused')).toBeVisible();

  // accounts and categories can be added here too
  await manage.getByRole('radio', { name: 'Accounts' }).click();
  await manage.getByLabel('Account name').fill('Cash wallet');
  await manage.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(manage.getByText('Cash wallet')).toBeVisible();
  await manage.getByRole('radio', { name: 'Categories' }).click();
  await manage.getByLabel('Category name').fill('Pets');
  await manage.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(manage.getByLabel('Rename Pets')).toBeVisible();
  await page.keyboard.press('Escape');

  // leave things tidy for the next test
  await page.getByRole('button', { name: 'All fine' }).click();
  await expect(page.getByRole('list', { name: 'New transactions' })).toHaveCount(0);
});
