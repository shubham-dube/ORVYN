import { NOTIFY_TYPE } from '@orvyn/contracts';
import { describe, expect, it } from 'vitest';
import { groups, ruleOf, summary, toggle } from '../lib/notify-rules';

describe('notification settings (spec 0019)', () => {
  it('lists only the modules I have, Security always, Mail with Today', () => {
    const g = groups((m) => m === 'today');
    expect(g.map((x) => x.name)).toEqual(['Security', 'Today', 'Mail']);
    expect(groups(() => true).map((x) => x.name)).toContain('IPO');
  });

  it('a rule falls back to the default; ways toggle sensibly', () => {
    const t = NOTIFY_TYPE.get('ipo.last_day')!;
    const r = ruleOf(t, {});
    expect(r).toEqual({ on: true, ways: ['push'] });
    expect(toggle(r, 'alarm').ways).toEqual(['push', 'alarm']);
    expect(toggle({ on: true, ways: [] }, 'urgent').ways).toEqual(['push', 'urgent']);
    // urgent and alarm don't stack; push off takes them with it
    expect(toggle({ on: true, ways: ['push', 'urgent'] }, 'alarm').ways).toEqual(['push', 'alarm']);
    expect(toggle({ on: true, ways: ['push', 'alarm', 'email'] }, 'push').ways).toEqual(['email']);
    expect(summary({ on: true, ways: ['push', 'alarm', 'email'] })).toBe('Alarm · Email');
    expect(summary({ on: true, ways: [] })).toBe('In-app only');
    expect(summary({ on: false, ways: ['push'] })).toBe('Off');
  });
});
