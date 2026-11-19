import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

test('the Assistant answers from my data, and adds a task only when I confirm it', async ({ page }) => {
  await signInWithEmail(page, OWNER);
  await page.getByRole('link', { name: 'Assistant' }).first().click();
  await expect(page.getByRole('heading', { name: /How can I help/ })).toBeVisible();

  // a suggestion asks; the answer comes from Today with its source
  await page.getByRole('button', { name: 'What’s on tomorrow?' }).click();
  const chat = page.getByRole('region', { name: 'Assistant' });
  await expect(chat.getByText(/You have:|Nothing is planned\./)).toBeVisible();
  await expect(chat.getByText('Today: agenda')).toBeVisible();

  // asking to do something makes a card; nothing happens until Confirm
  await page.getByLabel('Ask the Assistant').fill('Remind me to water the plants tomorrow at 7pm by alarm');
  await page.keyboard.press('Enter');
  const card = page.getByTestId('proposal');
  await expect(card).toContainText('New task “Water the plants”');
  await expect(card).toContainText('reminds by alarm');
  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card.getByText('done')).toBeVisible();

  // it's a real task, on every device
  await page.getByRole('link', { name: 'Today', exact: true }).first().click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText('Water the plants', { exact: true })).toBeVisible();

  // from the command bar: a question goes to the Assistant, in the same place
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Command' }).fill('how much did I spend this month?');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/assistant/);
  await expect(page.getByRole('region', { name: 'Assistant' }).getByText(/^You spent ₹/)).toBeVisible();
});
