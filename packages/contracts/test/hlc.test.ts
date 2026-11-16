import { describe, expect, it } from 'vitest';
import { Hlc, compareHlc, parseHlc } from '../src/hlc';

describe('HLC', () => {
  it('is monotonic even when the wall clock stands still or goes back', () => {
    let t = 1_000;
    const c = new Hlc('a', () => t);
    const a = c.tick();
    const b = c.tick();
    t = 900; // clock went backwards
    const d = c.tick();
    expect(compareHlc(a, b)).toBe(-1);
    expect(compareHlc(b, d)).toBe(-1);
  });

  it('merges remote timestamps so causality is preserved', () => {
    const local = new Hlc('a', () => 1_000);
    const remote = new Hlc('b', () => 5_000);
    const r = remote.tick();
    const after = local.receive(r);
    expect(compareHlc(r, after)).toBe(-1);
    expect(parseHlc(after).ms).toBe(5_000);
  });

  it('rejects remote clocks far in the future', () => {
    const local = new Hlc('a', () => 0);
    expect(() => local.receive('000000999999999:00000:b')).toThrow();
  });

  it('breaks ties deterministically by node id', () => {
    expect(compareHlc('000000000001000:00000:a', '000000000001000:00000:b')).toBe(-1);
  });
});
