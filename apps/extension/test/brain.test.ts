import { type FillField, FillMapRequest, FillProfile } from '@orvyn/contracts';
import { describe, expect, it } from 'vitest';
import { applyMap, chooseOption, loginFits, plan, ruleKey, sameQuestion, shape } from '../src/match';
import { keepable, pageKey, parseRecall, type PageMemory, priceLine, rank, tokensOf } from '../src/recall';
import { rewind, step, type TrackState } from '../src/tracker';

const f = (o: Partial<FillField>): FillField => ({
  id: 'f',
  label: '',
  type: 'text',
  name: '',
  autocomplete: '',
  options: [],
  ...o,
});
const profile = FillProfile.parse({
  facts: [
    { key: 'first_name', label: 'First name', value: 'Asha', group: 'identity' },
    { key: 'last_name', label: 'Last name', value: 'Rao', group: 'identity' },
    { key: 'email', label: 'Email', value: 'asha@example.test', group: 'contact' },
    { key: 'date_of_birth', label: 'Date of birth', value: '03/04/1999', group: 'identity' },
    { key: 'country', label: 'Country', value: 'India', group: 'address' },
    { key: 'total_experience_years', label: 'Experience', value: '4', group: 'work' },
  ],
  answers: [{ q: 'Are you legally authorized to work in India?', a: 'Yes', host: 'x.test' }],
});

describe('magic fill: which fact answers which field', () => {
  it('reads labels, names and autocomplete', () => {
    expect(ruleKey(f({ label: 'First Name *' }))).toBe('first_name');
    expect(ruleKey(f({ label: 'E-mail Address' }))).toBe('email');
    expect(ruleKey(f({ name: 'lastName' }))).toBe('last_name');
    expect(ruleKey(f({ label: 'x', autocomplete: 'section-a billing postal-code' }))).toBe('postal_code');
    expect(ruleKey(f({ label: 'Father’s name' }))).toBeNull();
    expect(ruleKey(f({ label: 'Emergency contact', autocomplete: 'name' }))).toBeNull();
    expect(ruleKey(f({ label: 'Company website you admire' }))).toBeNull();
  });
  it('never touches secrets', () => {
    for (const label of ['Password', 'OTP', 'Card number', 'CVV', 'Captcha', 'Search'])
      expect(plan([f({ label })], profile, 'x.test')).toEqual({ matches: [], unknown: [] });
    expect(ruleKey(f({ label: 'Name', autocomplete: 'cc-name' }))).toBeNull();
  });
  it('shapes values: dates, choices, ranges, numbers', () => {
    expect(shape(f({ type: 'date' }), '03/04/1999')).toBe('1999-04-03');
    expect(shape(f({ type: 'number' }), '12,00,000 INR')).toBe('1200000');
    expect(chooseOption(['Select', 'IN', 'US'], 'India')).toBe('IN');
    expect(chooseOption(['0-2 years', '3-5 years', '6+ years'], '4')).toBe('3-5 years');
    expect(chooseOption(['Yes', 'No', 'No, but later'], 'yes')).toBe('Yes');
    expect(chooseOption(['Indiana', 'Ohio'], 'India')).toBeNull();
    expect(chooseOption(['Male', 'Female'], 'male')).toBe('Male');
  });
  it('full name from its parts; taught answers first; the rest is left for the AI', () => {
    const r = plan(
      [
        f({ id: 'a', label: 'Full name' }),
        f({ id: 'b', label: 'Are you legally authorized to work in India', options: ['Yes', 'No'] }),
        f({ id: 'c', label: 'How did you hear about us?' }),
      ],
      profile,
      'x.test',
    );
    expect(r.matches.map((m) => [m.id, m.value, m.from])).toEqual([
      ['a', 'Asha Rao', 'rule'],
      ['b', 'Yes', 'taught'],
    ]);
    expect(r.unknown.map((u) => u.id)).toEqual(['c']);
  });
  it('a question with a different place, number or a “not” is a different question', () => {
    expect(
      sameQuestion(
        'Are you legally authorized to work in India?',
        'Are you legally authorized to work in Canada?',
      ),
    ).toBe(false);
    expect(sameQuestion('Do you have 3 years of Go experience', 'Do you have 5 years of Go experience')).toBe(
      false,
    );
    expect(
      sameQuestion(
        'Will you require a visa to work here now',
        'Will you not require a visa to work here now',
      ),
    ).toBe(false);
  });
  it('what goes to the AI holds no values; its answer becomes values here (AC4)', () => {
    const fields = [f({ id: 'x', label: 'Contact mail for updates' })];
    const req = FillMapRequest.parse({
      fields,
      keys: profile.facts.map((k) => ({ key: k.key, label: k.label })),
    });
    for (const fact of profile.facts.filter((k) => k.value.length > 2))
      expect(JSON.stringify(req)).not.toContain(fact.value);
    expect(applyMap([{ id: 'x', key: 'email' }], fields, profile)[0]!.value).toBe('asha@example.test');
    expect(applyMap([{ id: 'x', key: null }], fields, profile)).toEqual([]);
  });
});

