import type { SessionResponse } from '@orvyn/contracts';
import { sql } from 'drizzle-orm';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decryptFile,
  decryptMessage,
  type DeviceKeys,
  encryptFile,
  encryptMessage,
  newDeviceKeys,
} from '@orvyn/vault-crypto';
import { DB, type Db } from '../src/db/db.module';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let asha: SessionResponse;
let raviPhone: SessionResponse;
let raviLaptop: SessionResponse;
let dev: SessionResponse;
let mia: SessionResponse;
const keys = new Map<string, DeviceKeys>();
const api = <T = any>(who: SessionResponse, method: string, path: string, body?: unknown) =>
  call<T>(h, method, path, { token: who.accessToken, body });

async function invite(email: string, entitlements: string[]) {
  const inv = await api(asha, 'POST', '/admin/invites', { email, entitlements });
  return (await signIn(h, email, { invite: inv.body.link.split('/join/')[1] })).body;
}
async function setUp(who: SessionResponse) {
  const k = await newDeviceKeys();
  keys.set(who.deviceId, k);
  expect(
    (await api(who, 'PUT', '/chat/devices', { boxPublic: k.boxPublic, signPublic: k.signPublic })).status,
  ).toBe(200);
}
/** What a real client does: fetch every member device's key, encrypt, send. */
async function say(who: SessionResponse, conversationId: string, payload: unknown, files: string[] = []) {
  const conv = (await api(who, 'GET', `/chat/conversations/${conversationId}`)).body;
  const devices = (
    await api(who, 'GET', `/chat/keys?userIds=${conv.members.map((m: any) => m.id).join(',')}`)
  ).body as any[];
  const id = v7();
  const sealed = await encryptMessage(payload, {
    conversationId,
    messageId: id,
    deviceId: who.deviceId,
    signSecret: keys.get(who.deviceId)!.signSecret,
    recipients: devices
      .filter((d) => d.active)
      .map((d) => ({ deviceId: d.deviceId, boxPublic: d.boxPublic })),
  });
  const r = await api(who, 'POST', `/chat/conversations/${conversationId}/messages`, {
    id,
    ...sealed,
    files,
  });
  return { id, r };
}
async function read(who: SessionResponse, conversationId: string) {
  const page = (await api(who, 'GET', `/chat/conversations/${conversationId}/messages`)).body as any[];
  const signers = new Map(
    (
      (await api(who, 'GET', `/chat/keys?userIds=${[...new Set(page.map((m) => m.senderId))].join(',')}`))
        .body as any[]
    ).map((d) => [d.deviceId, d.signPublic]),
  );
  const out: any[] = [];
  for (const m of page) {
    if (m.kind === 'system') out.push({ system: m.text });
    else if (m.deletedAt) out.push({ deleted: true });
    else
      out.push(
        await decryptMessage(
          m,
          m.sealedForMe,
          keys.get(who.deviceId)!.boxSecret,
          signers.get(m.senderDeviceId)!,
        ),
      );
  }
  return out;
}

beforeAll(async () => {
  h = await startApp();
  asha = (await signIn(h, OWNER)).body;
  raviPhone = await invite('ravi@example.test', ['chat']);
  raviLaptop = (await signIn(h, 'ravi@example.test', { platform: 'web' })).body;
  dev = await invite('dev@example.test', ['chat']);
  mia = await invite('mia@example.test', ['today']);
  for (const who of [asha, raviPhone, raviLaptop, dev]) await setUp(who);
});
afterAll(() => h.close());

