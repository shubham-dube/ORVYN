import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SessionResponse } from '@orvyn/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GoogleHttpError, googleProblem } from '../src/modules/calendar/google.client';
import { ClickUpHub, defaultWorking } from '../src/modules/connections/clickup.hub';
import { ConnectionsService } from '../src/modules/connections/connections.service';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

type Req = { method: string; path: string; body: any; auth: string | undefined; q: URLSearchParams };

async function fakeServer(route: (r: Req) => [number, unknown]) {
  const reqs: Req[] = [];
  const server: Server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const u = new URL(req.url!, 'http://x');
    const r: Req = {
      method: req.method!,
      path: u.pathname,
      body: raw ? JSON.parse(raw) : null,
      auth: req.headers.authorization,
      q: u.searchParams,
    };
    reqs.push(r);
    const [s, b] = route(r);
    res.writeHead(s, { 'content-type': 'application/json' });
    res.end(JSON.stringify(b));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    reqs,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// ------------------------------------------------------------------ a ClickUp workspace with real-life statuses
const S = {
  todo: { status: 'to do', type: 'open', color: '#d3d3d3', orderindex: 0 },
  design: { status: 'design', type: 'custom', color: '#a875ff', orderindex: 1 },
  dev: { status: 'in development', type: 'custom', color: '#1090e0', orderindex: 2 },
  fixed: { status: 'fixed', type: 'custom', color: '#f9d900', orderindex: 3 },
  prod: { status: 'prod deployed', type: 'custom', color: '#2ecd6f', orderindex: 4 },
  closed: { status: 'closed', type: 'closed', color: '#6bc950', orderindex: 5 },
};
const task = (id: string, name: string, status: (typeof S)[keyof typeof S]) => ({
  id,
  name,
  url: `https://app.clickup.com/t/${id}`,
  status,
  due_date: null,
  priority: null,
  list: { id: 'l1', name: 'Sprint 12' },
  folder: { id: 'f1', name: 'Web', hidden: false },
  time_spent: 5_400_000,
});
const cuTasks = [
  task('a1', 'Login page', S.design),
  task('a2', 'Checkout API', S.dev),
  task('a3', 'Footer spacing', S.fixed),
  task('a4', 'Search', S.prod),
  task('a5', 'Pricing copy', S.todo),
];
const comments = [
  { id: 'c1', comment_text: 'Use the new tokens', user: { id: 99, username: 'Ravi' }, date: '1893456000000' },
];
let running: unknown = null;
let cu: Awaited<ReturnType<typeof fakeServer>>;

// ------------------------------------------------------------------ GitHub: my pull requests
const pr = (n: number, title: string, extra: Record<string, unknown> = {}) => ({
  id: n,
  number: n,
  title,
  html_url: `https://github.com/asha/app/pull/${n}`,
  state: 'open',
  updated_at: `2030-01-0${n % 9}T10:00:00Z`,
  created_at: '2030-01-01T10:00:00Z',
  repository_url: 'https://api.github.com/repos/asha/app',
  pull_request: { merged_at: null as string | null },
  draft: false,
  comments: 2,
  ...extra,
});
let openPrs = [pr(50, 'Dark mode'), pr(51, 'Fix nav', { draft: true })];
let closedPrs = [
  pr(41, 'Old thing', { state: 'closed', pull_request: { merged_at: '2030-01-02T10:00:00Z' } }),
];
let reviews: Record<number, { user: { login: string }; state: string }[]> = {
  50: [
    { user: { login: 'ravi' }, state: 'CHANGES_REQUESTED' },
    { user: { login: 'ravi' }, state: 'APPROVED' },
  ],
  51: [],
};
let gh: Awaited<ReturnType<typeof fakeServer>>;

let h: Harness;
let me: SessionResponse;
let friend: SessionResponse;
let cuConn: string;
let ghConn: string;
const as = (who: SessionResponse) => ({
  get: async (path: string) => (await call<any>(h, 'GET', path, { token: who.accessToken })).body,
  req: (method: string, path: string, body?: unknown) =>
    call<any>(h, method, path, { token: who.accessToken, body }),
});
const pings = async () =>
  ((await as(me).get('/notifications')).items as any[])
    .filter((n) => n.kind === 'connection')
    .map((n) => n.title);

beforeAll(async () => {
  cu = await fakeServer((r) => {
    if (r.auth !== 'pk_hub_token_1') return [401, { err: 'Token invalid' }];
    if (r.path === '/user') return [200, { user: { id: 11, email: 'asha@work.test', username: 'Asha' } }];
    if (r.path === '/team') return [200, { teams: [{ id: '901', name: 'Work' }] }];
    if (r.path === '/team/901/task')
      return [
        200,
        {
          tasks:
            r.q.get('include_closed') === 'true'
              ? [{ ...task('z9', 'Shipped thing', S.closed), date_closed: '1893456000000' }]
              : cuTasks,
        },
      ];
    if (r.path === '/list/l1') return [200, { statuses: Object.values(S).reverse() }];
    if (r.method === 'GET' && r.path === '/task/a1')
      return [
        200,
        {
          ...cuTasks[0],
          team_id: '901',
          markdown_description: '**Mobile first**',
          assignees: [{ id: 11, username: 'Asha', initials: 'A' }],
          subtasks: [task('a1s', 'Hero image', S.closed)],
        },
      ];
    if (r.method === 'PUT' && r.path === '/task/a1') return [200, {}];
    if (r.method === 'GET' && r.path === '/task/a1/comment') return [200, { comments }];
    if (r.method === 'POST' && r.path === '/task/a1/comment') return [200, { id: 77, date: Date.now() }];
    if (r.method === 'GET' && r.path === '/team/901/time_entries')
      return [
        200,
        {
          data: [
            {
              id: 't1',
              start: '1893456000000',
              end: '1893459600000',
              duration: '3600000',
              description: 'kickoff',
            },
          ],
        },
      ];
    if (r.method === 'POST' && r.path === '/team/901/time_entries')
      return [200, { data: { id: 't2', start: String(r.body.start), duration: String(r.body.duration) } }];
    if (r.method === 'DELETE' && r.path === '/team/901/time_entries/t2') return [200, { data: [] }];
    if (r.path === '/team/901/time_entries/current') return [200, { data: running }];
    if (r.path === '/team/901/time_entries/start') {
      running = {
        id: 'run1',
        task: { id: r.body.tid, name: 'Login page' },
        start: String(Date.now()),
        duration: '-1',
      };
      return [200, { data: running }];
    }
    if (r.path === '/team/901/time_entries/stop') {
      const was = running as { id: string; start: string };
      running = null;
      return [200, { data: { ...was, duration: '1500000' } }];
    }
    return [404, {}];
  });
  gh = await fakeServer((r) => {
    if (r.auth !== 'Bearer ghp_hub_token_abcdefghijk') return [401, { message: 'Bad credentials' }];
    if (r.path === '/user') return [200, { id: 78, login: 'asha', name: 'Asha' }];
    if (r.path === '/search/issues') {
      const q = r.q.get('q')!;
      if (q.includes('is:pr is:open author:@me')) return [200, { items: openPrs }];
      if (q.includes('is:pr is:closed author:@me')) return [200, { items: closedPrs }];
      return [200, { items: [] }];
    }
    const m = /^\/repos\/asha\/app\/pulls\/(\d+)(\/reviews)?$/.exec(r.path);
    if (m && m[2]) return [200, reviews[+m[1]!] ?? []];
    if (m) return [200, { head: { sha: `sha${m[1]}` } }];
    if (r.path === '/repos/asha/app/commits/sha50/status') return [200, { state: 'success', total_count: 1 }];
    if (r.path === '/repos/asha/app/commits/sha50/check-runs')
      return [200, { check_runs: [{ status: 'completed', conclusion: 'failure' }] }];
    if (r.path.endsWith('/status')) return [200, { state: 'pending', total_count: 0 }];
    if (r.path.endsWith('/check-runs')) return [200, { check_runs: [] }];
    return [404, {}];
  });
  h = await startApp([], { CLICKUP_API: cu.url, GITHUB_API: gh.url });
  me = (await signIn(h, OWNER)).body;
  const inv = await as(me).req('POST', '/admin/invites', {
    email: 'friend@example.test',
    entitlements: ['today'],
  });
  friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] })).body;
  cuConn = (await as(me).req('POST', '/connections/clickup', { token: 'pk_hub_token_1' })).body.id;
  ghConn = (await as(me).req('POST', '/connections/github', { token: 'ghp_hub_token_abcdefghijk' })).body.id;
});
afterAll(async () => {
  await h.close();
  await cu.close();
  await gh.close();
});

