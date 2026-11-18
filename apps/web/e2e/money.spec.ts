import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
};

test('Money: typed entries, budgets, a statement import that skips what is already there, edit and delete', async ({
  page,
}) => {
  await signInWithEmail(page, OWNER);
  await page.getByRole('link', { name: 'Money' }).first().click();
  await expect(page.getByRole('heading', { name: 'Money', level: 1 })).toBeVisible();

  // other tests may have spent already: compare with what's there now
  const spent = async () =>
    Number(((await page.getByLabel('Spent this month').textContent()) ?? '0').replace(/[^\d]/g, ''));
  await expect(page.getByLabel('Spent this month')).toBeVisible();
  await page.waitForLoadState('networkidle'); // this device has caught up with what others recorded
  const before = await spent();

  // typed: the chip shows what was understood
  await page.getByLabel('New transaction').fill('spent 240 on lunch at swiggy');
  await expect(page.getByText('₹240 · Swiggy · Food & dining')).toBeVisible();
  await page.keyboard.press('Enter');
  const list = page.getByRole('list', { name: 'Transactions this month' });
  await expect(list.getByText('Swiggy', { exact: true }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  const swiggies = await list.getByText('Swiggy', { exact: true }).count();
  await expect.poll(spent).toBe(before + 240);

  await page.getByLabel('New transaction').fill('got 500 from rahul');
  await page.keyboard.press('Enter');
  await expect(list.getByText('Rahul')).toBeVisible();

  // a budget for food
  const budgets = page.getByRole('region', { name: 'Set budgets' }).or(page.getByLabel('Set budgets'));
  await budgets.getByLabel('Budget for').selectOption({ label: 'Food & dining' });
  await budgets.getByLabel('Budget amount').fill('200');
  await budgets.getByRole('button', { name: 'Set' }).click();
  await expect(page.getByLabel('Budgets').getByText(/ \/ ₹200$/)).toBeVisible();

  // a statement with the same lunch (same day, same amount) and one new row
  const csv = `Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
${today()},UPI-SWIGGY-swiggy@icici-ICIC0001234-432112345678-UPI,0000432112345678,${today()},240.00,,12345.00
${today()},UPI-UBER INDIA-uber@axis-UTIB0000001-432112345690-UPI,0000432112345690,${today()},180.00,,12165.00
`;
  await page
    .getByLabel('Statement file')
    .setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const sheet = page.getByRole('dialog', { name: 'Import statement' });
  await expect(sheet.getByText('2 transactions found')).toBeVisible();
  await sheet.getByLabel('Account name').fill('HDFC Savings');
  await sheet.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('Imported 1')).toBeVisible();
  await expect(page.getByText('1 were already here')).toBeVisible();
  await expect(list.getByText('Uber')).toBeVisible();
  await expect(list.getByText('Swiggy', { exact: true })).toHaveCount(swiggies); // the statement's lunch was the one already here
  expect(await spent()).toBe(before + 240 + 180);
  // imported rows wait in "New" for a look
  await page.getByRole('button', { name: 'Looks right: Uber' }).click();
  await expect(page.getByRole('list', { name: 'New transactions' })).toHaveCount(0);

  // edit: Swiggy was a team dinner on the card → note it, then delete Rahul's
  await list.getByText('Swiggy', { exact: true }).first().click();
  const tx = page.getByRole('dialog', { name: 'Transaction' });
  await tx.getByLabel('Note').fill('team dinner');
  await tx.getByRole('button', { name: 'Save' }).click();
  await list.getByText('Rahul').click();
  await tx.getByRole('button', { name: 'Delete' }).click();
  await expect(list.getByText('Rahul')).toHaveCount(0);
  await expect.poll(spent).toBe(before + 420);
});
