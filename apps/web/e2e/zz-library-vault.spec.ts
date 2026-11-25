import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

test('Library: add a document, it is read and filed, found in plain words, and its expiry is shown', async ({
  page,
}) => {
  await signInWithEmail(page, OWNER);
  await page.getByRole('link', { name: 'Library' }).first().click();
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');

  // a text document with an expiry and an amount: read by the (fake) model on the server
  await page.getByLabel('Add documents').setInputFiles({
    name: 'health-policy.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Star Health insurance policy\nPolicy valid till 2027-02-14\nPremium due ₹18,500'),
  });
  const docs = page.getByRole('list', { name: 'Documents' });
  await expect(docs.getByText('Star Health insurance policy', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(docs.getByText('Insurance', { exact: false }).first()).toBeVisible();

  // a note, and plain-words search finds each
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  await page.getByLabel('Title (optional)').fill('Passport renewal');
  await page.getByLabel('Note', { exact: true }).fill('Carry the old passport and a PAN card copy');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(docs.getByText('Passport renewal')).toBeVisible();
  await page.getByLabel('Search the Library').fill('pan card');
  await expect(docs.getByText('Passport renewal')).toBeVisible();
  await expect(docs.getByText('Star Health insurance policy', { exact: true })).toHaveCount(0);
  await page.getByLabel('Search the Library').fill('health insurance');
  await expect(docs.getByText('Star Health insurance policy', { exact: true })).toBeVisible();
  await page.getByLabel('Search the Library').fill('');

  // open it: the date and the amount the model found, with a tap to add the amount to Money
  await docs.getByText('Star Health insurance policy', { exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Document' });
  await expect(sheet.getByLabel('Expires on')).toHaveValue('2027-02-14');
  await expect(sheet.getByText('₹18,500', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Add to Money' }).click();
  await expect(page.getByText('Added to Money')).toBeVisible();
  await expect(sheet.getByText('In Money')).toBeVisible();
  await sheet.getByRole('button', { name: 'Save' }).click();
});

test('Vault: set up with a recovery key, lock, unlock, add and copy, recover, and the server holds no plaintext', async ({
  page,
}) => {
  test.setTimeout(120_000); // each unlock runs a real Argon2id
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const pushes: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/sync/push')) pushes.push(r.postData() ?? '');
  });
  await signInWithEmail(page, OWNER);
  await page.getByRole('link', { name: 'Vault' }).first().click();
  await expect(page.getByRole('heading', { name: 'Vault', level: 1 })).toBeVisible();

  // set up: passphrase, then the recovery key must be saved before going on
  await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Again').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Create my Vault' }).click();
  const recovery = (await page.getByTestId('recovery-key').textContent())!.trim();
  expect(recovery).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
  await expect(page.getByRole('button', { name: 'Open my Vault' })).toBeDisabled();
  await page.getByLabel('I have saved my recovery key').check();
  await page.getByRole('button', { name: 'Open my Vault' }).click();

  // add a login with a generated password
  await page.getByRole('button', { name: 'New item' }).click();
  const sheet = page.getByRole('dialog', { name: 'New Vault item' });
  await sheet.getByLabel('Title').fill('Bank of Example');
  await sheet.getByLabel('Username or email').fill('me@example.test');
  await sheet.getByRole('button', { name: 'Generate a password' }).click();
  const generated = await sheet.getByRole('textbox', { name: 'Password' }).inputValue();
  expect(generated).toHaveLength(20);
  await sheet.getByRole('button', { name: 'Save' }).click();
  const list = page.getByRole('list', { name: 'Vault items' });
  await expect(list.getByText('Bank of Example')).toBeVisible();

  // open it: hidden until shown; copy puts it on the clipboard
  await list.getByText('Bank of Example').click();
  const item = page.getByRole('dialog', { name: 'Bank of Example' });
  await expect(item.getByTestId('secret-Password')).toHaveText('••••••••••');
  await item.getByRole('button', { name: 'Show Password' }).click();
  await expect(item.getByTestId('secret-Password')).toHaveText(generated);
  await item.getByRole('button', { name: 'Copy Password' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(generated);
  await page.keyboard.press('Escape');

  // the server only holds ciphertext: nothing this device sent contains the title, the username or the password
  await page.waitForLoadState('networkidle');
  const sent = pushes.join('\n');
  expect(sent).toContain('vault.item');
  for (const secret of [
    'Bank of Example',
    'me@example.test',
    generated,
    'correct horse battery staple',
    recovery,
  ])
    expect(sent).not.toContain(secret);

  // lock → wrong passphrase refused → right one opens
  await page.getByRole('button', { name: 'Lock now' }).click();
  await expect(page.getByRole('heading', { name: 'Vault is locked' })).toBeVisible();
  await expect(page.getByText('Bank of Example')).toHaveCount(0);
  await page.getByLabel('Passphrase').fill('wrong passphrase here');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('That passphrase isn’t right.')).toBeVisible();
  await page.getByLabel('Passphrase').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(list.getByText('Bank of Example')).toBeVisible();

  // forgot the passphrase: the recovery key gets back in and sets a new one
  await page.getByRole('button', { name: 'Lock now' }).click();
  await page.getByRole('button', { name: 'Forgot it? Use my recovery key' }).click();
  const rec = page.getByRole('dialog', { name: 'Recover with your key' });
  await rec.getByLabel('Recovery key').fill(recovery.toLowerCase());
  await rec.getByLabel('New passphrase').fill('a brand new passphrase');
  await rec.getByRole('button', { name: 'Open and set the passphrase' }).click();
  await expect(list.getByText('Bank of Example')).toBeVisible();
  await page.getByRole('button', { name: 'Lock now' }).click();
  await page.getByLabel('Passphrase').fill('a brand new passphrase');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(list.getByText('Bank of Example')).toBeVisible();
});
