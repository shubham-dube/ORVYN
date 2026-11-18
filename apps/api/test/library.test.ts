import { Hlc, type SessionResponse } from '@orvyn/contracts';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LibraryService } from '../src/modules/library/library.service';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let me: SessionResponse;
let friend: SessionResponse;
let lib: LibraryService;
const clock = new Hlc('phone');

const push = (s: SessionResponse, id: string, fields: Record<string, unknown>) =>
  call<any>(h, 'POST', '/sync/push', {
    token: s.accessToken,
    body: {
      mutations: [
        { mutationId: v7(), entity: 'library.doc', entityId: id, op: 'upsert', fields, hlc: clock.tick() },
      ],
    },
  });
const docs = async (s: SessionResponse) =>
  ((await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: s.accessToken })).body.changes as any[]).filter(
    (c) => c.entity === 'library.doc',
  );
const latest = async (s: SessionResponse, id: string) =>
  (await docs(s)).filter((c) => c.entityId === id).at(-1)?.data;
const upload = async (s: SessionResponse, name: string, body: string, type = 'text/plain') => {
  const r = await fetch(`${h.url}/files`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${s.accessToken}`,
      'content-type': type,
      'x-file-name': name,
      'x-file-purpose': 'library',
    },
    body,
  });
  return (await r.json()) as { id: string };
};
const inbox = async (s: SessionResponse) =>
  ((await call<any>(h, 'GET', '/notifications', { token: s.accessToken })).body.items as any[]).filter(
    (n) => n.module === 'library',
  );

beforeAll(async () => {
  h = await startApp([], { PROCESS_ROLE: 'api' });
  lib = h.app.get(LibraryService);
  me = (await signIn(h, OWNER)).body;
  const inv = await call<any>(h, 'POST', '/admin/invites', {
    token: me.accessToken,
    body: { email: 'friend@example.test', entitlements: ['library'] },
  });
  friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] })).body;
});
afterAll(() => h.close());

describe('Library: the AI reads what you keep (spec 0004 AC1)', () => {
  it('a note gets a title, category, tags and a summary — and a document gets its expiry date and amount', async () => {
    const note = v7();
    expect(
      (
        await push(me, note, {
          kind: 'note',
          text: 'My PAN card number is on the back of my wallet card',
          status: 'new',
        })
      ).body.rejected,
    ).toEqual([]);
    const file = v7();
    const f = await upload(
      me,
      'health-policy.txt',
      'Star Health insurance policy\nPolicy valid till 2026-12-10\nPremium due ₹18,500 by 2026-12-05',
    );
    await push(me, file, {
      kind: 'file',
      fileId: f.id,
      fileName: 'health-policy.txt',
      mime: 'text/plain',
      size: 90,
      status: 'new',
    });
    await lib.drain();
    expect(await latest(me, note)).toMatchObject({ status: 'ready', category: 'Identity' });
    expect((await latest(me, note)).title).toBeTruthy();
    expect((await latest(me, note)).tags).toContain('identity');
    expect(await latest(me, file)).toMatchObject({
      status: 'ready',
      category: 'Insurance',
      expiresOn: '2026-12-10',
      moneyState: 'suggested',
      amounts: [{ label: 'Amount due', amountMinor: 1_850_000, currency: 'INR' }],
      keyDates: [{ label: 'Expires', date: '2026-12-10' }],
    });
  });

  it('what the person typed is kept: a title they chose, and tags are added to, not replaced', async () => {
    const id = v7();
    await push(me, id, {
      kind: 'note',
      title: 'Rent agreement 2026',
      tags: ['flat'],
      text: 'Rent agreement for the flat, valid till 2027-03-31',
      status: 'new',
    });
    await lib.drain();
    const d = await latest(me, id);
    expect(d.title).toBe('Rent agreement 2026');
    expect(d.tags).toContain('flat');
    expect(d.tags).toContain('property');
    expect(d.expiresOn).toBe('2027-03-31');
  });

  it('is owner-scoped: nobody else sees it, and another person’s file can’t be attached', async () => {
    const mine = (await docs(me)).length;
    expect(mine).toBeGreaterThan(0);
    expect(await docs(friend)).toHaveLength(0);
    const theirs = await upload(me, 'secret.txt', 'owner only');
    const r = await push(friend, v7(), { kind: 'file', fileId: theirs.id, status: 'new' });
    expect(r.body.rejected[0]?.reason).toBe('unknown file');
    expect((await push(friend, v7(), { kind: 'note', text: 'hello', status: 'new' })).body.rejected).toEqual(
      [],
    );
    expect(await docs(me)).toHaveLength(mine);
  });

  it('a device can ask for a read but cannot claim the server’s states or write a problem', async () => {
    const id = v7();
    expect(
      (await push(me, id, { kind: 'note', text: 'x', status: 'reading' })).body.rejected[0]?.reason,
    ).toMatch(/status/);
    expect(
      (await push(me, id, { kind: 'note', text: 'x', problem: 'nope' })).body.rejected[0]?.reason,
    ).toMatch(/server/);
  });
});

describe('Library: expiry reminders fire (AC1)', () => {
  const doc = v7();
  beforeAll(async () => {
    await push(me, doc, {
      kind: 'note',
      title: 'Car insurance',
      text: 'x',
      expiresOn: '2026-12-10',
      status: 'ready',
    });
  });

  it('say nothing in the night, then remind 7 days before, once', async () => {
    lib.now = () => Date.parse('2026-12-03T03:00:00+05:30');
    expect(await lib.remindExpiries(me.user.id)).toBe(0);
    lib.now = () => Date.parse('2026-12-03T10:00:00+05:30');
    expect(await lib.remindExpiries(me.user.id)).toBeGreaterThan(0);
    const seven = () => inbox(me).then((l) => l.filter((x) => x.title === 'Car insurance expires in 7 days'));
    expect(await seven()).toHaveLength(1);
    expect((await seven())[0].url).toBe('/library');
    await lib.remindExpiries(me.user.id);
    expect(await seven()).toHaveLength(1);
  });

  it('remind again the day before and on the day, each once; a switched-off document is left alone', async () => {
    lib.now = () => Date.parse('2026-12-09T10:00:00+05:30');
    await lib.remindExpiries(me.user.id);
    lib.now = () => Date.parse('2026-12-10T10:00:00+05:30');
    await lib.remindExpiries(me.user.id);
    const titles = (await inbox(me)).map((x) => x.title).filter((t) => t.includes('Car insurance'));
    expect(titles).toEqual(
      expect.arrayContaining(['Car insurance expires tomorrow', 'Car insurance expires today']),
    );
    await push(me, doc, { remind: false });
    lib.now = () => Date.parse('2026-12-10T12:00:00+05:30');
    const before = (await inbox(me)).length;
    await lib.remindExpiries(me.user.id);
    expect((await inbox(me)).length).toBe(before);
    // and the friend never gets mine
    expect((await inbox(friend)).filter((x) => x.title.includes('Car insurance'))).toHaveLength(0);
    lib.now = Date.now;
  });
});
