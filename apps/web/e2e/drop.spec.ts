import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

// a tiny PNG: the fake model reads a file called receipt.* as a ₹499 receipt
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('Drop: text, a receipt photo and the command bar become suggestions; confirming adds them where they belong', async ({
  page,
}) => {
  await signInWithEmail(page, OWNER);
  await page.getByRole('link', { name: 'Drop' }).first().click();
  await expect(page.getByRole('heading', { name: 'Drop', level: 1 })).toBeVisible();

  // an expense, said in passing
  await page.getByLabel('Drop something').fill('spent 240 on lunch at swiggy');
  await page.keyboard.press('Enter');
  const lunch = page.getByLabel('Dropped: spent 240 on lunch at swiggy');
  await expect(lunch.getByRole('radio', { name: 'Expense' })).toBeChecked({ timeout: 15_000 });
  await expect(lunch.getByLabel('Amount (₹)')).toHaveValue('240');
  await expect(lunch.getByText(/^Why: /)).toBeVisible();
  await lunch.getByRole('button', { name: 'Add to Money' }).click();
  await expect(page.getByText('Added to Money · ₹240')).toBeVisible();

  // a task, corrected before confirming
  await page.getByLabel('Drop something').fill('call the bank tomorrow 5pm');
  await page.keyboard.press('Enter');
  const bank = page.getByLabel('Dropped: call the bank tomorrow 5pm');
  await expect(bank.getByRole('radio', { name: 'Task' })).toBeChecked({ timeout: 15_000 });
  await bank.getByLabel('Title').fill('Call HDFC about the card');
  await bank.getByRole('button', { name: 'Add to Today' }).click();
  await expect(page.getByText('Added to Today')).toBeVisible();

  // a receipt photo
  await page
    .getByLabel('File to drop')
    .setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  const receipt = page.getByLabel('Dropped: receipt.png');
  await expect(receipt.getByLabel('Amount (₹)')).toHaveValue('499', { timeout: 15_000 });
  await expect(receipt.getByLabel('Merchant')).toHaveValue('Cafe Aroma');

  // from anywhere: the command bar drops too
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Ask or do anything/).fill('read the dune sequel');
  await page.getByRole('option', { name: /Drop “read the dune sequel”/ }).click();
  await expect(page.getByLabel('Dropped: read the dune sequel')).toBeVisible();

  // where they landed
  await page.goto('/money');
  await expect(page.getByRole('list', { name: 'Transactions this month' }).getByText('Swiggy')).toBeVisible();
  await page.goto('/today');
  await expect(page.getByText('Call HDFC about the card')).toBeVisible();
});
