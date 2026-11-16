import { describe, expect, it } from 'vitest';
import { logSerializers, safePath } from '../src/common/log-serializers';

describe('request logs', () => {
  it('mask invite tokens and drop query strings', () => {
    expect(safePath('/invites/abcDEF123secret')).toBe('/invites/:token');
    expect(safePath('/dev/mailbox?email=a@example.test')).toBe('/dev/mailbox');
    expect(safePath('/auth/email/start')).toBe('/auth/email/start');
  });

  it('keep only method, path and status', () => {
    const line = logSerializers.req({
      id: 'r1',
      method: 'POST',
      url: '/invites/tok?x=1',
      headers: { authorization: 'Bearer secret', cookie: 'orvyn_rt=secret' },
    } as never);
    expect(line).toEqual({ id: 'r1', method: 'POST', path: '/invites/:token' });
    expect(JSON.stringify(line)).not.toContain('secret');
    expect(logSerializers.res({ statusCode: 201, headers: { 'set-cookie': 'x' } } as never)).toEqual({
      statusCode: 201,
    });
  });
});
