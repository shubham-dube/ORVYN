import { expect, test } from '@playwright/test';
import { OWNER, signInWithEmail } from './helpers';

test('voice: words are written once, even when the browser repeats them, and the recording can be kept', async ({
  page,
}) => {
  // a fake recogniser that behaves like Chrome on Android: interim words, then cumulative finals, then a stop after a pause
  await page.addInitScript(() => {
    class FakeRec {
      lang = '';
      interimResults = false;
      continuous = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      start() {
        const w = window as unknown as { __recs: FakeRec[] };
        (w.__recs ??= []).push(this);
        const results: { isFinal: boolean; 0: { transcript: string }; length: number }[] = [];
        const say = (i: number, t: string, isFinal: boolean, from = i) => {
          results[i] = { isFinal, 0: { transcript: t }, length: 1 };
          this.onresult?.({
            resultIndex: from,
            results: Object.assign([...results], { length: results.length }),
          });
        };
        if (w.__recs.length === 1) {
          setTimeout(() => say(0, 'pay', false), 50);
          setTimeout(() => say(0, 'pay rent', true), 100);
          setTimeout(() => say(1, 'pay rent tomorrow', true), 150); // Android repeats the sentence so far
          setTimeout(() => say(1, 'pay rent tomorrow', true), 200); // and sometimes the same final twice
          setTimeout(() => this.onend?.(), 260); // stops after a pause: listening resumes
        } else {
          setTimeout(() => say(0, 'at 5 pm', true), 50);
        }
      }
      stop() {
        setTimeout(() => this.onend?.(), 10);
      }
      abort() {}
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRec;
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRec;
    // a microphone that records a tiny clip
    class FakeRecorder {
      mimeType = 'audio/webm';
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      static isTypeSupported = (t: string) => t.startsWith('audio/webm');
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob([new Uint8Array(4000).fill(7)], { type: 'audio/webm' }) });
        setTimeout(() => this.onstop?.(), 10);
      }
    }
    (window as unknown as Record<string, unknown>).MediaRecorder = FakeRecorder;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    (window as unknown as Record<string, unknown>).AudioContext = undefined;
  });
  await signInWithEmail(page, OWNER);
  await page.getByRole('link', { name: 'Drop' }).first().click();
  await page.getByRole('button', { name: 'Speak' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Stop listening' }).click();
  const box = page.getByRole('textbox').first();
  await expect(box).toHaveValue('pay rent tomorrow at 5 pm');
  // the recording is offered, kept by default, and dropped with the words
  await expect(page.getByLabel('Your recording')).toBeVisible();
  await expect(page.getByLabel('Keep the recording')).toBeChecked();
  await page.getByRole('button', { name: 'Drop', exact: true }).click();
  const card = page.getByLabel(/^Dropped: pay rent tomorrow at 5 pm/);
  await expect(card).toBeVisible();
  await expect(card.getByText('voice')).toBeVisible();
  await card.getByRole('button', { name: /^Open voice-/ }).click();
  await expect(page.getByTestId('file-viewer').locator('audio')).toBeVisible();
});

test('files: a spreadsheet and a voice note open inside the app; an unsupported type says why', async ({
  page,
}) => {
  await signInWithEmail(page, OWNER);
  await page.getByRole('link', { name: 'Library' }).first().click();
  await page.getByLabel('Add documents').setInputFiles({
    name: 'expenses.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Date,Item,Amount\n2026-11-01,Rent,22000\n2026-11-03,Groceries,1850\n'),
  });
  const docs = page.getByRole('list', { name: 'Documents' });
  await expect(docs.getByText(/Date,Item,Amount|Expenses/i).first()).toBeVisible({ timeout: 20_000 });
  await docs
    .getByRole('button', { name: /expenses|Date,Item/i })
    .first()
    .click();
  await page.getByRole('button', { name: 'Open original' }).click();
  const viewer = page.getByTestId('file-viewer');
  await expect(viewer.getByRole('columnheader', { name: 'Amount' })).toBeVisible();
  await expect(viewer.getByRole('cell', { name: 'Groceries' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');

  await page.getByLabel('Add documents').setInputFiles({
    name: 'page.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<script>alert(1)</script>'),
  });
  await expect(page.getByText('That kind of file can’t be kept.', { exact: false })).toBeVisible();
});
