import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normaliseMime } from '../src/modules/files/files.service';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let me: any;
let friend: any;

const upload = (token: string, name: string, type: string | null, body: Buffer, purpose = 'library') =>
  fetch(`${h.url}/files`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      ...(type ? { 'content-type': type } : {}),
      'x-file-name': encodeURIComponent(name),
      'x-file-purpose': purpose,
    },
    body,
  });

beforeAll(async () => {
  h = await startApp([], { PROCESS_ROLE: 'api' });
  me = (await signIn(h, OWNER)).body;
  const inv = await call<any>(h, 'POST', '/admin/invites', {
    token: me.accessToken,
    body: { email: 'friend@example.test', entitlements: ['library'] },
  });
  friend = (await signIn(h, 'friend@example.test', { invite: inv.body.link.split('/join/')[1] })).body;
});
afterAll(() => h.close());

describe('files people actually have (spec 0007 A1)', () => {
  it.each([
    ['voice-note.webm', 'audio/webm;codecs=opus', 'audio/webm'],
    ['song.mp3', 'audio/mpeg', 'audio/mpeg'],
    ['clip.mp4', 'video/mp4', 'video/mp4'],
    ['budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null],
    ['letter.docx', '', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['data.csv', 'text/csv', 'text/csv'],
    ['notes.md', 'application/octet-stream', 'text/markdown'],
    ['photos.zip', 'application/zip', 'application/zip'],
    ['scan.heic', 'image/heic', 'image/heic'],
  ])('%s is kept, and comes back byte for byte', async (name, type, expected) => {
    const bytes = Buffer.from(`${name} — ${'x'.repeat(3000)}`);
    const r = await upload(me.accessToken, name, type || null, bytes);
    expect(r.status).toBe(201);
    const f = (await r.json()) as { id: string; mime: string };
    if (expected) expect(f.mime).toBe(expected);
    const back = await fetch(`${h.url}/files/${f.id}`, {
      headers: { authorization: `Bearer ${me.accessToken}` },
    });
    expect(Buffer.from(await back.arrayBuffer())).toEqual(bytes);
  });

  it('shows media and documents inline, downloads the rest, and never serves active content', async () => {
    const audio = (await (
      await upload(me.accessToken, 'a.webm', 'audio/webm', Buffer.from('aaaa'))
    ).json()) as { id: string };
    const r1 = await fetch(`${h.url}/files/${audio.id}`, {
      headers: { authorization: `Bearer ${me.accessToken}` },
    });
    expect(r1.headers.get('content-disposition')).toMatch(/^inline/);
    expect(r1.headers.get('content-type')).toBe('audio/webm');
    const zip = (await (
      await upload(me.accessToken, 'a.zip', 'application/zip', Buffer.from('PK..'))
    ).json()) as { id: string };
    const r2 = await fetch(`${h.url}/files/${zip.id}`, {
      headers: { authorization: `Bearer ${me.accessToken}` },
    });
    expect(r2.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(r2.headers.get('content-type')).toBe('application/octet-stream');
    expect(r2.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('refuses web pages, scripts and programs, empty files and anything over 25 MB', async () => {
    for (const [name, type] of <[string, string][]>[
      ['page.html', 'text/html'],
      ['x.svg', 'image/svg+xml'],
      ['run.exe', 'application/x-msdownload'],
      ['s.js', 'application/javascript'],
    ]) {
      const r = await upload(me.accessToken, name, type, Buffer.from('<script>alert(1)</script>'));
      expect(r.status, name).toBe(400);
      expect(((await r.json()) as any).error.code).toBe('file_type');
    }
    expect((await upload(me.accessToken, 'e.txt', 'text/plain', Buffer.alloc(0))).status).toBe(400);
    const big = await upload(me.accessToken, 'big.mp4', 'video/mp4', Buffer.alloc(25 * 1024 * 1024 + 10, 1));
    expect([400, 413]).toContain(big.status);
  });

  it('a file is its owner’s alone', async () => {
    const f = (await (
      await upload(me.accessToken, 'mine.txt', 'text/plain', Buffer.from('mine'))
    ).json()) as { id: string };
    const r = await fetch(`${h.url}/files/${f.id}`, {
      headers: { authorization: `Bearer ${friend.accessToken}` },
    });
    expect(r.status).toBe(404);
  });

  it('the owner can check storage works end to end; others cannot ask', async () => {
    const ok = await call<any>(h, 'GET', '/files/health', { token: me.accessToken });
    expect(ok.body).toMatchObject({ store: 'local', ok: true });
    expect((await call<any>(h, 'GET', '/files/health', { token: friend.accessToken })).status).toBe(403);
  });

  it('a type the client leaves out comes from the file name', () => {
    expect(normaliseMime('', 'Report.PDF')).toBe('application/pdf');
    expect(normaliseMime('application/octet-stream', 'voice.m4a')).toBe('audio/mp4');
    expect(normaliseMime('audio/x-m4a', 'x')).toBe('audio/mp4');
    expect(normaliseMime('', 'mystery')).toBe('application/octet-stream');
  });
});
