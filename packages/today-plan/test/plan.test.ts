import { STARTING_SETTINGS } from '@orvyn/contracts';
import { describe, expect, it } from 'vitest';
import { type PlanTask, planDay } from '../src/plan';

const IST = (hhmm: string, day = '2026-11-16') => new Date(`${day}T${hhmm}:00+05:30`).toISOString();
const settings = { ...STARTING_SETTINGS, timeZone: 'Asia/Kolkata' }; // Mon–Fri 10:00–19:00, 15 min gaps, plan until 22:00
const task = (id: string, f: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title: id,
  priority: 0,
  durationMin: null,
  dueDate: '2026-11-16',
  dueAt: null,
  scheduledStart: null,
  completedAt: null,
  ...f,
});
const local = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

describe('plan my day', () => {
  it('fills working hours around fixed events, most pressing first, with the gap between', () => {
    const p = planDay({
      date: '2026-11-16',
      now: new Date(IST('09:30')),
      settings,
      busy: [
        { title: 'Standup', start: IST('10:00'), end: IST('10:30') },
        { title: 'Client call', start: IST('12:00'), end: IST('13:00') },
      ],
      tasks: [
        task('write report', { durationMin: 60, priority: 2 }),
        task('pay rent', { priority: 3, durationMin: 15 }),
        task('old thing', { dueDate: '2026-11-13' }),
        task('later', { dueDate: '2026-11-20' }), // not due yet
        task('done', { completedAt: IST('09:00') }),
        task('timed', { dueAt: IST('15:00'), durationMin: 30 }), // a wall, not moved
      ],
    });
    expect(p.placed.map((x) => [x.taskId, local(x.start), local(x.end)])).toEqual([
      ['old thing', '10:45', '11:15'], // overdue first, after Standup + 15 min gap
      ['pay rent', '11:30', '11:45'],
      ['write report', '13:15', '14:15'], // doesn't fit before the 12:00 call with gaps, so after it
    ]);
    expect(p.placed[0]!.reason).toMatch(
      /^overdue since 13 Nov · 30 min \(no length set, so 30\) · fits before Client call at 12:00/i,
    );
    expect(p.placed[1]!.reason).toMatch(/due today · high priority · 15 min/);
    expect(p.unplaced).toEqual([]);
  });

  it('never before now, never after the cutoff, never outside working hours', () => {
    const p = planDay({
      date: '2026-11-16',
      now: new Date(IST('18:20')),
      settings,
      busy: [],
      tasks: [task('a', { durationMin: 30 }), task('b', { durationMin: 60 })],
    });
    expect(p.placed.map((x) => local(x.start))).toEqual(['18:20']);
    expect(p.unplaced[0]).toMatchObject({
      taskId: 'b',
      reason: 'needs 60 min; the longest free stretch left is 0 min',
    });
  });

  it('uses the pattern for that date, and day overrides (D16)', () => {
    const s = {
      ...settings,
      dayOverrides: [{ date: '2026-11-21', ranges: [{ start: '11:00', end: '12:00' }] }],
    };
    const sat = planDay({
      date: '2026-11-21',
      now: new Date(IST('08:00', '2026-11-21')),
      settings: s,
      busy: [],
      tasks: [task('x', { dueDate: '2026-11-21' })],
    });
    expect(sat.placed.map((x) => local(x.start))).toEqual(['11:00']);
    const sun = planDay({
      date: '2026-11-22',
      now: new Date(IST('08:00', '2026-11-22')),
      settings: s,
      busy: [],
      tasks: [task('y', { dueDate: '2026-11-22' })],
    });
    expect(sun.unplaced[0]!.reason).toBe('no working hours on this day');
  });

  it('plans a future day from the start of its hours', () => {
    const p = planDay({
      date: '2026-11-17',
      now: new Date(IST('20:00')),
      settings,
      busy: [],
      tasks: [task('t', { dueDate: '2026-11-17' })],
    });
    expect(local(p.placed[0]!.start)).toBe('10:00');
  });
});
