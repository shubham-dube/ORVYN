import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

test('connections: every provider in Settings, and a meeting asks for a Google account first', async ({
  page,
}) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/settings#connections');
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'Connections' }) });
  await expect(section.getByText('ClickUp', { exact: true })).toBeVisible();
  await expect(section.getByText('Microsoft 365 / Outlook')).toBeVisible();
  await expect(section.getByText('Nothing connected yet.')).toBeVisible();
  await section.getByRole('button', { name: /ClickUp/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Connect ClickUp' });
  await expect(sheet.getByLabel('Personal API token')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Connect' })).toBeDisabled();
  await page.keyboard.press('Escape');

  await section.getByRole('button', { name: /GitHub/ }).click();
  const gh = page.getByRole('dialog', { name: 'Connect GitHub' });
  await expect(gh.getByPlaceholder('github_pat_…')).toBeVisible();
  await page.keyboard.press('Escape');

  await section.getByRole('button', { name: /Zoho/ }).click();
  const mail = page.getByRole('dialog', { name: 'Connect a mailbox' });
  await expect(mail.getByLabel('Provider')).toHaveValue('zoho');
  await expect(mail.getByText(/IMAP Access/)).toBeVisible();
  await mail.getByLabel('Email address').fill('asha@zoho.test');
  await mail.getByLabel('App password').fill('wrong-pass');
  await expect(mail.getByRole('button', { name: 'Connect' })).toBeEnabled();
  await mail.getByLabel('Provider').selectOption('custom');
  await expect(mail.getByLabel('IMAP host')).toBeVisible();
  await expect(mail.getByRole('button', { name: 'Connect' })).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.goto('/today');
  await page.getByRole('button', { name: 'Schedule a meeting' }).click();
  await expect(page.getByText('Connect a Google account first')).toBeVisible();
});
