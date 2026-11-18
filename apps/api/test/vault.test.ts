import { Hlc, type SessionResponse } from '@orvyn/contracts';
import { createVault, decryptItem, encryptItem, unlock } from '@orvyn/vault-crypto';
import { sql } from 'drizzle-orm';
import { v7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../src/db/db.module';
import { call, type Harness, OWNER, signIn, startApp } from './harness';

let h: Harness;
let me: SessionResponse;
let friend: SessionResponse;
let guest: SessionResponse;
const clock = new Hlc('phone');
const PASSPHRASE = 'correct horse battery staple';
const SECRET = 'hunter2-the-bank-password';

const push = (
  s: SessionResponse,
  entity: string,
  id: string,
  fields: Record<string, unknown>,
  op = 'upsert',
) =>
  call<any>(h, 'POST', '/sync/push', {
    token: s.accessToken,
    body: { mutations: [{ mutationId: v7(), entity, entityId: id, op, fields, hlc: clock.tick() }] },
  });
const pull = async (s: SessionResponse) =>
  ((await call<any>(h, 'GET', '/sync/pull?cursor=0', { token: s.accessToken })).body.changes as any[]).filter(
    (c) => c.entity.startsWith('vault.'),
  );
const invite = async (email: string, ent: string[]) => {
  const inv = await call<any>(h, 'POST', '/admin/invites', {
    token: me.accessToken,
    body: { email, entitlements: ent },
  });
  return (await signIn(h, email, { invite: inv.body.link.split('/join/')[1] })).body as SessionResponse;
};

beforeAll(async () => {
  h = await startApp([], { PROCESS_ROLE: 'api' });
  me = (await signIn(h, OWNER)).body;
  friend = await invite('friend@example.test', ['vault']);
  guest = await invite('guest@example.test', ['today']);
});
afterAll(() => h.close());

describe('Vault: the server stores only what it cannot read (spec 0004 AC2, AC3)', () => {
  let keys: Awaited<ReturnType<typeof createVault>>;
  const item = v7();

  it('keys and items go up as ciphertext, come back on another device, and open with the passphrase', async () => {
    keys = await createVault(PASSPHRASE, { ops: 1, memKiB: 256 });
    expect((await push(me, 'vault.keys', me.user.id, { ...keys.keys })).body.rejected).toEqual([]);
    const blob = await encryptItem(keys.vaultKey, item, { kind: 'login', title: 'Bank', password: SECRET });
    expect((await push(me, 'vault.item', item, { blob })).body.rejected).toEqual([]);

    const changes = await pull(me);
    const k = changes.find((c) => c.entity === 'vault.keys').data;
    const i = changes.find((c) => c.entity === 'vault.item').data;
    const vk = await unlock({ pass: k.pass, recovery: k.recovery }, PASSPHRASE);
    expect(await decryptItem(vk, item, i.blob)).toMatchObject({ title: 'Bank', password: SECRET });
  });

  it('the database holds no plaintext: not the passphrase, the title, the password or any field name', async () => {
    const db = h.app.get<Db>(DB);
    const rows = JSON.stringify([
      ...(await db.execute(sql`select * from vault_keys`)),
      ...(await db.execute(sql`select * from vault_items`)),
    ]);
    for (const s of [PASSPHRASE, SECRET, 'Bank', 'password', 'login', 'title']) expect(rows).not.toContain(s);
    // nor in the change log the devices pull from
    expect(JSON.stringify(await pull(me))).not.toContain(SECRET);
  });

  it('only accepts the shapes it should: own id for keys, ciphertext for items, no deleting the keys', async () => {
    expect((await push(me, 'vault.keys', v7(), { ...keys.keys })).body.rejected[0]?.reason).toMatch(
      /your own id/,
    );
    expect(
      (await push(me, 'vault.item', v7(), { blob: JSON.stringify({ title: 'plain' }) })).body.rejected,
    ).toHaveLength(1);
    expect((await push(me, 'vault.keys', me.user.id, {}, 'delete')).body.rejected[0]?.reason).toMatch(
      /cannot be deleted/,
    );
    expect((await pull(me)).some((c) => c.entity === 'vault.keys')).toBe(true);
  });

  it('changing the passphrase replaces the wrap without touching items', async () => {
    const { rewrapPassphrase } = await import('@orvyn/vault-crypto');
    const pass = await rewrapPassphrase(keys.vaultKey, 'a new passphrase', { ops: 1, memKiB: 256 });
    expect((await push(me, 'vault.keys', me.user.id, { pass })).body.rejected).toEqual([]);
    const k = (await pull(me)).filter((c) => c.entity === 'vault.keys').at(-1).data;
    const i = (await pull(me)).find((c) => c.entity === 'vault.item').data;
    const vk = await unlock({ pass: k.pass, recovery: k.recovery }, 'a new passphrase');
    expect(await decryptItem(vk, item, i.blob)).toMatchObject({ title: 'Bank' });
  });

  it('is private to its owner and needs the Vault switched on', async () => {
    expect(await pull(friend)).toHaveLength(0);
    const own = await createVault('friend pass', { ops: 1, memKiB: 256 });
    expect((await push(friend, 'vault.keys', friend.user.id, { ...own.keys })).body.rejected).toEqual([]);
    expect(
      (await pull(me)).filter((c) => c.entity === 'vault.keys').every((c) => c.entityId === me.user.id),
    ).toBe(true);
    expect((await push(guest, 'vault.keys', guest.user.id, { ...own.keys })).body.rejected[0]?.reason).toBe(
      'feature_not_enabled',
    );
    // someone else's item id can't be overwritten
    expect(
      (
        await push(friend, 'vault.item', item, {
          blob: 'v1.AAAAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBB',
        })
      ).body.rejected[0]?.reason,
    ).toBe('not_found');
  });
});
