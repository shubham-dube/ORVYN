import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

test('Brief: today in one look; turned on from its settings, it shows on Home', async ({ page }) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/brief');
  await expect(page.getByRole('button', { name: 'Turn it on' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Your Brief');

  await page.getByRole('button', { name: 'Turn it on' }).click();
  const sheet = page.getByRole('dialog', { name: 'Brief settings' });
  await sheet.getByLabel('Brief time').fill('06:45');
  await sheet.getByRole('switch', { name: 'Morning Brief' }).click();
  await sheet.getByRole('switch', { name: 'Payments waiting' }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Your Brief comes at 06:45')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn it on' })).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Brief settings' }).getByRole('switch', { name: 'Payments waiting' }),
  ).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Brief' })).toBeVisible();
});
