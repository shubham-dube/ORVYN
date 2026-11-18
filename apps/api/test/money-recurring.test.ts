import { Hlc, type SessionResponse } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecurringService } from '../src/modules/money/recurring.service';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let me: SessionResponse;
let svc: RecurringService;
const clock = new Hlc('phone');
// 18 Nov 2026, 10:00 in India
const NOW = Date.parse('2026-11-18T10:00:00+05:30');

const push = (id: string, entity: string, fields: Record<string, unknown>) =>
  call<any>(h, 'POST', '/sync/push', {
    token: me.accessToken,
    body: {
      mutations: [{ mutationId: v7(), entity, entityId: id, op: 'upsert', fields, hlc: clock.tick() }],
    },
  });
const changes = async () =>
  (await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: me.accessToken })).body.changes as any[];
const txs = async (key?: string) =>
  (await changes()).filter(
    (c) =>
      c.entity === 'money.transaction' &&
      c.data.source === 'recurring' &&
      (!key || c.data.dedupeKey?.startsWith(key)),
  );
const base = {
  title: 'Gym',
  amountMinor: 150000,
  rrule: 'FREQ=DAILY',
  startDate: '2026-11-15',
  mode: 'add',
};

beforeAll(async () => {
  h = await startApp([], { PROCESS_ROLE: 'api' });
  svc = h.app.get(RecurringService);
  svc.now = () => NOW;
  me = (await signIn(h, OWNER)).body;
});
afterAll(() => h.close());

describe('Scheduled money (spec 0006)', () => {
  it('adds each day that came due, once, marked new — and never again on a rerun', async () => {
    const id = v7();
    expect((await push(id, 'money.recurring', base)).body.rejected).toEqual([]);
    await svc.run();
    await svc.run();
    const rows = await txs(`rec:${id}:`);
    expect(rows.map((r) => r.data.dedupeKey).sort()).toEqual(
      ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'].map((d) => `rec:${id}:${d}`),
    );
    expect(rows[0].data).toMatchObject({ amountMinor: 150000, reviewed: false, direction: 'debit' });
    // 09:00 India on the day
    expect(rows.find((r) => r.data.dedupeKey.endsWith('2026-11-16')).data.occurredAt).toBe(
      '2026-11-16T03:30:00.000Z',
    );
    const sched = (await changes()).filter((c) => c.entityId === id).at(-1);
    expect(sched.data.lastRunOn).toBe('2026-11-18');
  });

  it('a paused schedule adds nothing, and resuming picks up from where it stopped', async () => {
    const id = v7();
    await push(id, 'money.recurring', { ...base, title: 'Paused one', paused: true });
    await svc.run();
    expect(await txs(`rec:${id}:`)).toHaveLength(0);
    await push(id, 'money.recurring', { paused: false });
    await svc.run();
    expect(await txs(`rec:${id}:`)).toHaveLength(4);
  });

  it('stops at its end date', async () => {
    const id = v7();
    await push(id, 'money.recurring', { ...base, title: 'Ends', endDate: '2026-11-16' });
    await svc.run();
    expect((await txs(`rec:${id}:`)).map((r) => r.data.dedupeKey.slice(-10)).sort()).toEqual([
      '2026-11-15',
      '2026-11-16',
    ]);
  });

  it('a reminder-only schedule adds no transaction', async () => {
    const id = v7();
    await push(id, 'money.recurring', {
      ...base,
      title: 'Rent',
      mode: 'remind',
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=18',
      startDate: '2026-11-01',
    });
    await svc.run();
    expect(await txs(`rec:${id}:`)).toHaveLength(0);
    const n = (await call<any>(h, 'GET', '/notifications', { token: me.accessToken })).body;
    expect(JSON.stringify(n)).toContain('Rent');
  });

  it('a device cannot write the server’s bookkeeping, or a rule that is not a repeat', async () => {
    const id = v7();
    expect(
      (await push(id, 'money.recurring', { ...base, lastRunOn: '2026-11-01' })).body.rejected[0]?.reason,
    ).toMatch(/server/);
    expect(
      (await push(v7(), 'money.recurring', { ...base, rrule: 'FREQ=HOURLY' })).body.rejected[0]?.reason,
    ).toMatch(/repeat/);
  });
});
