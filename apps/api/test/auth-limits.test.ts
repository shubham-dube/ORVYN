import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startApp();
});
afterAll(() => h.close());

describe('the guess limit counts only wrong codes', () => {
  it('signing in on many devices from one network keeps working', async () => {
    for (let i = 0; i < 12; i++) {
      const r = await signIn(h, OWNER, { platform: i % 2 ? 'android' : 'web' });
      expect(r.status, `sign-in ${i + 1}`).toBe(200);
    }
  });
});
