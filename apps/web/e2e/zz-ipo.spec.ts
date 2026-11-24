import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

test('IPO desk and Pool: an IPO typed in, a partner funded by card, and they confirm on their own page', async ({
  page,
  browser,
}) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/ipo');
  await expect(page.getByText('No market feed is connected yet')).toBeVisible();

  // an IPO by hand
  await page.getByRole('button', { name: 'Add by hand' }).click();
  const add = page.getByRole('dialog', { name: 'Add an IPO' });
  await add.getByLabel('Company').fill('Mega Power');
  await add.getByLabel('Opens').fill(iso(-1));
  await add.getByLabel('Closes').fill(iso(1));
  await add.getByLabel('Price to (₹)').fill('148');
  await add.getByLabel('Lot (shares)').fill('101');
  await add.getByLabel('Issue size (₹ cr)').fill('1000');
  await add.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('link', { name: 'Mega Power' }).click();
  await expect(page.getByRole('heading', { name: 'Mega Power' })).toBeVisible();

  // figures typed in: GMP and retail subscription → odds
  await page.getByRole('button', { name: 'Type figures' }).click();
  const fig = page.getByRole('dialog', { name: 'Type figures' });
  await fig.getByLabel('GMP (₹)').fill('40');
  await fig.getByLabel('Retail (×)').fill('10');
  await fig.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('region', { name: 'Your odds' }).getByText('10%')).toBeVisible();

  // the Pool: a card source and a partner
  await page.goto('/ipo?tab=pool');
  await page.getByRole('region', { name: 'Sources' }).getByRole('button', { name: 'Add' }).click();
  const src = page.getByRole('dialog', { name: 'Add a source' });
  await src.getByLabel('Name').fill('HDFC card cash');
  await src.getByRole('radio', { name: 'Credit card' }).click();
  await src.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('region', { name: 'Partners' }).getByRole('button', { name: 'Add' }).click();
  const pa = page.getByRole('dialog', { name: 'Add a partner' });
  await pa.getByLabel('Name').fill('Ravi');
  await pa.getByRole('radio', { name: '% of the gain' }).click();
  await pa.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('region', { name: 'Partners' }).getByText('25% of the gain')).toBeVisible();

  // plan with my partners (spec 0018) → Ravi already said yes; the plan says he needs the whole amount
  await page.goto('/ipo');
  await page.getByRole('link', { name: 'Mega Power' }).click();
  await page.getByRole('button', { name: 'Plan with my partners' }).click();
  const plan = page.getByRole('dialog', { name: 'Plan Mega Power with your partners' });
  await plan.getByRole('radio', { name: 'Already said yes' }).click();
  await plan.getByRole('button', { name: 'Open the round' }).click();
  const ravi = page.getByRole('group', { name: 'Ravi' });
  await expect(ravi.getByText('needs')).toBeVisible();
  await ravi.getByRole('button', { name: 'Record transfer' }).click();
  const money = page.getByRole('dialog', { name: 'Record money' });
  await money.getByLabel('From').selectOption({ label: 'HDFC card cash' });
  await expect(money.getByText('a ₹373.7 cost is recorded too')).toBeVisible();
  await money.getByRole('button', { name: 'Record' }).click();
  await expect(ravi.getByText('Money sent')).toBeVisible();

  // Ravi's private page: no account, one tap
  await page.goto('/ipo?tab=pool');
  await page.getByRole('region', { name: 'Partners' }).getByRole('button', { name: /Ravi/ }).click();
  await page.getByRole('button', { name: 'Make a link' }).click();
  const link = await page.locator('code').first().innerText();
  const other = await browser.newContext();
  const theirs = await other.newPage();
  await theirs.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(theirs.getByRole('heading', { name: 'Hi Ravi 👋' })).toBeVisible();
  await theirs.getByRole('button', { name: 'I applied' }).click();
  await expect(theirs.getByRole('button', { name: 'I accepted the UPI mandate' })).toBeVisible();
  await other.close();

  await page.goto('/ipo?tab=pool');
  await page.getByRole('link', { name: /Mega Power/ }).click();
  await expect(page.getByRole('group', { name: 'Ravi' }).getByText('said so themselves')).toBeVisible();
});
