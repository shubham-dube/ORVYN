import { describe, expect, it } from 'vitest';
import { parseTask, wallIn } from '../src/index';
import { type Expect, NOW, PROJECTS } from './fixtures';

/**
 * Spec 0012 A4: every way of writing a time, range, duration, priority, deadline and notes reads the same.
 * Reference: Monday 16 Nov 2026, 09:30 Asia/Kolkata (same as the 0002 set). Must be 100% exact.
 */
const CASES: [string, Expect][] = [
  // ------------------------------------------------ one time, any spelling
  ['call mom 3pm', { title: 'Call mom', at: '2026-11-16 15:00' }],
  ['call mom 3PM', { title: 'Call mom', at: '2026-11-16 15:00' }],
  ['call mom 3 pm', { title: 'Call mom', at: '2026-11-16 15:00' }],
  ['call mom 3 PM', { title: 'Call mom', at: '2026-11-16 15:00' }],
  ['call mom 3 p.m.', { title: 'Call mom', at: '2026-11-16 15:00' }],
  ['call mom 3 P.M.', { title: 'Call mom', at: '2026-11-16 15:00' }],
  ['call mom 3p', { title: 'Call mom', at: '2026-11-16 15:00' }],
  ['call mom at 3pm', { title: 'Call mom', at: '2026-11-16 15:00' }],
  ['call mom at 3 PM', { title: 'Call mom', at: '2026-11-16 15:00' }],
  ['call mom 3:30pm', { title: 'Call mom', at: '2026-11-16 15:30' }],
  ['call mom 3.30 pm', { title: 'Call mom', at: '2026-11-16 15:30' }],
  ['call mom 3:30 PM', { title: 'Call mom', at: '2026-11-16 15:30' }],
  ['call mom 3am', { title: 'Call mom', at: '2026-11-17 03:00' }],
  ['call mom 3 AM', { title: 'Call mom', at: '2026-11-17 03:00' }],
  ['call mom 3 a.m.', { title: 'Call mom', at: '2026-11-17 03:00' }],
  ['call mom 3a', { title: 'Call mom', at: '2026-11-17 03:00' }],
  ['call mom 11am', { title: 'Call mom', at: '2026-11-16 11:00' }],
  ['call mom 12pm', { title: 'Call mom', at: '2026-11-16 12:00' }],
  ['call mom 12am', { title: 'Call mom', at: '2026-11-17 00:00' }],
  ['call mom 15:00', { title: 'Call mom', at: '2026-11-16 15:00' }],
  ['call mom 21:45', { title: 'Call mom', at: '2026-11-16 21:45' }],
  ['call mom 09:00', { title: 'Call mom', at: '2026-11-17 09:00' }],
  ['call mom tomorrow 3pm', { title: 'Call mom', at: '2026-11-17 15:00' }],
  ['call mom tmr 3 PM', { title: 'Call mom', at: '2026-11-17 15:00' }],
  ['call mom tmrw 3p', { title: 'Call mom', at: '2026-11-17 15:00' }],
  ['call mom kal 3 pm', { title: 'Call mom', at: '2026-11-17 15:00' }],
  ['call mom fri 3pm', { title: 'Call mom', at: '2026-11-20 15:00' }],
  ['call mom friday 10am', { title: 'Call mom', at: '2026-11-20 10:00' }],
  ['Call Mom TOMORROW 3 PM', { title: 'Call Mom', at: '2026-11-17 15:00' }],
  ['3pm call mom', { title: 'Call mom', at: '2026-11-16 15:00' }],

  // ------------------------------------------------ ranges: start + duration
  ['standup 10-10:30am', { title: 'Standup', at: '2026-11-16 10:00', dur: 30 }],
  ['review PR fri 3-4pm', { title: 'Review PR', at: '2026-11-20 15:00', dur: 60 }],
  ['design sync 3pm-4:30pm', { title: 'Design sync', at: '2026-11-16 15:00', dur: 90 }],
  ['deep work 11-1pm', { title: 'Deep work', at: '2026-11-16 11:00', dur: 120 }],
  ['workshop 10:00 to 12:30', { title: 'Workshop', at: '2026-11-16 10:00', dur: 150 }],
  ['gym 6-7am', { title: 'Gym', at: '2026-11-17 06:00', dur: 60 }],
  ['call 2 to 3 pm tomorrow', { title: 'Call', at: '2026-11-17 14:00', dur: 60 }],
  ['client call from 4pm to 5pm', { title: 'Client call', at: '2026-11-16 16:00', dur: 60 }],
  ['scale 3 to 5 servers', { title: 'Scale 3 to 5 servers' }],

  // ------------------------------------------------ durations
  ['write report for 1h', { title: 'Write report', dur: 60 }],
  ['write report 1 hr', { title: 'Write report', dur: 60 }],
  ['write report 1.5h', { title: 'Write report', dur: 90 }],
  ['write report 1h30', { title: 'Write report', dur: 90 }],
  ['write report 1h 30m', { title: 'Write report', dur: 90 }],
  ['write report 2 hrs', { title: 'Write report', dur: 120 }],
  ['write report 90 min', { title: 'Write report', dur: 90 }],
  ['write report 45 minutes', { title: 'Write report', dur: 45 }],
  ['write report for 1.5 hours', { title: 'Write report', dur: 90 }],
  ['write report for 20 mins', { title: 'Write report', dur: 20 }],
  ['write report tmr 4pm 1h', { title: 'Write report', at: '2026-11-17 16:00', dur: 60 }],

  // ------------------------------------------------ priority
  ['fix login !', { title: 'Fix login', p: 1 }],
  ['fix login !!', { title: 'Fix login', p: 2 }],
  ['fix login !!!', { title: 'Fix login', p: 3 }],
  ['fix login p1', { title: 'Fix login', p: 3 }],
  ['fix login p2', { title: 'Fix login', p: 2 }],
  ['fix login p3', { title: 'Fix login', p: 1 }],
  ['fix login !high', { title: 'Fix login', p: 3 }],
  ['fix login !med', { title: 'Fix login', p: 2 }],
  ['fix login !low', { title: 'Fix login', p: 1 }],
  ['urgent fix server', { title: 'Fix server', p: 3 }],
  ['pay bill asap', { title: 'Pay bill', p: 3 }],

  // ------------------------------------------------ deadline
  ['finish report by fri', { title: 'Finish report', dl: '2026-11-20' }],
  ['finish report due fri', { title: 'Finish report', dl: '2026-11-20' }],
  ['finish report deadline 30 nov', { title: 'Finish report', dl: '2026-11-30' }],
  ['finish report due on 25/11', { title: 'Finish report', dl: '2026-11-25' }],
  ['finish report by eom', { title: 'Finish report', dl: '2026-11-30' }],
  ['finish report by next week', { title: 'Finish report', dl: '2026-11-23' }],
  ['finish report by tomorrow', { title: 'Finish report', dl: '2026-11-17' }],
  ['work on report wed by fri', { title: 'Work on report', d: '2026-11-18', dl: '2026-11-20' }],
  ['submit by 5pm', { title: 'Submit', at: '2026-11-16 17:00' }],
  ['submit by tonight', { title: 'Submit', at: '2026-11-16 21:00' }],

  // ------------------------------------------------ notes
  [
    'call mom tmr 6pm // ask about trip',
    { title: 'Call mom', at: '2026-11-17 18:00', notes: 'ask about trip' },
  ],
  ['buy gift -- she likes blue', { title: 'Buy gift', notes: 'she likes blue' }],
  ['buy gift //no wrapping', { title: 'Buy gift', notes: 'no wrapping' }],
  ['read https://example.com/a', { title: 'Read https://example.com/a' }],
  ['fix bug // happens at 3pm only', { title: 'Fix bug', notes: 'happens at 3pm only' }],

  // ------------------------------------------------ dates
  ['dentist 22/11', { title: 'Dentist', d: '2026-11-22' }],
  ['dentist 22 nov', { title: 'Dentist', d: '2026-11-22' }],
  ['dentist nov 22', { title: 'Dentist', d: '2026-11-22' }],
  ['dentist in 3 days', { title: 'Dentist', d: '2026-11-19' }],
  ['dentist this weekend', { title: 'Dentist', d: '2026-11-21' }],
  ['dentist eom', { title: 'Dentist', d: '2026-11-30' }],

  // ------------------------------------------------ the whole thing at once
  [
    'call mom tmr 6pm for 15m !! @home #family by fri // ask about trip',
    {
      title: 'Call mom',
      at: '2026-11-17 18:00',
      dur: 15,
      p: 2,
      tags: ['family'],
      project: 'p-home',
      dl: '2026-11-20',
      notes: 'ask about trip',
    },
  ],
  [
    'review PR fri 3-4pm @work #frontend by next mon',
    {
      title: 'Review PR',
      at: '2026-11-20 15:00',
      dur: 60,
      tags: ['frontend'],
      project: 'p-work',
      dl: '2026-11-23',
    },
  ],
  ['pay rent every 1st !', { title: 'Pay rent', d: '2026-12-01', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', p: 1 }],
];

const opts = { now: new Date(NOW), timeZone: 'Asia/Kolkata', projects: PROJECTS };
const local = (iso: string) => {
  const w = wallIn(new Date(iso), 'Asia/Kolkata');
  const p = (n: number) => String(n).padStart(2, '0');
  return `${w.y}-${p(w.m)}-${p(w.d)} ${p(w.h)}:${p(w.mi)}`;
};
const KEYS = ['title', 'd', 'at', 'dur', 'rrule', 'p', 'tags', 'project', 'dl', 'notes'] as const;
const canon = (e: Expect) =>
  JSON.stringify(
    Object.fromEntries(
      KEYS.flatMap((k) => (e[k] && (!Array.isArray(e[k]) || e[k].length) ? [[k, e[k]]] : [])),
    ),
  );

describe('spec 0012 phrasings', () => {
  it.each(CASES)('%s', (input, want) => {
    const p = parseTask(input, opts);
    const got: Expect = {
      title: p.title,
      d: p.dueDate ?? undefined,
      at: p.dueAt ? local(p.dueAt) : undefined,
      dur: p.durationMin ?? undefined,
      rrule: p.rrule ?? undefined,
      p: p.priority || undefined,
      tags: p.tags,
      project: p.projectId ?? undefined,
      dl: p.deadline ?? undefined,
      notes: p.notes ?? undefined,
    };
    expect(canon(got)).toBe(canon(want));
    for (const s of p.spans) expect(input.slice(s.start, s.end).trim()).toBe(s.text);
  });
});