describe('ClickUp without opening ClickUp (spec 0012 B)', () => {
  it('the default rule: design and development show in Today; to do, fixed, deployed and closed do not', () => {
    expect(defaultWorking('design', 'custom')).toBe(true);
    expect(defaultWorking('in development', 'custom')).toBe(true);
    expect(defaultWorking('to do', 'open')).toBe(false);
    expect(defaultWorking('fixed', 'custom')).toBe(false);
    expect(defaultWorking('prod deployed', 'custom')).toBe(false);
    expect(defaultWorking('in review', 'custom')).toBe(false);
    expect(defaultWorking('complete', 'closed')).toBe(false);
    // as named in real workspaces: capitals, and whatever type the list gives them
    expect(defaultWorking('DEVELOPMENT', 'custom')).toBe(true);
    expect(defaultWorking('DESIGN', 'open')).toBe(true);
    expect(defaultWorking('IN PROGRESS', 'open')).toBe(true);
    expect(defaultWorking('TO DO', 'open')).toBe(false);
    expect(defaultWorking('PROD DEPLOYED', 'custom')).toBe(false);
    expect(defaultWorking('DEV DONE', 'custom')).toBe(false);
  });

  it('every open task comes with its status colour and whether it is a working one', async () => {
    const tasks = (await as(me).get('/connections/clickup/tasks')) as any[];
    expect(tasks.filter((t) => t.working).map((t) => t.name)).toEqual(['Login page', 'Checkout API']);
    expect(tasks.find((t) => t.id === 'a1')).toMatchObject({
      status: 'design',
      statusColor: '#a875ff',
      teamId: '901',
      folder: 'Web',
      list: 'Sprint 12',
      trackedMin: 90,
    });
    const closed = (await as(me).get('/connections/clickup/tasks?closed=1')) as any[];
    expect(closed.map((t) => [t.name, t.statusType])).toEqual([['Shipped thing', 'closed']]);
  });

  it('a quick cache: the second look does not ask ClickUp again', async () => {
    const before = cu.reqs.filter((r) => r.path === '/team/901/task').length;
    await as(me).get('/connections/clickup/tasks');
    expect(cu.reqs.filter((r) => r.path === '/team/901/task').length).toBe(before);
  });

  it('"Show in Today" lists every status in order and changes what counts as working', async () => {
    const st = (await as(me).get('/connections/clickup/statuses')) as any[];
    expect(st[0].statuses.map((s: any) => [s.name, s.working])).toEqual([
      ['to do', false],
      ['design', true],
      ['in development', true],
      ['fixed', false],
      ['prod deployed', false],
      ['closed', false],
    ]);
    expect(
      (
        await as(me).req('PUT', '/connections/clickup/settings', {
          connectionId: cuConn,
          workingStatuses: ['To Do', 'design'],
        })
      ).status,
    ).toBe(200);
    let tasks = (await as(me).get('/connections/clickup/tasks')) as any[];
    expect(
      tasks
        .filter((t) => t.working)
        .map((t) => t.name)
        .sort(),
    ).toEqual(['Login page', 'Pricing copy']);
    await as(me).req('PUT', '/connections/clickup/settings', { connectionId: cuConn, workingStatuses: null });
    tasks = (await as(me).get('/connections/clickup/tasks')) as any[];
    expect(tasks.filter((t) => t.working).map((t) => t.name)).toEqual(['Login page', 'Checkout API']);
  });

  it('the task sheet: task, statuses in order, subtasks, comments and my time in one call', async () => {
    const d = await as(me).get(`/connections/clickup/tasks/a1?connectionId=${cuConn}`);
    expect(d.task).toMatchObject({ name: 'Login page', description: '**Mobile first**', status: 'design' });
    expect(d.task.subtasks).toEqual([
      { id: 'a1s', name: 'Hero image', status: 'closed', statusColor: '#6bc950', done: true },
    ]);
    expect(d.statuses.map((s: any) => s.name)).toEqual([
      'to do',
      'design',
      'in development',
      'fixed',
      'prod deployed',
      'closed',
    ]);
    expect(d.comments).toEqual([
      expect.objectContaining({
        id: 'c1',
        text: 'Use the new tokens',
        mine: false,
        by: expect.objectContaining({ name: 'Ravi', initials: 'R' }),
      }),
    ]);
    expect(d.time).toEqual([
      expect.objectContaining({ id: 't1', minutes: 60, note: 'kickoff', running: false }),
    ]);
  });

  it('change status and priority, comment', async () => {
    expect(
      (
        await as(me).req('PATCH', '/connections/clickup/tasks/a1', {
          connectionId: cuConn,
          status: 'in development',
          priority: 2,
        })
      ).status,
    ).toBe(200);
    expect(cu.reqs.findLast((r) => r.method === 'PUT')!.body).toEqual({
      status: 'in development',
      priority: 2,
    });
    expect(
      (await as(me).req('PATCH', '/connections/clickup/tasks/a1', { connectionId: cuConn })).status,
    ).toBe(400);

    const c = await as(me).req('POST', '/connections/clickup/tasks/a1/comments', {
      connectionId: cuConn,
      text: 'Done on mobile',
    });
    expect(c.status).toBe(201);
    expect(cu.reqs.findLast((r) => r.method === 'POST' && r.path.endsWith('/comment'))!.body).toEqual({
      comment_text: 'Done on mobile',
      notify_all: false,
    });
  });

  it('add time by duration or range (a start and the minutes), never in the future; delete it', async () => {
    const start = '2026-01-01T10:00:00+05:30';
    const fut = new Date(Date.now() + 3_600_000).toISOString();
    expect(
      (
        await as(me).req('POST', '/connections/clickup/tasks/a1/time', {
          connectionId: cuConn,
          start: fut,
          durationMin: 30,
        })
      ).status,
    ).toBe(400);
    const r = await as(me).req('POST', '/connections/clickup/tasks/a1/time', {
      connectionId: cuConn,
      teamId: '901',
      start,
      durationMin: 90,
      note: 'pairing',
    });
    expect(r.status).toBe(201);
    expect(cu.reqs.findLast((x) => x.path === '/team/901/time_entries' && x.method === 'POST')!.body).toEqual(
      {
        tid: 'a1',
        start: Date.parse(start),
        duration: 90 * 60_000,
        description: 'pairing',
      },
    );
    expect(r.body).toMatchObject({ id: 't2', minutes: 90 });
    expect(
      (await as(me).req('DELETE', `/connections/clickup/time/t2?connectionId=${cuConn}&teamId=901`)).status,
    ).toBe(200);
  });

  it('the timer: start, see it running (also when started in ClickUp), stop', async () => {
    expect((await as(me).get('/connections/clickup/timer')).timer).toBeNull();
    const s = await as(me).req('POST', '/connections/clickup/timer/start', {
      connectionId: cuConn,
      taskId: 'a1',
    });
    expect(s.body.timer).toMatchObject({ taskId: 'a1', teamId: '901', entryId: 'run1' });
    expect((await as(me).get('/connections/clickup/timer')).timer).toMatchObject({
      taskId: 'a1',
      taskName: 'Login page',
    });
    const stop = await as(me).req('POST', '/connections/clickup/timer/stop', { connectionId: cuConn });
    expect(stop.body).toMatchObject({ minutes: 25, running: false });
    expect((await as(me).get('/connections/clickup/timer')).timer).toBeNull();
  });

  it('none of it is reachable by someone else (rule 5)', async () => {
    const f = as(friend);
    expect(await f.get('/connections/clickup/tasks')).toEqual([]);
    expect((await f.get('/connections/clickup/timer')).timer).toBeNull();
    for (const [m, p, b] of [
      ['GET', `/connections/clickup/tasks/a1?connectionId=${cuConn}`, undefined],
      ['PATCH', '/connections/clickup/tasks/a1', { connectionId: cuConn, status: 'fixed' }],
      ['POST', '/connections/clickup/tasks/a1/comments', { connectionId: cuConn, text: 'hi' }],
      [
        'POST',
        '/connections/clickup/tasks/a1/time',
        { connectionId: cuConn, start: '2026-01-01T10:00:00Z', durationMin: 5 },
      ],
      ['DELETE', `/connections/clickup/time/t1?connectionId=${cuConn}`, undefined],
      ['POST', '/connections/clickup/timer/start', { connectionId: cuConn, taskId: 'a1' }],
      ['POST', '/connections/clickup/timer/stop', { connectionId: cuConn }],
      ['PUT', '/connections/clickup/settings', { connectionId: cuConn, workingStatuses: [] }],
      ['PUT', '/connections/github/settings', { connectionId: ghConn, pings: { approved: true } }],
    ] as const)
      expect((await f.req(m, p, b)).status, `${m} ${p}`).toBe(404);
    expect(await f.get('/connections/github/prs')).toEqual([]);
    expect(h.app.get(ClickUpHub)).toBeDefined();
  });
});

