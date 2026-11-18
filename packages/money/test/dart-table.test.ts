import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('the Dart reader uses the same merchant table', () => {
  it('apps/mobile/lib/money/merchants.g.dart is up to date (run tool/gen-dart.py)', () => {
    const file = join(__dirname, '../../../apps/mobile/lib/money/merchants.g.dart');
    const before = readFileSync(file, 'utf8');
    execFileSync('python3', [join(__dirname, '../tool/gen-dart.py')]);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});
