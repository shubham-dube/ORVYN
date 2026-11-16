import { type Page, expect } from '@playwright/test';

export const API = 'http://localhost:4100';
export const OWNER = 'owner@example.test';

/** Signs in through the real email-code flow, reading the code from the API's dev mailbox. */
export async function signInWithEmail(page: Page, email: string, path = '/sign-in') {
  await page.goto(path);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByText('Check your inbox')).toBeVisible();
  let code = '';
  await expect
    .poll(async () => {
      const r = await page.request.get(`${API}/dev/mailbox?email=${encodeURIComponent(email)}`);
      if (!r.ok()) return '';
      code = /\d{6}/.exec(((await r.json()) as { subject: string }).subject)?.[0] ?? '';
      return code;
    })
    .toMatch(/^\d{6}$/);
  await page.getByLabel('Digit 1').click();
  await page.keyboard.type(code);
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening|night)/ }),
  ).toBeVisible();
}
