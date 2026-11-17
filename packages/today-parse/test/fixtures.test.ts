import { describe, expect, it } from 'vitest';
import { parseTask, wallIn } from '../src/index';
import { CASES, type Expect, NOW, PROJECTS } from './fixtures';

const opts = { now: new Date(NOW), timeZone: 'Asia/Kolkata', projects: PROJECTS };
const local = (iso: string) => {
  const w = wallIn(new Date(iso), 'Asia/Kolkata');
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')} ${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`;
};

function actual(input: string): Expect {
  const p = parseTask(input, opts);
  const e: Expect = { title: p.title };
  if (p.dueDate) e.d = p.dueDate;
  if (p.dueAt) e.at = local(p.dueAt);
  if (p.durationMin) e.dur = p.durationMin;
  if (p.rrule) e.rrule = p.rrule;
  if (p.priority) e.p = p.priority;
  if (p.tags.length) e.tags = p.tags;
  if (p.projectId) e.project = p.projectId;
  return e;
}

describe('the 200-phrase set (spec 0002 AC1)', () => {
  it('is at least 97% exact', () => {
    const misses = CASES.flatMap(([input, want]) => {
      const got = actual(input);
      return JSON.stringify(got) === JSON.stringify(canonical(want))
        ? []
        : [{ input, want: canonical(want), got }];
    });
    const rate = 1 - misses.length / CASES.length;
    if (misses.length)
      console.warn(
        misses
          .map((m) => `✗ ${m.input}\n   want ${JSON.stringify(m.want)}\n   got  ${JSON.stringify(m.got)}`)
          .join('\n'),
      );
    console.warn(`exact: ${CASES.length - misses.length}/${CASES.length} (${(rate * 100).toFixed(1)}%)`);
    expect(rate).toBeGreaterThanOrEqual(0.97);
  });
});

/** same key order as `actual` so JSON comparison is exact */
function canonical(w: Expect): Expect {
  const e: Expect = { title: w.title };
  if (w.d) e.d = w.d;
  if (w.at) e.at = w.at;
  if (w.dur) e.dur = w.dur;
  if (w.rrule) e.rrule = w.rrule;
  if (w.p) e.p = w.p;
  if (w.tags?.length) e.tags = w.tags;
  if (w.project) e.project = w.project;
  return e;
}