describe('Chat (spec 0011 A)', () => {
  let direct: string;

  it('one direct chat per pair; only people with Chat', async () => {
    const a = await api(asha, 'POST', '/chat/conversations', {
      kind: 'direct',
      memberIds: [raviPhone.user.id],
    });
    const b = await api(raviPhone, 'POST', '/chat/conversations', {
      kind: 'direct',
      memberIds: [asha.user.id],
    });
    expect(a.body.id).toBe(b.body.id);
    direct = a.body.id;
    expect(a.body.title).toBe('ravi');
    const people = (await api(asha, 'GET', '/chat/people')).body.map((p: any) => p.email).sort();
    expect(people).toEqual(['dev@example.test', 'ravi@example.test']);
    expect(
      (await api(asha, 'POST', '/chat/conversations', { kind: 'direct', memberIds: [mia.user.id] })).status,
    ).toBe(400);
    expect((await api(mia, 'GET', '/chat/conversations')).status).toBe(403);
  });

  it('encrypted for every device; the server keeps only ciphertext (AC1)', async () => {
    const { r } = await say(asha, direct, { t: 'text', text: 'Dinner at 8? 🍕' });
    expect(r.status).toBe(201);
    const rows = await h.app.get<Db>(DB).execute(sql`select * from chat_messages`);
    expect(JSON.stringify(rows)).not.toContain('Dinner');
    expect(await read(raviPhone, direct)).toEqual([{ t: 'text', text: 'Dinner at 8? 🍕' }]);
    expect(await read(raviLaptop, direct)).toEqual([{ t: 'text', text: 'Dinner at 8? 🍕' }]);
    // someone outside gets nothing at all
    expect((await api(dev, 'GET', `/chat/conversations/${direct}/messages`)).status).toBe(404);
  });

  it('a key for a device outside the conversation is refused', async () => {
    const id = v7();
    const sealed = await encryptMessage(
      { t: 'text', text: 'x' },
      {
        conversationId: direct,
        messageId: id,
        deviceId: asha.deviceId,
        signSecret: keys.get(asha.deviceId)!.signSecret,
        recipients: [{ deviceId: dev.deviceId, boxPublic: keys.get(dev.deviceId)!.boxPublic }],
      },
    );
    expect(
      (await api(asha, 'POST', `/chat/conversations/${direct}/messages`, { id, ...sealed })).status,
    ).toBe(400);
  });

  it('replies, reactions and edits ride inside the ciphertext; pings carry no content (AC3, AC6)', async () => {
    const first = (await api(raviPhone, 'GET', `/chat/conversations/${direct}/messages`)).body[0].id;
    await say(raviPhone, direct, { t: 'text', text: 'Yes!', replyTo: first });
    await say(asha, direct, { t: 'react', target: first, emoji: '👍' });
    await say(asha, direct, { t: 'edit', target: first, text: 'Dinner at 8.30? 🍕' });
    const seen = await read(asha, direct);
    expect(seen.map((m) => m.t)).toEqual(['edit', 'react', 'text', 'text']);
    const pings = ((await api(raviPhone, 'GET', '/notifications')).body.items as any[]).filter(
      (n) => n.module === 'chat',
    );
    expect(pings).toHaveLength(1); // one live notification per conversation
    expect(pings[0]).toMatchObject({ title: 'owner', body: 'New message', url: `/chat/${direct}` });
    expect(JSON.stringify(pings)).not.toMatch(/Dinner|Yes!/);
  });

  it('unread counts, read receipts and mute', async () => {
    const before = (await api(raviPhone, 'GET', '/chat/conversations')).body[0];
    expect(before.unread).toBe(3);
    await api(raviPhone, 'POST', `/chat/conversations/${direct}/read`);
    const after = (await api(asha, 'GET', `/chat/conversations/${direct}`)).body;
    expect(after.members.find((m: any) => m.id === raviPhone.user.id).lastReadAt).toBeTruthy();
    expect((await api(raviPhone, 'GET', '/chat/conversations')).body[0].unread).toBe(0);
    await api(raviPhone, 'PUT', `/chat/conversations/${direct}/mute`, { muted: true });
    expect((await api(raviPhone, 'GET', `/chat/conversations/${direct}`)).body.muted).toBe(true);
  });

  it('delete for everyone removes the ciphertext; only your own', async () => {
    const { id } = await say(asha, direct, { t: 'text', text: 'oops' });
    expect((await api(raviPhone, 'DELETE', `/chat/messages/${id}`)).status).toBe(403);
    expect((await api(asha, 'DELETE', `/chat/messages/${id}`)).status).toBe(200);
    const m = (await api(raviPhone, 'GET', `/chat/conversations/${direct}/messages`)).body[0];
    expect(m).toMatchObject({ id, ciphertext: null, sealedForMe: null });
    expect(m.deletedAt).toBeTruthy();
  });

  it('encrypted files: uploaded as opaque bytes, readable by members only', async () => {
    const f = await encryptFile(new TextEncoder().encode('a photo'));
    const up = await fetch(`${h.url}/files`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${asha.accessToken}`,
        'content-type': 'image/jpeg',
        'x-file-name': 'x.bin',
        'x-file-purpose': 'chat',
      },
      body: Buffer.from(f.bytes),
    }).then((r) => r.json() as Promise<{ id: string; mime: string }>);
    expect(up.mime).toBe('application/octet-stream');
    await say(
      asha,
      direct,
      {
        t: 'file',
        fileId: up.id,
        key: f.key,
        nonce: f.nonce,
        name: 'photo.jpg',
        mime: 'image/jpeg',
        size: 7,
      },
      [up.id],
    );
    const got = await fetch(`${h.url}/chat/conversations/${direct}/files/${up.id}`, {
      headers: { authorization: `Bearer ${raviLaptop.accessToken}` },
    });
    const bytes = new Uint8Array(await got.arrayBuffer());
    expect(new TextDecoder().decode(await decryptFile(bytes, f.key, f.nonce))).toBe('a photo');
    expect((await api(dev, 'GET', `/chat/conversations/${direct}/files/${up.id}`)).status).toBe(404);
  });

  it('groups: admin adds, renames and removes; system lines are marked; removed people lose access', async () => {
    const g = await api(asha, 'POST', '/chat/conversations', {
      kind: 'group',
      memberIds: [raviPhone.user.id, dev.user.id],
      title: 'Goa',
    });
    expect(g.body).toMatchObject({ kind: 'group', title: 'Goa', adminId: asha.user.id });
    await say(dev, g.body.id, { t: 'text', text: 'Booked!' });
    expect(await read(raviPhone, g.body.id)).toEqual([
      { t: 'text', text: 'Booked!' },
      { system: 'owner made the group “Goa”' },
    ]);
    expect((await api(dev, 'PUT', `/chat/conversations/${g.body.id}/title`, { title: 'x' })).status).toBe(
      403,
    );
    await api(asha, 'DELETE', `/chat/conversations/${g.body.id}/members/${dev.user.id}`);
    expect((await api(dev, 'GET', `/chat/conversations/${g.body.id}/messages`)).status).toBe(404);
    // what is sent now isn't sealed for Dev's device any more
    const { id } = await say(asha, g.body.id, { t: 'text', text: 'after' });
    const sealedTo = (await h.app
      .get<Db>(DB)
      .execute(sql`select device_id from chat_keys where message_id = ${id}`)) as unknown as {
      device_id: string;
    }[];
    expect(sealedTo.map((r) => r.device_id)).not.toContain(dev.deviceId);
  });
});
