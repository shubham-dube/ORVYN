import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

const day = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('Tasks: steps, tags, repeat, projects, search, saved filters, board, and bulk actions', async ({
  page,
}) => {
  await signInWithEmail(page, OWNER);
  await page.getByRole('link', { name: 'Today' }).first().click();
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');

  // a task with everything on it: the sheet stays short, each thing opens from its pill or "+" row (spec 0012 A3)
  await page.getByLabel('New task', { exact: true }).fill('Plan offsite');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Plan offsite' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Task' });
  await sheet.getByRole('button', { name: 'When' }).click();
  await sheet.getByLabel('Day', { exact: true }).fill(day());
  await sheet.getByRole('button', { name: 'Tags' }).click();
  await sheet.getByLabel('Add tag').fill('work');
  await sheet.getByLabel('Add tag').press('Enter');
  await sheet.getByLabel('Add tag').fill('urgent');
  await sheet.getByLabel('Add tag').press('Enter');
  await sheet.getByRole('button', { name: 'Checklist' }).click();
  await sheet.getByLabel('Add a step').fill('book venue');
  await sheet.getByLabel('Add a step').press('Enter');
  await sheet.getByLabel('Add a step').fill('send invite');
  await sheet.getByLabel('Add a step').press('Enter');
  await sheet.getByLabel('Done: book venue').check();
  await expect(sheet.getByText('1/2')).toBeVisible();
  await sheet.getByRole('button', { name: 'Duration' }).click();
  await page.getByRole('option', { name: '1h', exact: true }).click();
  await sheet.getByRole('button', { name: 'Priority' }).click();
  await page.getByRole('option', { name: /^High/ }).click();
  page.once('dialog', (d) => void d.accept('Offsite'));
  await sheet.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('option', { name: 'New project…' }).click();
  await expect(sheet.getByRole('button', { name: 'Offsite' })).toBeVisible();
  // a repeat: every week, with the words and the next dates
  await sheet.getByRole('button', { name: 'Repeat' }).click();
  await sheet.getByRole('radio', { name: 'Weekly' }).click();
  await expect(sheet.getByText(/^Every week on /)).toBeVisible();
  await expect(sheet.getByText(/^Next: /)).toBeVisible();
  await sheet.getByLabel('Every', { exact: true }).fill('2');
  await expect(sheet.getByText(/^Every 2 weeks on /)).toBeVisible();
  await sheet.getByRole('button', { name: 'Save' }).click();

  const row = page
    .getByRole('list', { name: 'Today' })
    .getByRole('listitem')
    .filter({ hasText: 'Plan offsite' });
  await expect(row).toBeVisible();
  await expect(row.getByText('#work')).toBeVisible();
  await expect(row.getByText('1/2')).toBeVisible();
  await expect(row.getByText('Offsite')).toBeVisible();
  await expect(row.getByText('1h')).toBeVisible();
  await expect(row.getByLabel('Repeats')).toBeVisible();
  await expect(row.getByLabel('High priority')).toBeVisible();

  // search and filters
  await page.getByLabel('Search tasks').fill('invite');
  await expect(row).toBeVisible(); // found through its steps
  await page.getByLabel('Search tasks').fill('no such thing');
  await expect(row).toHaveCount(0);
  await page.getByLabel('Search tasks').fill('');
  await page.getByLabel('Tag filter').selectOption('urgent');
  await page.getByLabel('Priority filter').selectOption('3');
  await expect(row).toBeVisible();

  // save it, and it is there after a reload
  await page.getByRole('button', { name: 'Save this filter' }).click();
  await page.getByLabel('Filter name').fill('Urgent work');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = page.getByRole('group', { name: 'Saved filters' });
  await expect(saved.getByRole('button', { name: 'Urgent work', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.reload();
  await expect(
    page
      .getByRole('group', { name: 'Saved filters' })
      .getByRole('button', { name: 'Urgent work', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('group', { name: 'Saved filters' })
    .getByRole('button', { name: 'Urgent work', exact: true })
    .click();
  await expect(page.getByLabel('Tag filter')).toHaveValue('urgent');
  await page
    .getByRole('group', { name: 'Saved filters' })
    .getByRole('button', { name: 'Urgent work', exact: true })
    .click(); // off again
  await expect(page.getByLabel('Tag filter')).toHaveValue('');

  // the board: a column per status; the project pill narrows it
  await page.getByRole('radio', { name: 'Board' }).click();
  await expect(
    page.getByRole('region', { name: /^To do, \d+ tasks?$/ }).getByText('Plan offsite'),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: /^Doing, 0 tasks$/ })).toBeVisible();

  // select: two tasks into the project at once, from the floating bar
  await page.getByRole('radio', { name: 'List' }).click();
  for (const t of ['Buy milk today', 'Buy bread today']) {
    await page.getByLabel('New task', { exact: true }).fill(t);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: t.replace(' today', '') }).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByRole('button', { name: 'Buy milk' }).first().click();
  await page.getByRole('button', { name: 'Buy bread' }).first().click();
  await expect(page.getByText('2 selected')).toBeVisible();
  const bar = page.getByRole('toolbar', { name: 'Selected tasks' });
  await bar.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('option', { name: 'Offsite' }).click();
  await page.getByRole('radio', { name: 'Board' }).click();
  await page.getByRole('button', { name: 'All projects' }).click();
  await page.getByRole('option', { name: 'Offsite' }).click();
  await expect(page.getByRole('region', { name: /^To do, 3 tasks$/ })).toBeVisible();

  // clean up: delete all three in one go
  await page.getByRole('radio', { name: 'List' }).click();
  await page.getByRole('button', { name: 'Select' }).click();
  for (const t of ['Plan offsite', 'Buy milk', 'Buy bread'])
    await page.getByRole('button', { name: t }).first().click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('toolbar', { name: 'Selected tasks' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'Buy milk' })).toHaveCount(0);
  // remove the saved filter
  await page.getByRole('button', { name: 'Delete filter Urgent work' }).click();
  await expect(page.getByRole('button', { name: 'Urgent work', exact: true })).toHaveCount(0);
});
