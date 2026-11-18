import { describe, expect, it } from 'vitest';
import {
  effectiveReminders,
  STARTING_SETTINGS,
  TodaySettingsFields,
  workingRangesOn,
  type WeekPattern,
} from '../src/today';

const week = (
  ranges: { start: string; end: string }[],
  weekend: { start: string; end: string }[] = [],
): WeekPattern => ({
  mon: ranges,
  tue: ranges,
  wed: ranges,
  thu: ranges,
  fri: ranges,
  sat: weekend,
  sun: weekend,
});

describe('working hours change over time (D16)', () => {
  const s = {
    patterns: [
      { validFrom: '2026-01-01', week: week([{ start: '10:00', end: '19:00' }]) },
      // from 1 Dec: 9–13 and 14–17, Saturdays 10–12
      {
        validFrom: '2026-12-01',
        week: week(
          [
            { start: '09:00', end: '13:00' },
            { start: '14:00', end: '17:00' },
          ],
          [{ start: '10:00', end: '12:00' }],
        ),
      },
    ],
    dayOverrides: [
      { date: '2026-12-25', ranges: [] }, // day off
      { date: '2026-11-21', ranges: [{ start: '11:00', end: '14:00' }] }, // a working Saturday
    ],
  };

  it('uses the pattern that has started by that date', () => {
    expect(workingRangesOn(s, '2026-11-17')).toEqual([{ start: '10:00', end: '19:00' }]); // Tuesday, old pattern
    expect(workingRangesOn(s, '2026-12-01')).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '17:00' },
    ]);
    expect(workingRangesOn(s, '2026-12-06')).toEqual([{ start: '10:00', end: '12:00' }]); // Saturday, new pattern
    expect(workingRangesOn(s, '2026-11-22')).toEqual([]); // Sunday
  });

  it('a day override beats the pattern', () => {
    expect(workingRangesOn(s, '2026-12-25')).toEqual([]);
    expect(workingRangesOn(s, '2026-11-21')).toEqual([{ start: '11:00', end: '14:00' }]);
  });

  it('before the first pattern there are no working hours', () => {
    expect(workingRangesOn(s, '2025-06-01')).toEqual([]);
  });

  it('validates what a person can save', () => {
    expect(TodaySettingsFields.safeParse(STARTING_SETTINGS).success).toBe(true);
    const bad = (patch: object) => TodaySettingsFields.safeParse({ ...STARTING_SETTINGS, ...patch }).success;
    expect(bad({ patterns: [] })).toBe(false); // at least one pattern
    expect(bad({ patterns: [...STARTING_SETTINGS.patterns, ...STARTING_SETTINGS.patterns] })).toBe(false); // same start date twice
    expect(
      bad({ patterns: [{ validFrom: '2026-01-01', week: week([{ start: '18:00', end: '09:00' }]) }] }),
    ).toBe(false); // backwards
    expect(
      bad({
        patterns: [
          {
            validFrom: '2026-01-01',
            week: week([
              { start: '09:00', end: '13:00' },
              { start: '12:00', end: '17:00' },
            ]),
          },
        ],
      }),
    ).toBe(false); // overlap
    expect(bad({ noPlanAfter: '25:00' })).toBe(false);
    expect(bad({ reminders: { timed: [10], dateOnly: { mode: 'ping' }, overdueInDigest: true } })).toBe(
      false,
    ); // ping needs a time
  });
});

describe('reminders are the person’s (D17)', () => {
  const defaults = {
    timed: [1440, 10],
    dateOnly: { mode: 'digest' as const, at: '08:30' },
    overdueInDigest: true,
  };
  it('timed tasks use the defaults unless they have their own', () => {
    const t = { reminders: null, dueAt: '2026-11-20T10:00:00Z', scheduledStart: null, dueDate: null };
    expect(effectiveReminders(t, defaults)).toEqual({ before: [1440, 10], at: [] });
    expect(effectiveReminders({ ...t, reminders: [{ kind: 'before', minutes: 30 }] }, defaults)).toEqual({
      before: [30],
      at: [],
    });
    expect(
      effectiveReminders({ ...t, reminders: [{ kind: 'at', at: '2026-11-20T08:00:00Z' }] }, defaults),
    ).toEqual({ before: [], at: ['2026-11-20T08:00:00Z'] });
    expect(effectiveReminders({ ...t, reminders: [] }, defaults)).toEqual({ before: [], at: [] }); // "no reminder for this one"
  });
  it('date-only tasks are left to the digest/ping setting', () => {
    expect(
      effectiveReminders(
        { reminders: null, dueAt: null, scheduledStart: null, dueDate: '2026-11-20' },
        defaults,
      ),
    ).toEqual({ before: [], at: [] });
  });
});

describe('reminderPlan: when and by which ways (D22)', () => {
  const t = {
    reminders: null,
    dueAt: '2026-11-20T10:00:00+05:30',
    scheduledStart: null,
    dueDate: null,
  } as const;
  const defaults = { timed: [60, 10], dateOnly: { mode: 'none' as const }, overdueInDigest: false };
  it('defaults: each lead by the default ways (a normal notification if none chosen)', async () => {
    const { reminderPlan } = await import('../src/today');
    expect(reminderPlan(t, defaults)).toEqual([
      { minutes: 60, via: ['push'] },
      { minutes: 10, via: ['push'] },
    ]);
    expect(reminderPlan(t, { ...defaults, via: ['alarm', 'email'] })[0]!.via).toEqual(['alarm', 'email']);
  });
  it('a task’s own reminders keep their own ways, else the defaults; [] means none; date-only gets none here', async () => {
    const { reminderPlan } = await import('../src/today');
    const own = reminderPlan(
      {
        ...t,
        reminders: [
          { kind: 'before', minutes: 5, via: ['urgent'] },
          { kind: 'at', at: '2026-11-20T04:00:00Z' },
        ],
      },
      { ...defaults, via: ['whatsapp'] },
    );
    expect(own).toEqual([
      { minutes: 5, via: ['urgent'] },
      { at: '2026-11-20T04:00:00Z', via: ['whatsapp'] },
    ]);
    expect(reminderPlan({ ...t, reminders: [] }, defaults)).toEqual([]);
    expect(reminderPlan({ ...t, dueAt: null }, defaults)).toEqual([]);
  });
});
