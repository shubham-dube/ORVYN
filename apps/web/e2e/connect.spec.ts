import { expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { API, OWNER, signInWithEmail } from './helpers';

test('a desktop app connects: sign in if needed, approve, the app redeems the code for its own session', async ({
  page,
}) => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  const redirect = 'http://127.0.0.1:53999/callback';

  // the desktop app's loopback listener
  let landed: URL | null = null;
  await page.route('http://127.0.0.1:53999/**', async (route) => {
    landed = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<p>ORVYN is connected. You can close this tab.</p>',
    });
  });

  const connect = `/connect?redirect_uri=${encodeURIComponent(redirect)}&code_challenge=${challenge}&state=${state}`;
  await page.goto(connect);
  await expect(page).toHaveURL(/\/sign-in\?next=/); // signed out → sign in first, then come back
  await signInWithEmail(page, OWNER, page.url(), connect);

  await expect(page.getByRole('heading', { name: 'Connect ORVYN for Windows?' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect.poll(() => landed?.toString() ?? '').toContain('127.0.0.1:53999/callback');
  expect(landed!.searchParams.get('state')).toBe(state);

  const r = await page.request.post(`${API}/auth/link/redeem`, {
    data: {
      code: landed!.searchParams.get('code'),
      verifier,
      device: { name: 'Test PC', platform: 'windows', appVersion: '0.1.0' },
    },
  });
  expect(r.status()).toBe(200);
  expect((await r.json()).refreshToken).toBeTruthy();
});

test('an app ORVYN does not trust gets nothing', async ({ page }) => {
  await signInWithEmail(page, OWNER);
  const challenge = createHash('sha256').update(randomBytes(32).toString('base64url')).digest('base64url');
  await page.goto(
    `/connect?redirect_uri=${encodeURIComponent('https://evil.example/cb')}&code_challenge=${challenge}&state=${'s'.repeat(20)}`,
  );
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'isn’t one ORVYN trusts' })).toBeVisible();
  await expect(page).toHaveURL(/\/connect/);
});
