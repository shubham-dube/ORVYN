import { Hlc, type SessionResponse } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let me: SessionResponse;
let guest: SessionResponse;
const clock = new Hlc('phone');

const push = (s: SessionResponse, id: string, fields: Record<string, unknown>) =>
  call<any>(h, 'POST', '/sync/push', {
    token: s.accessToken,
    body: {
      mutations: [
        { mutationId: v7(), entity: 'today.filter', entityId: id, op: 'upsert', fields, hlc: clock.tick() },
      ],
    },
  });
const filters = async (s: SessionResponse) =>
  ((await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: s.accessToken })).body.changes as any[]).filter(
    (c) => c.entity === 'today.filter',
  );

beforeAll(async () => {
  h = await startApp([], { PROCESS_ROLE: 'api' });
  me = (await signIn(h, OWNER)).body;
  const inv = await call<any>(h, 'POST', '/admin/invites', {
    token: me.accessToken,
    body: { email: 'guest@example.test', entitlements: ['money'] },
  });
  guest = (await signIn(h, 'guest@example.test', { invite: inv.body.link.split('/join/')[1] })).body;
});
afterAll(() => h.close());

describe('saved task filters', () => {
  it('sync to the person’s devices, are theirs alone, and need Today', async () => {
    const id = v7();
    const r = await push(me, id, { name: 'Urgent work', tag: 'urgent', minPriority: 3, when: 'week' });
    expect(r.body.rejected).toEqual([]);
    expect((await filters(me)).at(-1).data).toMatchObject({
      name: 'Urgent work',
      tag: 'urgent',
      minPriority: 3,
      when: 'week',
      text: '',
    });
    expect(await filters(guest)).toHaveLength(0);
    const denied = await push(guest, v7(), { name: 'Sneaky' });
    expect(denied.body.rejected[0]?.reason).toBeTruthy();
    expect((await push(me, v7(), { name: 'Bad', when: 'someday' })).body.rejected).toHaveLength(1);
  });
});
