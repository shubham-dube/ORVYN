import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  allTags,
  checklistProgress,
  describeQuery,
  EMPTY_QUERY,
  isEmptyQuery,
  type TaskLike,
  type TaskQuery,
  taskMatches,
} from '../src';

const f = JSON.parse(readFileSync(new URL('../fixtures/task-query.json', import.meta.url), 'utf8')) as {
  now: string;
  timeZone: string;
  tasks: TaskLike[];
  queries: { q: Partial<TaskQuery>; matches: string[] }[];
};

describe('task search and filters (shared with the Android app)', () => {
  it.each(f.queries.map((c) => [JSON.stringify(c.q), c] as const))('%s', (_, c) => {
    const q = { ...EMPTY_QUERY, ...c.q };
    expect(f.tasks.filter((t) => taskMatches(t, q, new Date(f.now), f.timeZone)).map((t) => t.title)).toEqual(
      c.matches,
    );
  });
});

describe('small helpers', () => {
  it('counts checklist progress', () => {
    expect(checklistProgress(f.tasks[2]!)).toEqual({ done: 1, total: 2 });
    expect(checklistProgress(f.tasks[0]!)).toEqual({ done: 0, total: 0 });
  });
  it('lists tags by use, ignoring case', () => {
    expect(allTags(f.tasks)).toEqual(['home', 'money', 'urgent', 'work']);
  });
  it('knows an empty query and describes a full one', () => {
    expect(isEmptyQuery(EMPTY_QUERY)).toBe(true);
    const q: TaskQuery = { text: 'bank', projectId: 'p-work', tag: 'urgent', minPriority: 3, when: 'week' };
    expect(isEmptyQuery(q)).toBe(false);
    expect(describeQuery(q, (id) => (id === 'p-work' ? 'Work' : undefined))).toBe(
      '“bank” · Work · #urgent · high priority · next 7 days',
    );
    expect(describeQuery(EMPTY_QUERY)).toBe('Everything');
  });
});
