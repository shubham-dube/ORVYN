/** Every text colour must stay readable (WCAG AA 4.5:1) on glass, over the base and over every aurora colour. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, over, parseColor } from '../src/color.js';

const T = JSON.parse(readFileSync(join(__dirname, '..', 'tokens.json'), 'utf8'));

describe('contrast on glass', () => {
  for (const [phase, p] of Object.entries<{
    mode: 'light' | 'dark';
    base: string;
    aurora: string[];
    veil: string;
  }>(T.phases)) {
    const m = T.modes[p.mode];
    for (const backdrop of [p.base, ...p.aurora]) {
      // the backdrop seen through the veil, then the (lightest) glass on top
      const behind = over(parseColor(p.veil), parseColor(backdrop));
      const surface = over(parseColor(m.glass), behind);
      for (const key of ['text', 'muted']) {
        it(`${phase}: ${key} on glass over ${backdrop}`, () => {
          expect(contrast(parseColor(m[key]), surface)).toBeGreaterThanOrEqual(4.5);
        });
      }
      for (const [mod, a] of Object.entries<Record<string, string>>(T.modules)) {
        it(`${phase}: ${mod} accent on glass over ${backdrop}`, () => {
          expect(contrast(parseColor(a[p.mode]!), surface)).toBeGreaterThanOrEqual(4.5); // accents also label small text
        });
      }
    }
  }
});
