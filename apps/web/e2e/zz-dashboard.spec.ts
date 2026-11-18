import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

test('Dashboard: the day at a glance, quick add for a task and an expense, and links into each module', async ({
  page,
}) => {
  await signInWithEmail(page, OWNER);
  await expect(page.getByRole('heading', { level: 1, name: /Good/ })).toBeVisible();
  await page.waitForLoadState('networkidle');

  // a task straight from the dashboard shows up in "what's next" and the day's line
  await page.getByLabel('Quick add text').fill('Dashboard check task');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Added to Today')).toBeVisible();
  const next = page.getByRole('list', { name: "What's next" });
  await expect(next.getByText('Dashboard check task')).toBeVisible();
  await expect(page.getByTestId('dash-line')).toContainText('to do');
  await expect(page.getByRole('img', { name: /percent done/ })).toBeVisible();

  // an expense typed in words, for yesterday
  await page.getByRole('radio', { name: 'Expense' }).click();
  await page.getByLabel('Quick add text').fill('spent 120 on chai');
  await expect(page.getByText('₹120')).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Spent ₹120')).toBeVisible();
  await expect(page.getByLabel('Spent this month')).toContainText('₹');
  await expect(page.getByRole('img', { name: 'Spending each day this month' })).toBeVisible();

  // the week and drop cards are there, and the module tiles lead somewhere
  await expect(page.getByRole('img', { name: /^Tasks due:/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Drop' }).or(page.getByLabel('Drop').first())).toBeVisible();
  await page.getByRole('link', { name: /^Today Tasks and calendar/ }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.getByRole('checkbox', { name: 'Complete Dashboard check task' }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: /Good/ })).toBeVisible();
  await expect(next.getByText('Dashboard check task')).toHaveCount(0);
});
