import { expect, test } from '@playwright/test';
import { API, OWNER, signInWithEmail } from './helpers';

test('a reminder fires, arrives live with its actions, and Done completes the task everywhere', async ({
  page,
}) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();

  // a task due in an hour with its own reminder a few seconds from now (written through the sync API, as any device would)
  const token = await page.evaluate(async (api) => {
    const r = await fetch(`${api}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return ((await r.json()) as { accessToken: string }).accessToken;
  }, API);
  const id = crypto.randomUUID();
  const soon = new Date(Date.now() + 3_000).toISOString();
  const r = await page.request.post(`${API}/sync/push`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      mutations: [
        {
          mutationId: crypto.randomUUID(),
          entity: 'today.task',
          entityId: id,
          op: 'upsert',
          fields: {
            title: 'Take the cake out',
            dueAt: new Date(Date.now() + 3_600_000).toISOString(),
            reminders: [{ kind: 'at', at: soon }],
          },
          hlc: `${String(Date.now()).padStart(15, '0')}:00000:e2e`,
        },
      ],
    },
  });
  expect((await r.json()).applied).toHaveLength(1);
  await page.reload(); // written with this browser's own session, so the server doesn't echo it back here
  await expect(page.getByRole('list', { name: 'Today' }).getByText('Take the cake out')).toBeVisible({
    timeout: 10_000,
  });

  // the worker fires it; it arrives live
  const bell = page.getByRole('button', { name: /Notifications, \d+ unread/ }).first();
  await expect(bell).toBeVisible({ timeout: 15_000 });
  await bell.click();
  const panel = page.getByRole('complementary', { name: 'Notifications' });
  const actions = panel.getByRole('group', { name: 'Actions for Take the cake out' });
  await expect(actions.getByRole('button', { name: 'Snooze 10 min' })).toBeVisible();
  await actions.getByRole('button', { name: 'Done' }).click();
  await expect(panel.getByText('Take the cake out')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Close notifications' })
    .click({ force: true })
    .catch(() => undefined);

  // the server completed it; the change synced back here
  await expect(page.getByRole('list', { name: 'Done today' }).getByText('Take the cake out')).toBeVisible({
    timeout: 10_000,
  });
});

test('a button pressed on a web push notification is carried out by the page', async ({ page }) => {
  await signInWithEmail(page, OWNER);
  // the service worker opens /?notification=…&action=… — an unknown id is refused politely, and the URL is cleaned
  await page.goto('/?notification=00000000-0000-4000-8000-000000000000&action=done');
  await expect(page.getByText('That didn’t work')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
