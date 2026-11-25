import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

test('calendar: a repeating event, changing and cancelling one occurrence, dragging a task onto the river', async ({
  page,
}) => {
  await signInWithEmail(page, OWNER);
  await page.goto('/today');
  await page.getByRole('radio', { name: 'Calendar' }).click();
  const cal = page.getByRole('region', { name: 'Calendar' });
  await expect(cal.getByRole('radio', { name: 'Day' })).toBeChecked();

  // a daily standup at 7:00
  await cal.getByRole('button', { name: 'Event' }).click();
  const sheet = page.getByRole('dialog', { name: 'New event' });
  await sheet.getByLabel('Title').fill('Team standup');
  await sheet.getByLabel('Starts').fill('07:00');
  await sheet.getByLabel('Ends').fill('07:30');
  await sheet.getByLabel('Repeat').selectOption({ label: 'Every day' });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(cal.getByRole('button', { name: /^Team standup, 7:00/ })).toBeVisible();

  // tomorrow: move just that one to 8:00
  await cal.getByRole('button', { name: 'Next' }).click();
  await cal.getByRole('button', { name: /^Team standup, 7:00/ }).click();
  const edit = page.getByRole('dialog', { name: 'Event' });
  await expect(edit.getByRole('radio', { name: 'Only this one' })).toBeChecked();
  await edit.getByLabel('Starts').fill('08:00');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(cal.getByRole('button', { name: /^Team standup, 8:00/ })).toBeVisible();
  await expect(cal.getByRole('button', { name: /^Team standup, 7:00/ })).toHaveCount(0);

  // the day after: cancel only that occurrence
  await cal.getByRole('button', { name: 'Next' }).click();
  await cal.getByRole('button', { name: /^Team standup, 7:00/ }).click();
  await page.getByRole('dialog', { name: 'Event' }).getByRole('button', { name: 'Delete' }).click();
  await expect(cal.getByRole('button', { name: /^Team standup/ })).toHaveCount(0);

  // the series carries on, today still at 7:00
  await cal.getByRole('button', { name: 'Next' }).click();
  await expect(cal.getByRole('button', { name: /^Team standup, 7:00/ })).toBeVisible();
  await cal.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(cal.getByRole('button', { name: /^Team standup, 7:00/ })).toBeVisible();

  // week and month show it too
  await cal.getByRole('radio', { name: 'Week' }).click();
  await expect(page.getByRole('list', { name: 'Week' }).getByText('Team standup').first()).toBeVisible();
  await cal.getByRole('radio', { name: 'Month' }).click();
  await expect(page.getByRole('grid', { name: 'Month' }).getByText('Team standup').first()).toBeVisible();
  await cal.getByRole('radio', { name: 'Day' }).click();

  // a task without a time waits in "To place"; dragging it onto the river gives it one
  await page.getByLabel('New task', { exact: true }).fill('Draft the newsletter');
  await page.keyboard.press('Enter');
  const toPlace = page.getByLabel('To place');
  await expect(toPlace.getByText('Draft the newsletter')).toBeVisible();
  const river = page.getByTestId('river');
  await river.scrollIntoViewIfNeeded();
  const scroller = river.locator('xpath=../..');
  await scroller.evaluate((el) => el.scrollTo({ top: 56 * 8 }));
  await toPlace
    .getByText('Draft the newsletter')
    .dragTo(river, { targetPosition: { x: 120, y: 56 * 9 + 10 } });
  await expect(cal.getByRole('button', { name: /^Draft the newsletter, 9:00.*task$/ })).toBeVisible();
  await expect(toPlace.getByText('Draft the newsletter')).toHaveCount(0);

  // planning needs the person's own working hours: nothing is assumed (D16)
  await cal.getByRole('button', { name: 'Plan my day' }).click();
  await expect(page.getByText('Set your working hours first')).toBeVisible();
});
