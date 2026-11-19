import { describe, expect, it } from 'vitest';
import { parseTask } from '../src/index';

const IST = { now: new Date('2026-11-16T09:30:00+05:30'), timeZone: 'Asia/Kolkata' };

describe('spans, for the chips the person can remove', () => {
  it('reports what it understood, where', () => {
    const input = 'dentist fri 11 for 45m !! #health';
    const p = parseTask(input, IST);
    expect(p.spans.map((s) => [s.kind, s.text])).toEqual([
      ['date', 'fri'],
      ['time', '11'],
      ['duration', 'for 45m'],
      ['priority', '!!'],
      ['tag', '#health'],
    ]);
    for (const s of p.spans) expect(input.slice(s.start, s.end).trim()).toBe(s.text);
  });

  it('an unknown @project is offered, not dropped', () => {
    const p = parseTask('plan garden @allotment', { ...IST, projects: [{ id: 'h', name: 'Home' }] });
    expect([p.title, p.projectId, p.projectName]).toEqual(['Plan garden', null, 'allotment']);
  });
});

describe('time zones', () => {
  it('reads the wall clock where the person is', () => {
    const ny = { now: new Date('2026-11-16T09:30:00-05:00'), timeZone: 'America/New_York' };
    const p = parseTask('call mom tomorrow 6pm', ny);
    expect(p.dueAt).toBe('2026-11-17T23:00:00.000Z');
  });
  it('late evening in India is still today', () => {
    const late = { now: new Date('2026-11-16T23:10:00+05:30'), timeZone: 'Asia/Kolkata' };
    expect(parseTask('pay rent today', late).dueDate).toBe('2026-11-16');
    expect(parseTask('pay rent tomorrow', late).dueDate).toBe('2026-11-17');
  });
});

describe('robustness', () => {
  it('never throws and never returns an empty title', () => {
    const samples = [
      '',
      ' ',
      '!!!',
      '#',
      '@',
      'every',
      'at',
      'tomorrow',
      '12/34',
      '99:99',
      'every 45th',
      'kal kal kal',
      '😀 party sat',
      'a'.repeat(500),
    ];
    for (const s of samples) {
      const p = parseTask(s, IST);
      expect(typeof p.title).toBe('string');
      if (s.trim()) expect(p.title.length).toBeGreaterThan(0);
    }
  });
  it('a title that is only a date keeps the words', () => {
    expect(parseTask('tomorrow', IST)).toMatchObject({ title: 'tomorrow', dueDate: '2026-11-17' });
  });
});

describe('removing a chip', () => {
  it('reads that part literally and keeps it in the title', () => {
    const input = 'book Friday show tickets';
    const first = parseTask(input, IST);
    expect(first).toMatchObject({ title: 'Book show tickets', dueDate: '2026-11-20' }); // "Friday" taken as the date…
    const fri = first.spans.find((s) => s.text === 'Friday')!;
    const again = parseTask(input, { ...IST, literal: [[fri.start, fri.end]] });
    expect(again).toMatchObject({ title: 'Book Friday show tickets', dueDate: null }); // …but it was the show's name
  });

  it('a second date phrase stays in the title', () => {
    expect(parseTask('book Friday show tickets tomorrow', IST)).toMatchObject({
      title: 'Book Friday show tickets',
      dueDate: '2026-11-17',
    });
  });
});

describe('when to ask the AI', () => {
  it('only when date/time-looking words were left unread', async () => {
    const { looksUnread } = await import('../src/index');
    expect(looksUnread({ title: 'Buy milk', dueDate: null, dueAt: null, rrule: null })).toBe(false);
    expect(
      looksUnread({
        title: 'Dentist on the second tuesday of next month',
        dueDate: null,
        dueAt: null,
        rrule: null,
      }),
    ).toBe(true);
    expect(looksUnread({ title: 'email at 9:30', dueDate: '2026-11-16', dueAt: null, rrule: null })).toBe(
      true,
    );
    expect(
      looksUnread({ title: 'Standup', dueDate: null, dueAt: '2026-11-16T04:30:00Z', rrule: 'FREQ=DAILY' }),
    ).toBe(false);
  });
});

describe('"in 10 min" is when; "10 min" or "for 10 min" is how long', () => {
  it.each([
    ['call mom in 10 min', '2026-11-16T04:10:00.000Z', null],
    ['call mom in 10 mins', '2026-11-16T04:10:00.000Z', null],
    ['gym 45 min', null, 45],
    ['call mom in 10 min for 15 min', '2026-11-16T04:10:00.000Z', 15],
  ])('%s', (text, dueAt, durationMin) => {
    const p = parseTask(text, IST);
    expect(p.dueAt).toBe(dueAt);
    expect(p.durationMin).toBe(durationMin);
  });
});
