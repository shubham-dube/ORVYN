import type { SessionResponse } from '@orvyn/contracts';
import { sql } from 'drizzle-orm';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  b64,
  type DeviceKeys,
  encryptFile,
  encryptMessage,
  newDeviceKeys,
  openKey,
} from '@orvyn/vault-crypto';
import { DB, type Db } from '../src/db/db.module';
import { call, type Harness, openSocket, OWNER, signIn, startApp, waitFor } from './harness';

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
const say = (who: SessionResponse, conv: string, body: Record<string, unknown>) =>
  api(who, 'POST', `/chat/conversations/${conv}/messages`, { id: v7(), ...body });
const page = async (who: SessionResponse, conv: string) =>
  (await api(who, 'GET', `/chat/conversations/${conv}/messages`)).body as any[];
const pings = async (who: SessionResponse) =>
  ((await api(who, 'GET', '/notifications')).body.items as any[]).filter(
    (n) => n.module === 'chat' && !n.dismissedAt,
  );
async function upload(who: SessionResponse, bytes: Uint8Array, type: string, name: string, purpose: string) {
  return fetch(`${h.url}/files`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${who.accessToken}`,
      'content-type': type,
      'x-file-name': name,
      'x-file-purpose': purpose,
    },
    body: Buffer.from(bytes),
  }).then((r) => r.json() as Promise<{ id: string; mime: string }>);
}

/** What an old (ADR-0014) app does: seal a message to every device it knows. */
async function sayOld(who: SessionResponse, conversationId: string, payload: unknown, files: string[] = []) {
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
      .filter((d) => d.active && keys.has(d.deviceId))
      .map((d) => ({ deviceId: d.deviceId, boxPublic: d.boxPublic })),
  });
  const r = await api(who, 'POST', `/chat/conversations/${conversationId}/messages`, {
    id,
    ...sealed,
    files,
  });
  return { id, r };
}

beforeAll(async () => {
  h = await startApp();
  asha = (await signIn(h, OWNER)).body;
  raviPhone = await invite('ravi@example.test', ['chat']);
  raviLaptop = (await signIn(h, 'ravi@example.test', { platform: 'web' })).body;
  dev = await invite('dev@example.test', ['chat']);
  mia = await invite('mia@example.test', ['today']);
  for (const who of [asha, raviPhone]) {
    const k = await newDeviceKeys();
    keys.set(who.deviceId, k);
    await api(who, 'PUT', '/chat/devices', { boxPublic: k.boxPublic, signPublic: k.signPublic });
  }
});
afterAll(() => h.close());

describe('Chat that follows you (spec 0011 A, spec 0015 C)', () => {
  let direct: string;
  let first: string;

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

  it('kept on the server, encrypted at rest: a brand-new device has the whole history (AC3)', async () => {
    const r = await say(asha, direct, { text: 'Dinner at 8? 🍕' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ v: 2, text: 'Dinner at 8? 🍕', senderId: asha.user.id });
    first = r.body.id;
    // the database alone reveals nothing
    const rows = await h.app.get<Db>(DB).execute(sql`select * from chat_messages`);
    expect(JSON.stringify(rows)).not.toContain('Dinner');
    // Ravi signs in on a new phone: everything is there
    const newPhone = (await signIn(h, 'ravi@example.test')).body;
    expect((await page(newPhone, direct)).map((m) => m.text)).toEqual(['Dinner at 8? 🍕']);
    expect((await page(raviLaptop, direct))[0].text).toBe('Dinner at 8? 🍕');
    // the same id again is the same message (a retry), not a second one
    await api(asha, 'POST', `/chat/conversations/${direct}/messages`, { id: first, text: 'Dinner at 8? 🍕' });
    expect(await page(asha, direct)).toHaveLength(1);
    // someone outside gets nothing at all
    expect((await api(dev, 'GET', `/chat/conversations/${direct}/messages`)).status).toBe(404);
    expect((await api(dev, 'PATCH', `/chat/messages/${first}`, { text: 'x' })).status).toBe(404);
  });

  it('live: the message itself arrives on the socket; online and last seen (AC5)', async () => {
    const ravi = await openSocket(h, raviLaptop.accessToken);
    const ashaLive = await openSocket(h, asha.accessToken);
    const conv = (await api(asha, 'GET', `/chat/conversations/${direct}`)).body;
    expect(conv.members.find((m: any) => m.id === raviPhone.user.id)).toMatchObject({ online: true });
    const r = await say(asha, direct, { text: 'Live!' });
    await waitFor(() => ravi.messages.some((m) => m.type === 'chat.message' && m.messageId === r.body.id));
    const got = ravi.messages.find((m) => m.type === 'chat.message' && m.messageId === r.body.id);
    expect(got.message).toMatchObject({ text: 'Live!', senderId: asha.user.id, v: 2 });
    ravi.close();
    await waitFor(() => ashaLive.messages.some((m) => m.type === 'chat.presence' && !m.online));
    expect(ashaLive.messages.find((m) => m.type === 'chat.presence' && !m.online)).toMatchObject({
      userId: raviPhone.user.id,
      lastSeenAt: expect.any(String),
    });
    const after = (await api(asha, 'GET', `/chat/conversations/${direct}`)).body;
    expect(after.members.find((m: any) => m.id === raviPhone.user.id)).toMatchObject({
      online: false,
      lastSeenAt: expect.any(String),
    });
    ashaLive.close();
  });

  it('a push says who wrote and what, with Reply and Mark as read (AC6)', async () => {
    await say(asha, direct, { text: 'Bring the speaker' });
    const [n] = await pings(raviPhone);
    expect(n).toMatchObject({
      title: 'owner',
      body: 'Dinner at 8? 🍕\nLive!\nBring the speaker',
      url: `/chat/${direct}`,
    });
    expect(n.actions.map((a: any) => a.id)).toEqual(['reply', 'read']);
    // Reply typed right in the notification: sent as Ravi, and the chat counts as read
    const r = await api(raviPhone, 'POST', `/notifications/${n.id}/actions/reply`, { text: 'On it 👍' });
    expect(r.status).toBe(200);
    const lines = await page(asha, direct);
    expect(lines[0]).toMatchObject({ senderId: raviPhone.user.id, text: 'On it 👍' });
    expect(await pings(raviPhone)).toHaveLength(0);
    const conv = (await api(raviPhone, 'GET', '/chat/conversations')).body[0];
    expect(conv.unread).toBe(0);
    expect(conv.last).toMatchObject({ text: 'On it 👍', senderId: raviPhone.user.id });
  });

  it('replies quote, reactions are one per person, edits show, delete for everyone and for me (AC5)', async () => {
    const reply = await say(raviPhone, direct, { text: 'Yes!', replyTo: first });
    expect(reply.body.replyTo).toMatchObject({ id: first, text: 'Dinner at 8? 🍕', deleted: false });
    await api(asha, 'PUT', `/chat/messages/${reply.body.id}/reaction`, { emoji: '👍' });
    await api(asha, 'PUT', `/chat/messages/${reply.body.id}/reaction`, { emoji: '❤️' });
    await api(raviPhone, 'PUT', `/chat/messages/${reply.body.id}/reaction`, { emoji: '❤️' });
    let m = (await page(raviLaptop, direct)).find((x) => x.id === reply.body.id);
    expect(m.reactions).toEqual([{ emoji: '❤️', by: [asha.user.id, raviPhone.user.id] }]);
    await api(asha, 'PUT', `/chat/messages/${reply.body.id}/reaction`, { emoji: null });
    m = (await page(raviLaptop, direct)).find((x) => x.id === reply.body.id);
    expect(m.reactions).toEqual([{ emoji: '❤️', by: [raviPhone.user.id] }]);

    expect((await api(raviPhone, 'PATCH', `/chat/messages/${first}`, { text: 'x' })).status).toBe(403);
    const e = await api(asha, 'PATCH', `/chat/messages/${first}`, { text: 'Dinner at 8.30? 🍕' });
    expect(e.body).toMatchObject({ text: 'Dinner at 8.30? 🍕', editedAt: expect.any(String) });

    const oops = await say(asha, direct, { text: 'oops' });
    expect((await api(raviPhone, 'DELETE', `/chat/messages/${oops.body.id}`)).status).toBe(403);
    expect((await api(asha, 'DELETE', `/chat/messages/${oops.body.id}`)).status).toBe(200);
    expect((await page(raviPhone, direct))[0]).toMatchObject({
      id: oops.body.id,
      text: null,
      deletedAt: expect.any(String),
    });
    // delete for me: gone for Ravi only
    await api(raviPhone, 'POST', `/chat/messages/${reply.body.id}/hide`);
    expect((await page(raviLaptop, direct)).some((x) => x.id === reply.body.id)).toBe(false);
    expect((await page(asha, direct)).some((x) => x.id === reply.body.id)).toBe(true);
  });

  it('delivered and read ticks; mute stops pings (AC5, AC6)', async () => {
    const r = await say(asha, direct, { text: 'Ticks?' });
    const before = (await api(asha, 'GET', `/chat/conversations/${direct}`)).body;
    const ravi = () => before.members.find((x: any) => x.id === raviPhone.user.id);
    expect(ravi().lastDeliveredAt < r.body.createdAt).toBe(true);
    await api(raviPhone, 'GET', '/chat/conversations'); // Ravi's app has it
    const got = (await api(asha, 'GET', `/chat/conversations/${direct}`)).body.members.find(
      (x: any) => x.id === raviPhone.user.id,
    );
    expect(got.lastDeliveredAt >= r.body.createdAt).toBe(true);
    expect(got.lastReadAt < r.body.createdAt).toBe(true);
    await api(raviPhone, 'POST', `/chat/conversations/${direct}/read`);
    await api(raviPhone, 'PUT', `/chat/conversations/${direct}/mute`, { muted: true });
    await say(asha, direct, { text: 'quiet now' });
    expect(await pings(raviPhone)).toHaveLength(0);
    await api(raviPhone, 'PUT', `/chat/conversations/${direct}/mute`, { muted: false });
  });

  it('photos are ordinary files for members; forward carries them; pin and search', async () => {
    const up = await upload(asha, new TextEncoder().encode('a photo'), 'image/jpeg', 'goa.jpg', 'chat-file');
    expect(up.mime).toBe('image/jpeg');
    const sent = await say(asha, direct, {
      text: 'Beach',
      attachments: [{ fileId: up.id, name: 'x', mime: 'x', size: 1, w: 800, h: 600 }],
    });
    expect(sent.body.attachments).toEqual([
      { fileId: up.id, name: 'goa.jpg', mime: 'image/jpeg', size: 7, w: 800, h: 600 },
    ]);
    const got = await fetch(`${h.url}/chat/conversations/${direct}/files/${up.id}`, {
      headers: { authorization: `Bearer ${raviLaptop.accessToken}` },
    });
    expect(await got.text()).toBe('a photo');
    expect((await api(dev, 'GET', `/chat/conversations/${direct}/files/${up.id}`)).status).toBe(404);
    // someone else's upload can't be attached
    const devUp = await upload(dev, new TextEncoder().encode('x'), 'image/png', 'd.png', 'chat-file');
    expect(
      (
        await say(asha, direct, {
          attachments: [{ fileId: devUp.id, name: 'd', mime: 'image/png', size: 1 }],
        })
      ).status,
    ).toBe(404);

    // Ravi forwards the photo into a group with Dev: Dev can open it there
    const g = await api(raviPhone, 'POST', '/chat/conversations', {
      kind: 'group',
      memberIds: [dev.user.id],
      title: 'Trip',
    });
    const fw = await say(raviPhone, g.body.id, { forwardOf: sent.body.id });
    expect(fw.body).toMatchObject({ forwarded: true, text: 'Beach', senderId: raviPhone.user.id });
    const viaGroup = await fetch(`${h.url}/chat/conversations/${g.body.id}/files/${up.id}`, {
      headers: { authorization: `Bearer ${dev.accessToken}` },
    });
    expect(await viaGroup.text()).toBe('a photo');
    // Dev can't forward from a chat they're not in
    expect((await say(dev, g.body.id, { forwardOf: first })).status).toBe(404);

    const pinned = await api(raviPhone, 'PUT', `/chat/conversations/${direct}/pin`, {
      messageId: sent.body.id,
    });
    expect(pinned.body.pinnedMessage).toMatchObject({
      id: sent.body.id,
      text: 'Beach',
      attachment: '📷 Photo',
    });
    expect((await page(asha, direct))[0].text).toBe('ravi pinned a message');

    const found = (await api(asha, 'GET', `/chat/conversations/${direct}/search?q=dinner`)).body as any[];
    expect(found.map((x) => x.id)).toEqual([first]);

    await api(asha, 'PUT', `/chat/conversations/${g.body.id}/pinned`, { pinned: true }).then((r) =>
      expect(r.status).toBe(404),
    );
    await api(raviPhone, 'PUT', `/chat/conversations/${g.body.id}/pinned`, { pinned: true });
    const list = (await api(raviPhone, 'GET', '/chat/conversations')).body as any[];
    expect(list[0]).toMatchObject({ id: g.body.id, pinned: true });
  });

  it('old end-to-end messages are carried over only with a key that opens them (AC4)', async () => {
    const { id, r } = await sayOld(asha, direct, { t: 'text', text: 'From the old app', replyTo: first });
    expect(r.status).toBe(201);
    const photo = await encryptFile(new TextEncoder().encode('old photo'));
    const up = await upload(asha, photo.bytes, 'application/octet-stream', 'encrypted.bin', 'chat');
    const old = await sayOld(
      asha,
      direct,
      {
        t: 'file',
        fileId: up.id,
        key: photo.key,
        nonce: photo.nonce,
        name: 'old.png',
        mime: 'image/png',
        size: 9,
      },
      [up.id],
    );
    // Ravi's laptop never had keys: it sees a sealed message it can't read
    const laptopView = (await page(raviLaptop, direct)).find((m) => m.id === id);
    expect(laptopView).toMatchObject({ v: 1, text: null, sealedForMe: null });

    // a wrong key changes nothing
    const bad = await api(raviPhone, 'POST', `/chat/conversations/${direct}/carry`, {
      items: [{ id, key: b64(new Uint8Array(32)) }],
    });
    expect(bad.body).toEqual({ carried: 0, refused: 1 });

    // Ravi's phone can unseal both: it hands the keys over
    const mine = await page(raviPhone, direct);
    const items = [];
    for (const m of mine.filter((x) => x.v === 1))
      items.push({
        id: m.id,
        key: b64(await openKey(m.sealedForMe, keys.get(raviPhone.deviceId)!.boxSecret)),
      });
    expect(items).toHaveLength(2);
    const ok = await api(raviPhone, 'POST', `/chat/conversations/${direct}/carry`, { items });
    expect(ok.body).toEqual({ carried: 2, refused: 0 });

    const now = await page(raviLaptop, direct);
    expect(now.find((m) => m.id === id)).toMatchObject({
      v: 2,
      text: 'From the old app',
      replyTo: { id: first },
      ciphertext: null,
    });
    const file = now.find((m) => m.id === old.id);
    expect(file.attachments[0]).toMatchObject({ name: 'old.png', mime: 'image/png' });
    const bytes = await fetch(`${h.url}/chat/conversations/${direct}/files/${file.attachments[0].fileId}`, {
      headers: { authorization: `Bearer ${raviLaptop.accessToken}` },
    }).then((x) => x.text());
    expect(bytes).toBe('old photo');
    const keysLeft = (await h.app
      .get<Db>(DB)
      .execute(sql`select count(*)::int as n from chat_keys where message_id = ${id}`)) as unknown as {
      n: number;
    }[];
    expect(keysLeft[0]!.n).toBe(0);
  });

  it('groups: admin adds, renames and removes; removed people lose access', async () => {
    const g = await api(asha, 'POST', '/chat/conversations', {
      kind: 'group',
      memberIds: [raviPhone.user.id, dev.user.id],
      title: 'Goa',
    });
    expect(g.body).toMatchObject({ kind: 'group', title: 'Goa', adminId: asha.user.id });
    await say(dev, g.body.id, { text: 'Booked!' });
    expect((await page(raviPhone, g.body.id)).map((m) => [m.kind, m.text])).toEqual([
      ['msg', 'Booked!'],
      ['system', 'owner made the group “Goa”'],
    ]);
    const [n] = (await pings(raviPhone)).filter((x) => x.url === `/chat/${g.body.id}`);
    expect(n).toMatchObject({ title: 'Goa', body: 'dev: Booked!' });
    expect((await api(dev, 'PUT', `/chat/conversations/${g.body.id}/title`, { title: 'x' })).status).toBe(
      403,
    );
    await api(asha, 'DELETE', `/chat/conversations/${g.body.id}/members/${dev.user.id}`);
    expect((await api(dev, 'GET', `/chat/conversations/${g.body.id}/messages`)).status).toBe(404);
  });
});
