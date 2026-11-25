import type { ActivitySpan } from '@orvyn/contracts';
import { describe as group, expect, it } from 'vitest';
import { buildDay, categorize, dayLines, describe, duration, inside, place } from '../src/index';

const T0 = Date.parse('2026-11-25T03:30:00Z'); // 9:00 in India
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
let n = 0;
const span = ({ m, ...o }: Partial<ActivitySpan> & { m: [number, number] }): ActivitySpan => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  source: 'web',
  kind: 'active',
  app: 'chrome',
  host: '',
  path: '',
  title: '',
  q: '',
  keys: 0,
  clicks: 0,
  scrolls: 0,
  ...o,
  start: at(m[0]),
  end: at(m[1]),
});
const day = (spans: ActivitySpan[]) =>
  buildDay('2026-11-25', spans, {
    from: T0 - 9 * 3_600_000,
    to: T0 + 15 * 3_600_000,
    hourOf: (ms) => new Date(ms + 5.5 * 3_600_000).getUTCHours(),
  });

group('what a page is', () => {
  const d = (url: string, title = '') => describe({ app: 'chrome', title, ...place(url)! });
  it('says what is being done, not only where', () => {
    expect(d('https://github.com/a/b/pull/12/files')).toEqual({
      place: 'GitHub',
      what: 'PR #12 · a/b (reviewing)',
    });
    expect(d('https://www.youtube.com/watch?v=x', '(3) Rust in 100 seconds - YouTube').what).toBe(
      'Rust in 100 seconds',
    );
    expect(d('https://www.google.com/search?q=css+grid').what).toBe('css grid');
    expect(
      describe({
        app: 'Code.exe',
        host: '',
        path: '',
        q: '',
        title: '● spec.md - orvyn - Visual Studio Code',
      }),
    ).toEqual({ place: 'VS Code', what: 'orvyn · spec.md' });
  });
  it('keeps no query string or fragment', () => {
    expect(place('https://x.test/reset?token=SECRET#k')).toEqual({ host: 'x.test', path: '/reset', q: '' });
    expect(place('https://x.test/?q=private')!.q).toBe('');
    expect(place('chrome://settings')).toBeNull();
  });
  it('own rules win, the most exact first; look-alikes do not match', () => {
    const r = { categories: { 'github.com': 'learning', 'gist.github.com': 'other' } as const };
    expect(categorize({ app: '', host: 'gist.github.com', path: '' }, r)).toBe('other');
    expect(categorize({ app: '', host: 'www.github.com', path: '' }, r)).toBe('learning');
    expect(inside('evilgithub.com', 'github.com')).toBe(false);
  });
});

group('a day', () => {
  it('never counts a minute twice: the browser explains the PC’s Chrome (AC7)', () => {
    const d = day([
      span({ source: 'pc', app: 'chrome.exe', title: 'x - Google Chrome', m: [0, 30] }),
      span({ host: 'github.com', path: '/a/b/pull/1', m: [0, 20], keys: 40 }),
      span({ host: 'www.youtube.com', path: '/watch', title: 'A video - YouTube', m: [20, 30] }),
    ]);
    expect(d.activeMs).toBe(30 * 60_000);
    expect(d.places.map((p) => p.place)).toEqual(['GitHub', 'YouTube']);
    expect(d.keys).toBe(40);
  });
  it('another program in front hides the page behind it', () => {
    const d = day([
      span({ source: 'pc', app: 'Code.exe', title: 'a.ts - orvyn - Visual Studio Code', m: [0, 30] }),
      span({ host: 'reddit.com', m: [0, 30] }),
    ]);
    expect(d.places.map((p) => p.place)).toEqual(['VS Code']);
  });
  it('away on the PC wins, unless a video is playing; locked always wins', () => {
    const d = day([
      span({ source: 'pc', kind: 'away', m: [0, 10] }),
      span({ host: 'youtube.com', kind: 'media', title: 'Film - YouTube', m: [5, 10] }),
      span({ source: 'pc', kind: 'locked', m: [10, 20] }),
      span({ host: 'youtube.com', kind: 'media', m: [10, 20] }),
    ]);
    expect(d.activeMs).toBe(5 * 60_000);
    expect(d.awayMs).toBe(15 * 60_000);
  });
  it('finds deep work across short interruptions, and leaves the interruption out', () => {
    const d = day([
      span({ host: 'github.com', path: '/a/b', m: [0, 15] }),
      span({ host: 'instagram.com', m: [15, 16] }),
      span({ host: 'github.com', path: '/a/b', m: [16, 30] }),
      span({ host: 'instagram.com', m: [30, 60] }),
    ]);
    expect(d.deep).toHaveLength(1);
    expect(d.deepMs).toBe(29 * 60_000);
    expect(d.switches).toBe(3);
  });
  it('cuts at midnight, shares counts, and fills the hours', () => {
    const d = buildDay('x', [span({ host: 'a.test', keys: 100, m: [0, 60] })], {
      from: T0 + 30 * 60_000,
      to: T0 + 24 * 3_600_000,
      hourOf: () => 9,
    });
    expect(d.activeMs).toBe(30 * 60_000);
    expect(d.keys).toBe(50);
    expect(d.hours[9]).toBe(30 * 60_000);
  });
  it('overlapping devices: the newest one counts, once', () => {
    expect(day([span({ host: 'a.test', m: [0, 30] }), span({ host: 'b.test', m: [10, 20] })]).activeMs).toBe(
      30 * 60_000,
    );
  });
  it('reads as lines without paths', () => {
    const d = day([span({ host: 'x.test', path: '/secret/path', title: 'Hello', m: [0, 10] })]);
    const text = dayLines(d, () => '9:00');
    expect(text).toContain('x.test 10 min (Hello 10 min)');
    expect(text).not.toContain('secret');
    expect(duration(0)).toBe('0 min');
    expect(duration(3_900_000)).toBe('1 h 5 min');
  });
});