describe('my pull requests (spec 0012 G)', () => {
  it('open ones with review and checks; merged and closed ones of the last 30 days', async () => {
    const prs = (await as(me).get('/connections/github/prs')) as any[];
    const by = Object.fromEntries(prs.map((p) => [p.number, p]));
    expect(by[50]).toMatchObject({
      state: 'open',
      review: 'approved',
      checks: 'failing',
      repo: 'asha/app',
      draft: false,
    });
    expect(by[51]).toMatchObject({ state: 'open', review: 'pending', checks: 'none', draft: true });
    expect(by[41]).toMatchObject({ state: 'merged', review: null, closedAt: '2030-01-02T10:00:00Z' });
  });

  it('a merge pings once; changes requested pings; approved stays quiet unless switched on', async () => {
    const svc = h.app.get(ConnectionsService);
    await svc.watch(me.user.id); // the first look only remembers
    const before = (await pings()).length;

    reviews = { ...reviews, 51: [{ user: { login: 'ravi' }, state: 'CHANGES_REQUESTED' }] };
    closedPrs = [
      ...closedPrs,
      { ...openPrs[0]!, state: 'closed', pull_request: { merged_at: '2030-01-09T10:00:00Z' } },
    ];
    openPrs = [openPrs[1]!];
    await svc.watch(me.user.id);
    const now = await pings();
    expect(now.slice(0, now.length - before).sort()).toEqual([
      'Changes requested: Fix nav',
      'PR merged: Dark mode',
    ]);
    await svc.watch(me.user.id);
    expect((await pings()).length).toBe(now.length);

    // approvals: off by default, on when asked
    reviews = { ...reviews, 51: [{ user: { login: 'ravi' }, state: 'APPROVED' }] };
    await svc.watch(me.user.id);
    expect((await pings()).length).toBe(now.length);
    await as(me).req('PUT', '/connections/github/settings', {
      connectionId: ghConn,
      pings: { approved: true },
    });
    reviews = { ...reviews, 51: [{ user: { login: 'ravi' }, state: 'CHANGES_REQUESTED' }] };
    await svc.watch(me.user.id);
    reviews = { ...reviews, 51: [{ user: { login: 'mira' }, state: 'APPROVED' }] };
    await svc.watch(me.user.id);
    expect(await pings()).toContain('PR approved: Fix nav');
  });
});

describe('a Gmail error says what to do (spec 0012 X)', () => {
  it.each([
    ['accessNotConfigured', 403, /switched off .* Enable it/],
    ['insufficientPermissions', 403, /permission is missing/],
    ['rateLimitExceeded', 429, /busy/],
    [null, 503, /having trouble/],
  ] as const)('%s', (reason, status, want) => {
    const m = googleProblem(
      new GoogleHttpError(status, `GET /gmail/v1/users/me/messages: ${status}`, reason),
    );
    expect(m).toMatch(want);
    expect(m).not.toMatch(/GET|gmail\/v1/);
  });
});
