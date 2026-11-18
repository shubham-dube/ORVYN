import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type MessageIn, parseMessage } from '../src/parse';

const { cases } = JSON.parse(readFileSync(join(__dirname, '../fixtures/messages.json'), 'utf8')) as {
  cases: (MessageIn & { id: string; expect: unknown })[];
};

describe('bank and UPI messages (AC1: every fixture)', () => {
  for (const c of cases) {
    it(c.id, () => {
      expect(parseMessage(c)).toEqual(c.expect);
    });
  }
});
