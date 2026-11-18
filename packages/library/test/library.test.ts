import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type DocLike, expiringSoon, expiry, expiryLabel, formatBytes, searchDocs } from '../src';

const f = JSON.parse(readFileSync(new URL('../fixtures/search.json', import.meta.url), 'utf8')) as {
  today: string;
  docs: DocLike[];
  searches: { q: string; ids: string[] }[];
  expiry: { on: string; days: number; urgency: string; label: string }[];
  expiringSoon: string[];
};

describe('Library search (shared with the Android app)', () => {
  it.each(f.searches.map((s) => [s.q, s] as const))('“%s”', (_, s) => {
    expect(searchDocs(f.docs, s.q).map((d) => d.id)).toEqual(s.ids);
  });
});

describe('expiry', () => {
  it.each(f.expiry.map((e) => [e.on, e] as const))('%s', (_, e) => {
    const x = expiry(e.on, f.today);
    expect(x).toEqual({ days: e.days, urgency: e.urgency });
    expect(expiryLabel(x.days)).toBe(e.label);
  });
  it('lists what runs out first, expired ones included', () => {
    expect(expiringSoon(f.docs, f.today).map((d) => d.id)).toEqual(f.expiringSoon);
    expect(expiry(null, f.today)).toEqual({ days: null, urgency: 'none' });
  });
  it('sizes in words', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