describe('a saved login fits a page (AC5)', () => {
  it('same host and its subdomains over https', () => {
    expect(loginFits('https://github.com/login', 'https://github.com/session')).toBe(true);
    expect(loginFits('github.com', 'https://gist.github.com/')).toBe(true);
    expect(loginFits('http://localhost:3000', 'http://localhost:3000/x')).toBe(true);
  });
  it('refuses http, other hosts, look-alikes, parents and shared suffixes', () => {
    for (const [saved, page] of [
      ['github.com', 'http://github.com/'],
      ['github.com', 'https://evilgithub.com/'],
      ['github.com', 'https://github.com.evil.test/'],
      ['accounts.google.com', 'https://google.com/'],
      ['https://github.io', 'https://someone.github.io/'],
      ['co.in', 'https://bank.co.in/'],
      ['http://localhost:3000', 'http://localhost:4000/'],
      ['', 'https://x.test/'],
      ['javascript:alert(1)', 'https://x.test/'],
    ] as const)
      expect(loginFits(saved, page), `${saved} on ${page}`).toBe(false);
  });
});

describe('the tracker', () => {
  const T = Date.parse('2026-11-25T05:00:00Z');
  let n = 0;
  const o = { id: () => `id${++n}`, app: 'chrome' };
  const run = (beats: [number, string | null, Partial<Parameters<typeof step>[1]>?][]) => {
    let s: TrackState = { open: null };
    const closed = [];
    for (const [sec, url, extra] of beats) {
      const r = step(s, { t: T + sec * 1000, url, title: 'T', kind: 'active', ...extra }, o);
      s = r.state;
      if (r.closed) closed.push(r.closed);
    }
    return { open: s.open, closed };
  };
  const secs = (x: { start: string; end: string }) => (Date.parse(x.end) - Date.parse(x.start)) / 1000;

  it('beats on one page are one span, with counts', () => {
    const r = run([
      [0, 'https://a.test/x', { keys: 2 }],
      [15, 'https://a.test/x', { keys: 3 }],
      [30, 'https://a.test/x'],
    ]);
    expect(r.closed).toEqual([]);
    expect(secs(r.open!)).toBe(30);
    expect(r.open!.keys).toBe(5);
  });
  it('a new page ends the last one at that moment; leaving Chrome ends it too', () => {
    const r = run([
      [0, 'https://a.test/'],
      [40, 'https://b.test/?token=s'],
      [60, null],
    ]);
    expect(r.closed.map((c) => [c.host, secs(c)])).toEqual([
      ['a.test', 40],
      ['b.test', 20],
    ]);
    expect(JSON.stringify(r.closed)).not.toContain('token');
    expect(r.open).toBeNull();
  });
  it('silence (a closed lid) is not counted', () => {
    const r = run([
      [0, 'https://a.test/'],
      [15, 'https://a.test/'],
      [4000, 'https://a.test/'],
    ]);
    expect(r.closed.map(secs)).toEqual([15]);
    expect(secs(r.open!)).toBe(0);
  });
  it('gives back the idle minute, then records away', () => {
    let s = step({ open: null }, { t: T, url: 'https://a.test/', kind: 'active' }, o).state;
    s = step(s, { t: T + 80_000, url: 'https://a.test/', kind: 'active' }, o).state;
    s = rewind(s, T + 90_000, 60_000);
    const r = step(s, { t: T + 30_000, url: null, kind: 'away' }, o);
    expect(secs(r.closed!)).toBe(30);
    const back = step(r.state, { t: T + 630_000, url: 'https://a.test/', kind: 'active' }, o);
    expect(back.closed!.kind).toBe('away');
    expect(secs(back.closed!)).toBe(600);
  });
});

describe('recall (AC9)', () => {
  it('skips what is private', () => {
    for (const u of [
      'https://netbanking.hdfcbank.com/home',
      'https://accounts.google.com/x',
      'https://shop.test/checkout/1',
      'http://192.168.1.1/',
      'http://localhost:3000/',
      'file:///C:/x.html',
      'https://x.test/login',
    ])
      expect(keepable(u, false), u).toBe(false);
    expect(keepable('https://blog.test/post', true)).toBe(false);
    expect(keepable('https://blog.test/post', false)).toBe(true);
    expect(pageKey('https://a.test/p?id=7&utm_source=x&access_token=s#top')).toBe('https://a.test/p?id=7');
  });
  const page = (title: string, text: string, lastAt: number): PageMemory => ({
    url: `https://x.test/${title}`,
    host: 'x.test',
    title,
    text,
    tokens: tokensOf(title, text),
    firstAt: lastAt,
    lastAt,
    visits: 1,
    dwellMs: 60_000,
    prices: [],
    notes: [],
  });
  const now = new Date(2026, 10, 25, 12); // a Wednesday
  it('finds by words and by day', () => {
    const tue = new Date(2026, 10, 24, 10).getTime();
    const pages = [
      page('Postgres indexes explained', 'btree and gin indexes for search', tue),
      page('Cooking dal', 'lentils and spices', tue),
      page('Postgres vacuum', 'autovacuum tuning', new Date(2026, 10, 1).getTime()),
    ];
    const q = parseRecall('that page about postgres I read on tuesday', now);
    expect(q.from).toBe(new Date(2026, 10, 24).getTime());
    expect(rank(pages, q, now.getTime()).map((p) => p.title)).toEqual(['Postgres indexes explained']);
    expect(rank(pages, parseRecall('postgres index', now), now.getTime())[0]!.title).toBe(
      'Postgres indexes explained',
    );
    expect(rank(pages, parseRecall('kubernetes', now), now.getTime())).toEqual([]);
  });
  it('remembers prices', () => {
    const p = (price: number, at: number) => ({ price, currency: 'INR', at });
    expect(priceLine([p(100, 1)])).toBeNull();
    expect(priceLine([p(100, 1), p(90, 2)])).toMatch(/^Lowest/);
    expect(priceLine([p(100, 1), p(120, 2)])).toMatch(/^Was 100/);
  });
});
