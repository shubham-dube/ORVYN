import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

test.describe.configure({ mode: 'serial' });

test('signed-out visitors are sent to sign in', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toBeVisible();
});

test('the owner signs in with an email code and the session survives a reload', async ({ page }) => {
  await signInWithEmail(page, OWNER);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /Good/ })).toBeVisible();
  // the owner sees every module and the People area
  await expect(page.getByText('IPO desk')).toBeVisible();
  await expect(page.getByRole('link', { name: 'People' })).toBeVisible();
});

test('a notification arrives live and dismissing it clears it', async ({ page }) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Test every device' }).click();
  const bell = page.getByRole('button', { name: /Notifications, \d+ unread/ }).first();
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = page.getByRole('complementary', { name: 'Notifications' });
  const dismiss = panel.getByRole('button', { name: /^Dismiss / }).first();
  await expect(dismiss).toBeVisible();
  const before = await panel.getByRole('button', { name: /^Dismiss / }).count();
  await dismiss.click();
  await expect(panel.getByRole('button', { name: /^Dismiss / })).toHaveCount(before - 1);
});

test('the command bar opens with Ctrl-K and navigates', async ({ page }) => {
  await signInWithEmail(page, OWNER);
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Command' }).fill('settings');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
});

test('an invited friend joins and sees only the modules they were given', async ({ page, browser }) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Invite someone' }).first().click();
  await page.getByLabel('Their email (optional)').fill('friend@example.test');
  // default grant is Today + Chat; turn Chat off so the friend gets Today only
  await page.getByRole('switch', { name: 'Chat' }).click();
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const link = (await page.getByTestId('invite-link').textContent())!.trim();
  expect(link).toMatch(/\/join\//);

  const friend = await (await browser.newContext()).newPage();
  const path = new URL(link).pathname;
  await friend.goto(path);
  await expect(friend.getByText(/invited you/)).toBeVisible();
  await signInWithEmail(friend, 'friend@example.test', path);
  await expect(friend.getByText('Tasks and calendar on one river of time')).toBeVisible();
  await expect(friend.getByText('IPO desk')).toHaveCount(0);
  await expect(friend.getByRole('link', { name: 'People' })).toHaveCount(0);
  // the server, not the UI, is the boundary: admin APIs refuse a member
  const token = await friend.evaluate(async () => {
    const r = await fetch('http://localhost:4100/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return ((await r.json()) as { accessToken: string }).accessToken;
  });
  const r = await friend.request.get('http://localhost:4100/admin/users', {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(r.status()).toBe(403);

  // the owner sees the friend joined and can switch a module on live
  await page.reload();
  await expect(page.getByText('friend@example.test', { exact: true })).toBeVisible();
  const card = page.getByTestId('person-friend@example.test');
  await card.getByRole('switch', { name: 'Chat' }).click();
  // pushed over the socket: the friend's home gains Chat without a reload
  await expect(friend.getByText('End-to-end encrypted conversations with friends')).toBeVisible();
});
