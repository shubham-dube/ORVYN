import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

test('Chat is end-to-end encrypted between two browsers, live; a trip is split and settled', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signInWithEmail(page, OWNER);
  // Ravi joins with Chat and Split
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Invite someone' }).first().click();
  await page.getByLabel('Their email (optional)').fill('ravi@example.test');
  await page.getByRole('dialog').getByRole('switch', { name: 'Split' }).click();
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const link = (await page.getByTestId('invite-link').textContent())!.trim();
  const ravi = await (await browser.newContext()).newPage();
  const path = new URL(link).pathname;
  await ravi.goto(path);
  await signInWithEmail(ravi, 'ravi@example.test', path);

  // the owner starts a chat and says something
  await page.goto('/chat');
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByRole('dialog', { name: 'New chat' }).getByLabel('ravi').check();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await page.getByRole('textbox', { name: 'Message' }).fill('Dinner at 8? 🍕');
  await page.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(page.getByTestId('bubble').filter({ hasText: 'Dinner at 8? 🍕' })).toBeVisible();

  // Ravi's browser decrypts it, and his reply arrives live on the owner's screen
  await ravi.goto('/chat');
  await ravi.getByRole('link', { name: /owner/ }).click();
  await expect(ravi.getByTestId('bubble').filter({ hasText: 'Dinner at 8? 🍕' })).toBeVisible();
  await ravi.getByRole('textbox', { name: 'Message' }).fill('Yes! See you there');
  await ravi.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('bubble').filter({ hasText: 'Yes! See you there' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(ravi.getByLabel('Receipt')).toBeVisible();

  // a trip: the owner, Ravi and a guest; a ₹3,000 hotel paid by the owner, split equally
  await page.goto('/split');
  await page.getByRole('button', { name: 'New group' }).click();
  const ng = page.getByRole('dialog', { name: 'New group' });
  await ng.getByLabel('Name', { exact: true }).fill('Goa');
  await ng.getByLabel('ravi').check();
  await ng.getByLabel('Guest name').fill('Mia');
  await ng.getByRole('button', { name: 'Add', exact: true }).click();
  await ng.getByRole('button', { name: 'Make the group' }).click();
  await expect(page.getByRole('heading', { name: 'Goa' })).toBeVisible();
  await page.getByRole('button', { name: 'Add expense' }).click();
  const ex = page.getByRole('dialog', { name: 'Add an expense' });
  await ex.getByLabel('What for').fill('Hotel');
  await ex.getByLabel('Amount (₹)').fill('3000');
  await expect(ex.getByText('₹1,000').first()).toBeVisible(); // the live preview
  await ex.getByRole('button', { name: 'Save' }).click();
  const settle = page.getByRole('region', { name: 'Settle up' });
  await expect(settle.getByText('₹1,000')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Your balance' }).getByText('gets ₹2,000')).toBeVisible();

  // Ravi sees what he owes, and the group's chat got a plain line about it
  await ravi.goto('/split');
  await expect(ravi.getByText('owes ₹1,000')).toBeVisible();
});
