import { Controller, Get, Module } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notFound } from '../src/common/errors';
import { scrubEvent } from '../src/common/error-reporting';
import { Public } from '../src/modules/auth/auth.decorators';
import { call, type Harness, startApp } from './harness';

@Controller('boom')
class BoomController {
  @Public()
  @Get('crash')
  crash(): never {
    throw new Error('database exploded');
  }

  @Public()
  @Get('missing')
  missing(): never {
    throw notFound('nope', 'Not here');
  }
}

@Module({ controllers: [BoomController] })
class BoomModule {}

describe('error reporting', () => {
  let h: Harness;
  const reported: { error: unknown; route?: string }[] = [];

  beforeAll(async () => {
    h = await startApp([BoomModule], {}, [], undefined, {
      capture: (error, ctx) => reported.push({ error, route: ctx.route }),
    });
  });
  afterAll(() => h.close());

  it('reports unexpected errors with the route template, and answers 500 without leaking details', async () => {
    const r = await call(h, 'GET', '/boom/crash?email=secret@example.test');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('database exploded');
    expect(reported).toHaveLength(1);
    expect((reported[0]!.error as Error).message).toBe('database exploded');
    expect(reported[0]!.route).toBe('/boom/crash'); // template, not the query string
  });

  it('never reports expected 4xx answers', async () => {
    const before = reported.length;
    expect((await call(h, 'GET', '/boom/missing')).status).toBe(404);
    expect((await call(h, 'GET', '/me')).status).toBe(401);
    expect(reported.length).toBe(before);
  });

  it('strips request data, user and breadcrumbs before anything leaves the server', () => {
    const e = scrubEvent({
      type: undefined,
      request: { url: 'https://api/x?token=1', cookies: { a: 'b' }, data: '{"secret":1}' },
      user: { email: 'a@example.test' },
      extra: { body: 'x' },
      breadcrumbs: [{ message: 'typed password' }],
      exception: { values: [{ type: 'Error', value: 'boom' }] },
    });
    expect(e.request).toBeUndefined();
    expect(e.user).toBeUndefined();
    expect(e.extra).toBeUndefined();
    expect(e.breadcrumbs).toBeUndefined();
    expect(e.exception?.values?.[0]?.value).toBe('boom');
  });
});
