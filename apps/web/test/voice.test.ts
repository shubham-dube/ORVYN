import { describe, expect, it } from 'vitest';
import { joinFinals, voiceFileName } from '../lib/voice';

describe('voice: heard words are never repeated (spec 0007 A2)', () => {
  it('joins separate sentences', () => {
    expect(joinFinals(['pay rent', 'call mum'])).toBe('pay rent call mum');
  });
  it('a growing sentence replaces the shorter one (Chrome on Android)', () => {
    expect(joinFinals(['pay', 'pay rent', 'pay rent tomorrow'])).toBe('pay rent tomorrow');
    expect(joinFinals(['Pay rent.', 'pay rent tomorrow at 5'])).toBe('pay rent tomorrow at 5');
  });
  it('the same words twice count once; a shorter repeat is ignored', () => {
    expect(joinFinals(['buy milk', 'buy milk'])).toBe('buy milk');
    expect(joinFinals(['buy milk and bread', 'buy milk'])).toBe('buy milk and bread');
  });
  it('skips holes left by results that never became final', () => {
    const f: string[] = [];
    f[0] = 'hello';
    f[2] = 'world';
    expect(joinFinals(f)).toBe('hello world');
  });
  it('names a recording by its time and type', () => {
    expect(voiceFileName(new Blob([], { type: 'audio/webm' }), new Date(2026, 10, 18, 14, 5))).toBe(
      'voice-2026-11-18-1405.webm',
    );
    expect(voiceFileName(new Blob([], { type: 'audio/mp4' }), new Date(2026, 0, 2, 3, 4))).toBe(
      'voice-2026-01-02-0304.m4a',
    );
  });
});
