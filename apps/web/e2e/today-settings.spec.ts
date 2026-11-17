import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('working hours and reminders are mine: set once, change from a date, used on every device', async ({
  page,
  browser,
}) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/settings');
  const today = page.locator('section', { has: page.getByRole('heading', { name: 'Today', exact: true }) });
  await expect(today.getByText('Not set up yet.')).toBeVisible();

  // hours change from a future date: a new pattern copied from the current one
  const future = new Date();
  future.setDate(future.getDate() + 14);
  await today.getByLabel('Hours change from').fill(iso(future));
  await today.getByRole('button', { name: 'Add a new pattern' }).click();
  const newer = today.getByRole('group', { name: /Working pattern From/ });
  await expect(newer).toBeVisible();
  // in the new pattern, Saturday becomes a working day
  await newer.getByRole('button', { name: /Add .* Sat range/ }).click();

  // a day off next week
  const off = new Date();
  off.setDate(off.getDate() + 7);
  await today.getByLabel('Date', { exact: true }).fill(iso(off));
  await today.getByRole('button', { name: 'Day off' }).click();

  // reminders: 1 day before as well, and one summary at 08:30
  await today
    .getByRole('combobox', { name: /Add a reminder \(For things with a time\)/ })
    .selectOption('1440');
  await today.getByLabel('At', { exact: true }).fill('08:30');
  await today.getByRole('button', { name: 'Use these settings' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(today.getByText('Not set up yet.')).toHaveCount(0);

  // another device sees exactly the same
  const other = await (await browser.newContext()).newPage();
  await signInWithEmail(other, OWNER);
  await other.goto('/settings');
  const t2 = other.locator('section', { has: other.getByRole('heading', { name: 'Today', exact: true }) });
  await expect(t2.getByRole('group', { name: /Working pattern From/ })).toBeVisible({ timeout: 10_000 });
  await expect(t2.getByText('1 day before')).toBeVisible();
  await expect(t2.getByText('10 min before')).toBeVisible();
  await expect(t2.getByLabel('At', { exact: true })).toHaveValue('08:30');

  // bad input is explained, not saved
  await t2.getByRole('button', { name: /Remove 1 day before/ }).click();
  await t2.getByLabel('Don’t plan after').fill('');
  await expect(t2.getByRole('alert').filter({ hasText: 'HH:MM' })).toBeVisible();
  await expect(t2.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('a task can have its own reminders, or none', async ({ page }) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/today');
  await page.getByLabel('New task').fill('Team call');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Team call' }).click();
  await page.getByLabel('Time', { exact: true }).fill('18:00');
  await expect(page.getByText(/1 day before, 10 min before/)).toBeVisible(); // my defaults from the previous test
  await page.getByRole('radio', { name: 'Just for this task' }).click();
  await page.getByRole('button', { name: 'Remove 1 day before' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Team call' }).click();
  await expect(page.getByRole('radio', { name: 'Just for this task' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Remove 10 min before' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove 1 day before' })).toHaveCount(0);
});

test('with working hours set, the river shows free time and plans the day with reasons', async ({ page }) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/today');
  await page.getByLabel('New task').fill('Prepare slides 45 min');
  await page.keyboard.press('Enter');
  await page.getByRole('radio', { name: 'Calendar' }).click();
  const cal = page.getByRole('region', { name: 'Calendar' });
  await expect(page.getByText('Set your working hours in Today settings')).toHaveCount(0);
  await cal.getByRole('button', { name: 'Plan my day' }).click();
  const plan = page.getByRole('dialog', { name: 'Your plan' });
  await expect(plan.getByText('Prepare slides')).toBeVisible();
  // depending on the day and the hour this runs, it is placed with a reason or explained
  await expect(
    plan.getByText(/due today · 45 min|no working hours on this day|longest free stretch/).first(),
  ).toBeVisible();
  if (await plan.getByRole('list', { name: 'Placed' }).getByText('Prepare slides').count()) {
    await plan.getByRole('button', { name: 'Accept plan' }).click();
    await expect(cal.getByRole('button', { name: /^Prepare slides, .*task$/ })).toBeVisible();
  } else {
    await plan.getByRole('button', { name: 'Not now' }).click();
  }
});
