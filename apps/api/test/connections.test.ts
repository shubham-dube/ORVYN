import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SessionResponse } from '@orvyn/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../src/db/db.module';
import { CalendarService } from '../src/modules/calendar/calendar.service';
import { FakeGoogleCalendar } from './fake-google-calendar';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

/** Just enough of ClickUp's v2 API: a user per token, a workspace, tasks, list statuses. */
class FakeClickUp {
  server!: Server;
  url = '';
  done: { id: string; status: string }[] = [];
  async start() {
    this.server = createServer(async (req, res) => {
      let raw = '';
      for await (const c of req) raw += c;
      const send = (s: number, b: unknown) => {
        res.writeHead(s, { 'content-type': 'application/json' });
        res.end(JSON.stringify(b));
      };
      const token = req.headers.authorization;
      if (token !== 'pk_good_token_1' && token !== 'pk_good_token_2')
        return send(401, { err: 'Token invalid' });
      const who = token.endsWith('1')
        ? { id: 11, email: 'asha@work.test' }
        : { id: 22, email: 'asha@side.test' };
      const u = new URL(req.url!, this.url);
      if (u.pathname === '/user') return send(200, { user: { ...who, username: 'Asha' } });
      if (u.pathname === '/team') return send(200, { teams: [{ id: `t${who.id}`, name: `WS ${who.id}` }] });
      if (u.pathname === `/team/t${who.id}/task`) {
        expect(u.searchParams.get('assignees[]')).toBe(String(who.id));
        return send(200, {
          tasks: [
            {
              id: `cu${who.id}`,
              name: who.id === 11 ? 'Review the Q4 deck' : 'Fix the landing copy',
              url: `https://app.clickup.com/t/cu${who.id}`,
              status: { status: 'in progress', type: 'custom' },
              due_date: who.id === 11 ? String(Date.UTC(2030, 0, 7, 6)) : null,
              priority: { priority: 'high' },
              list: { id: 'l1', name: 'Sprint' },
            },
          ],
        });
      }
      if (u.pathname === '/task/cu11' && req.method === 'GET')
        return send(200, {
          id: 'cu11',
          list: { id: 'l1' },
          status: { status: 'in progress', type: 'custom' },
        });
      if (u.pathname === '/list/l1')
        return send(200, {
          statuses: [
            { status: 'to do', type: 'open' },
            { status: 'shipped', type: 'closed' },
          ],
        });
      if (u.pathname === '/task/cu11' && req.method === 'PUT') {
        this.done.push({ id: 'cu11', status: (JSON.parse(raw) as { status: string }).status });
        return send(200, {});
      }
      return send(404, {});
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  close() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
}

const g = new FakeGoogleCalendar();
const cu = new FakeClickUp();
let h: Harness;
let me: SessionResponse;
let cal: CalendarService;

async function connectGoogle(email: string, gmail = false) {
  const r = await call<any>(h, 'POST', `/calendar/google/start${gmail ? '?gmail=1' : ''}`, {
    token: me.accessToken,
  });
  const auth = new URL(r.body.url);
  if (gmail) expect(auth.searchParams.get('scope')).toContain('gmail.readonly');
  else expect(auth.searchParams.get('scope')).not.toContain('gmail');
  await fetch(
    `${h.url}/calendar/google/callback?code=code-${email}&state=${auth.searchParams.get('state')}`,
    {
      redirect: 'manual',
    },
  );
  await cal.drain();
}

beforeAll(async () => {
  await g.start();
  await cu.start();
  g.addAccount('asha@gmail.test', [
    { id: 'asha@gmail.test', summary: 'Asha', primary: true, accessRole: 'owner' },
  ]);
  g.addAccount('asha@work.test', [
    { id: 'asha@work.test', summary: 'Work', primary: true, accessRole: 'owner' },
  ]);
  g.mail.set('asha@gmail.test', [
    {
      id: 'm1',
      threadId: 't1',
      from: 'Bank <alerts@bank.test>',
      subject: 'Statement ready',
      snippet: 'Your statement…',
    },
  ]);
  h = await startApp([], { ...g.env(), CLICKUP_API: cu.url });
  cal = h.app.get(CalendarService);
  me = (await signIn(h, OWNER)).body;
});
afterAll(async () => {
  await h.close();
  await g.close();
  await cu.close();
});

describe('connections hub (spec 0007 C2)', () => {
  it('lists every provider and what each gives; Google needs the server set up, ClickUp only a token', async () => {
    const p = (await call<any>(h, 'GET', '/connections/providers', { token: me.accessToken })).body as any[];
    expect(p.find((x) => x.id === 'google')).toMatchObject({ how: 'oauth', available: true });
    expect(p.find((x) => x.id === 'clickup')).toMatchObject({ how: 'token', available: true });
    expect(p.some((x) => x.how === 'soon')).toBe(true);
  });

  it('several Google accounts; Gmail is added to one of them only, read-only', async () => {
    await connectGoogle('asha@work.test');
    g.gmail.add('asha@gmail.test');
    await connectGoogle('asha@gmail.test', true);
    const list = (await call<any>(h, 'GET', '/connections', { token: me.accessToken })).body as any[];
    expect(list.find((c) => c.account === 'asha@work.test').capabilities).toEqual(['calendar', 'meet']);
    const personal = list.find((c) => c.account === 'asha@gmail.test');
    expect(personal.capabilities).toEqual(['calendar', 'meet', 'gmail']);

    const inbox = await call<any>(h, 'GET', `/calendar/accounts/${personal.id}/inbox`, {
      token: me.accessToken,
    });
    expect(inbox.body).toMatchObject({
      unread: 1,
      items: [
        { from: 'Bank <alerts@bank.test>', subject: 'Statement ready', url: expect.stringContaining('t1') },
      ],
    });
    const work = list.find((c) => c.account === 'asha@work.test');
    expect(
      (await call(h, 'GET', `/calendar/accounts/${work.id}/inbox`, { token: me.accessToken })).status,
    ).toBe(404);
    // tokens never come back to the client
    expect(JSON.stringify(list)).not.toMatch(/rt-|at-|pk_/);
  });

  it('schedules a meeting with a Meet link; Google is asked to email the invitations', async () => {
    const work = ((await call<any>(h, 'GET', '/connections', { token: me.accessToken })).body as any[]).find(
      (c) => c.account === 'asha@work.test',
    );
    const r = await call<any>(h, 'POST', '/calendar/meetings', {
      token: me.accessToken,
      body: {
        accountId: work.id,
        title: 'Design review',
        start: '2030-01-08T15:00:00+05:30',
        end: '2030-01-08T15:30:00+05:30',
        attendees: ['raj@example.test', 'RAJ@example.test', 'mia@example.test'],
        notes: 'Bring the mockups',
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.meetUrl).toMatch(/^https:\/\/meet\.google\.com\//);
    expect(r.body.account).toBe('asha@work.test');
    const sent = g.requests.findLast((x) => x.method === 'POST' && x.path.endsWith('/events'))!;
    expect(sent.query).toMatchObject({ conferenceDataVersion: '1', sendUpdates: 'all' });
    expect((sent.body as any).attendees).toEqual([
      { email: 'raj@example.test' },
      { email: 'mia@example.test' },
    ]);
    expect((sent.body as any).conferenceData.createRequest.conferenceSolutionKey).toEqual({
      type: 'hangoutsMeet',
    });

    const bad = await call(h, 'POST', '/calendar/meetings', {
      token: me.accessToken,
      body: {
        accountId: work.id,
        title: 'x',
        start: '2030-01-08T15:00:00+05:30',
        end: '2030-01-08T14:00:00+05:30',
      },
    });
    expect(bad.status).toBe(400);
  });

  it('ClickUp: several accounts by token, open tasks across them, done from ORVYN', async () => {
    expect(
      (
        await call(h, 'POST', '/connections/clickup', {
          token: me.accessToken,
          body: { token: 'pk_wrong_token' },
        })
      ).status,
    ).toBe(400);
    const a = await call<any>(h, 'POST', '/connections/clickup', {
      token: me.accessToken,
      body: { token: 'pk_good_token_1' },
    });
    expect(a.body).toMatchObject({ account: 'asha@work.test', workspaces: 1 });
    await call(h, 'POST', '/connections/clickup', {
      token: me.accessToken,
      body: { token: 'pk_good_token_2' },
    });
    // the same account again updates it, never a duplicate
    await call(h, 'POST', '/connections/clickup', {
      token: me.accessToken,
      body: { token: 'pk_good_token_1' },
    });
    const rows = await h.app.get<Db>(DB).execute(sql`select secret_enc from connections`);
    expect(rows.length ?? (rows as any).rows.length).toBe(2);
    expect(JSON.stringify(rows)).not.toContain('pk_good');

    const tasks = (await call<any>(h, 'GET', '/connections/clickup/tasks', { token: me.accessToken }))
      .body as any[];
    expect(tasks.map((t) => t.name)).toEqual(['Review the Q4 deck', 'Fix the landing copy']);
    expect(tasks[0]).toMatchObject({ workspace: 'WS 11', list: 'Sprint', due: '2030-01-07T06:00:00.000Z' });

    const ok = await call(h, 'POST', `/connections/clickup/tasks/cu11/complete`, {
      token: me.accessToken,
      body: { connectionId: tasks[0].connectionId },
    });
    expect(ok.status).toBe(200);
    expect(cu.done).toEqual([{ id: 'cu11', status: 'shipped' }]);

    expect(
      (await call(h, 'DELETE', `/connections/${tasks[1].connectionId}`, { token: me.accessToken })).status,
    ).toBe(200);
    const left = (await call<any>(h, 'GET', '/connections', { token: me.accessToken })).body as any[];
    expect(left.filter((c) => c.provider === 'clickup')).toHaveLength(1);
  });

  it('someone else’s connection is never reachable', async () => {
    const inv = await call<any>(h, 'POST', '/admin/invites', {
      token: me.accessToken,
      body: { email: 'friend@example.test', entitlements: ['today'] },
    });
    const friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] }))
      .body;
    const mine = (await call<any>(h, 'GET', '/connections', { token: me.accessToken })).body as any[];
    expect((await call<any>(h, 'GET', '/connections', { token: friend.accessToken })).body).toEqual([]);
    const cuConn = mine.find((c) => c.provider === 'clickup');
    expect((await call(h, 'DELETE', `/connections/${cuConn.id}`, { token: friend.accessToken })).status).toBe(
      404,
    );
    const google = mine.find((c) => c.provider === 'google');
    expect(
      (
        await call(h, 'POST', '/calendar/meetings', {
          token: friend.accessToken,
          body: {
            accountId: google.id,
            title: 'x',
            start: '2030-01-08T15:00:00+05:30',
            end: '2030-01-08T16:00:00+05:30',
          },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(h, 'GET', `/calendar/accounts/${google.id}/inbox`, { token: friend.accessToken })).status,
    ).toBe(404);
  });
});
