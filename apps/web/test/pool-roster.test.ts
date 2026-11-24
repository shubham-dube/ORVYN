import { describe, expect, it } from 'vitest';
import { nextActions, preview, trackRecord } from '../lib/pool-roster';

describe('the Pool roster (spec 0018)', () => {
  it('offers the next step from where each person is', () => {
    expect(nextActions(null, true).map((a) => a.label)).toEqual(['Add']);
    expect(nextActions('to_ask', true).map((a) => a.label)).toEqual([
      'Ask on WhatsApp',
      'Will apply',
      'Can’t',
    ]);
    // no phone: no WhatsApp, and Will apply leads
    expect(nextActions('to_ask', false)).toEqual([
      { label: 'Will apply', status: 'planned', primary: true },
      { label: 'Can’t', status: 'declined' },
    ]);
    expect(nextActions('funded', true)[0]).toMatchObject({ label: 'Applied', status: 'applied' });
    expect(nextActions('applied', true)[1]).toMatchObject({ message: 'mandate' });
    expect(nextActions('missed', true)[0]).toMatchObject({ status: 'planned' });
  });

  it('previews a template and words a track record', () => {
    expect(
      preview('Hi {name}, {ipo} by {closes}. {missedLast}', {
        name: 'Ravi',
        ipo: 'Mega',
        closes: '5 pm',
        missedLast: '',
      }),
    ).toBe('Hi Ravi, Mega by 5 pm.');
    expect(preview('{unknown} stays', {})).toBe('{unknown} stays');
    expect(trackRecord({ applied: 0, of: 0, missed: 0 })).toBe('new to the Pool');
    expect(trackRecord({ applied: 7, of: 9, missed: 2 })).toBe('applied 7 of 9 · missed 2');
  });
});
