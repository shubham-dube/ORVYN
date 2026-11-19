import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

test('a first visit to / is the landing page; after signing in, / is the app', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/); // served in place, not redirected
  await expect(page.getByRole('heading', { level: 1, name: /Your whole life/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Download' }).click();
  await expect(page.getByRole('heading', { name: 'Android' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Download APK/ })).toHaveAttribute(
    'href',
    /orvyn-android\.apk$/,
  );
  await expect(page.getByRole('link', { name: /Download for Windows/ })).toHaveAttribute('href', /\.exe$/);
  for (const p of ['/features', '/security', '/faq', '/privacy', '/terms'])
    expect((await page.goto(p))!.status(), p).toBe(200);

  await signInWithEmail(page, OWNER);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening|night)/ }),
  ).toBeVisible();
});
