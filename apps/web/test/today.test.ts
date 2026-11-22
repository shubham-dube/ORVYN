import type { Task } from '@orvyn/contracts';
import { describe, expect, it } from 'vitest';
import { groupTasks, localDay, taskDay } from '../lib/today';

const base: Task = {
  id: 'x',
  title: 't',
  notes: '',
  checklist: [],
  projectId: null,
  tags: [],
  priority: 0,
  dueDate: null,
  dueAt: null,
  scheduledStart: null,
  durationMin: null,
  timeZone: 'Asia/Kolkata',
  rrule: null,
  reminders: null,
  completedAt: null,
  lastDoneAt: null,
  source: 'typed',
  deadline: null,
  status: 'todo',
};
const t = (id: string, f: Partial<Task>): Task => ({ ...base, id, title: id, ...f });
const now = new Date(2026, 10, 16, 9, 0); // 16 Nov 2026, 09:00 local

describe('Today grouping', () => {
  it('a time block wins over a due moment, which wins over a due date', () => {
    expect(
      taskDay(
        t('a', {
          dueDate: '2026-11-20',
          dueAt: new Date(2026, 10, 18, 9).toISOString(),
          scheduledStart: new Date(2026, 10, 17, 9).toISOString(),
        }),
      ),
    ).toBe('2026-11-17');
    expect(taskDay(t('b', { dueDate: '2026-11-20', dueAt: new Date(2026, 10, 18, 9).toISOString() }))).toBe(
      '2026-11-18',
    );
    expect(taskDay(t('c', { dueDate: '2026-11-20' }))).toBe('2026-11-20');
    expect(taskDay(t('d', {}))).toBeNull();
  });

  it('sorts into overdue, today (by time, then priority), upcoming, inbox and done today', () => {
    const g = groupTasks(
      [
        t('late', { dueDate: '2026-11-15' }),
        t('at-14', { dueAt: new Date(2026, 10, 16, 14).toISOString() }),
        t('at-10', { dueAt: new Date(2026, 10, 16, 10).toISOString() }),
        t('anytime-high', { dueDate: '2026-11-16', priority: 3 }),
        t('anytime-low', { dueDate: '2026-11-16' }),
        t('tomorrow', { dueDate: '2026-11-17' }),
        t('someday', {}),
        t('done-now', { dueDate: '2026-11-16', completedAt: new Date(2026, 10, 16, 8).toISOString() }),
        t('done-yesterday', { completedAt: new Date(2026, 10, 15, 8).toISOString() }),
      ],
      now,
    );
    expect(g.overdue.map((x) => x.id)).toEqual(['late']);
    expect(g.today.map((x) => x.id)).toEqual(['at-10', 'at-14', 'anytime-high', 'anytime-low']);
    expect(g.upcoming.map((x) => x.id)).toEqual(['tomorrow']);
    expect(g.inbox.map((x) => x.id)).toEqual(['someday']);
    expect(g.doneToday.map((x) => x.id)).toEqual(['done-now']);
  });

  it('days are local, not UTC (late evening in India is still today)', () => {
    const lateEvening = new Date(2026, 10, 16, 23, 30);
    expect(localDay(lateEvening)).toBe('2026-11-16');
  });
});

describe('a deadline that has come puts a task in Today (spec 0012 A2)', () => {
  it('only a deadline: Today when it is today, the Inbox when it is later', () => {
    const g = groupTasks([t('tax', { deadline: localDay(now) }), t('visa', { deadline: '2026-12-01' })], now);
    expect(g.today.map((x) => x.id)).toEqual(['tax']);
    expect(g.inbox.map((x) => x.id)).toEqual(['visa']);
  });
});
