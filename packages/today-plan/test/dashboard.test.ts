import { describe, expect, it } from 'vitest';
import { dayShape, type Instance, weekAhead } from '../src';

const tz = 'Asia/Kolkata';
const now = new Date('2026-11-18T10:00:00+05:30'); // Wednesday
const task = (id: string, f: Record<string, unknown>) => ({
  id,
  title: id,
  tags: [],
  projectId: null,
  priority: 0,
  dueDate: null,
  dueAt: null,
  scheduledStart: null,
  completedAt: null,
  checklist: [],
  ...f,
});
const ev = (id: string, f: Partial<Instance>): Instance => ({
  eventId: id,
  seriesId: null,
  occurrence: null,
  title: id,
  location: '',
  calendarId: null,
  allDay: false,
  start: null,
  end: null,
  startDate: null,
  endDate: null,
  ...f,
});

describe('the shape of the day', () => {
  const tasks = [
    task('overdue', { dueDate: '2026-11-17' }),
    task('late-call', { dueAt: '2026-11-18T16:00:00+05:30' }),
    task('already-past', { dueAt: '2026-11-18T08:00:00+05:30' }),
    task('anytime', { dueDate: '2026-11-18' }),
    task('done', { dueDate: '2026-11-18', completedAt: '2026-11-18T07:00:00+05:30' }),
    task('done-yesterday', { completedAt: '2026-11-17T07:00:00+05:30' }),
    task('tomorrow', { dueDate: '2026-11-19' }),
    task('inbox', {}),
  ];
  const events = [
    ev('standup', { start: '2026-11-18T10:30:00+05:30', end: '2026-11-18T11:00:00+05:30' }),
    ev('over', { start: '2026-11-18T08:00:00+05:30', end: '2026-11-18T09:00:00+05:30' }),
    ev('holiday', { allDay: true, startDate: '2026-11-18', endDate: '2026-11-19' }),
    ev('tomorrow', { start: '2026-11-19T10:00:00+05:30', end: '2026-11-19T11:00:00+05:30' }),
  ];
  const s = dayShape(tasks, events, now, tz);

  it('counts what is open, done today and overdue', () => {
    expect(s.open).toBe(4); // overdue, late-call, already-past, anytime
    expect(s.overdue).toBe(1);
    expect(s.doneToday).toBe(1);
    expect(s.progress).toBeCloseTo(1 / 5);
  });

  it('lists what is next in order: all-day, then by time, then timeless; past things drop out', () => {
    expect(s.next.map((n) => n.title)).toEqual(['holiday', 'standup', 'late-call', 'anytime']);
  });

  it('says it in a line', () => {
    expect(s.line).toBe('4 to do · next: standup at 10:30');
    expect(dayShape([], [], now, tz).line).toBe('a clear day');
    expect(dayShape([tasks[4]!], [], now, tz)).toMatchObject({ line: 'all done', progress: 1 });
  });
});

describe('week ahead', () => {
  it('counts open tasks on each of the next days', () => {
    const w = weekAhead(
      [
        task('a', { dueDate: '2026-11-18' }),
        task('b', { dueAt: '2026-11-18T22:00:00+05:30' }),
        task('c', { dueDate: '2026-11-20' }),
        task('d', { dueDate: '2026-11-20', completedAt: '2026-11-18T07:00:00+05:30' }),
        task('e', { dueDate: '2026-11-30' }),
        task('f', { dueDate: '2026-11-17' }),
      ],
      now,
      tz,
    );
    expect(w).toHaveLength(7);
    expect(w[0]).toEqual({ date: '2026-11-18', count: 2 });
    expect(w[2]).toEqual({ date: '2026-11-20', count: 1 });
    expect(w.reduce((a, d) => a + d.count, 0)).toBe(3);
  });
});
