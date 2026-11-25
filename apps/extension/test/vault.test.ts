import { createVault, decryptItem, encryptItem, type VaultKeys } from '@orvyn/vault-crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Vault } from '../src/vault';

const PASS = 'correct horse battery staple';
const KDF = { ops: 1, memKiB: 8 * 1024 };
let clock = 1_000_000;
let session: Map<string, unknown>;
let items: { id: string; blob: string }[];
let keys: VaultKeys;
let vaultKey: Uint8Array;
let vault: Vault;
const make = () =>
  new Vault({
    box: async () => ({ keys, items: [...items] }),
    save: async (id, blob) => {
      items = [...items.filter((i) => i.id !== id), { id, blob }];
    },
    session: {
      get: async (k) => session.get(k),
      set: async (k, v) => void session.set(k, v),
      remove: async (k) => void session.delete(k),
    },
    autoLockMin: async () => 5,
    now: () => clock,
  });
const login = (url: string, username: string, password: string, totp = '') => ({
  kind: 'login',
  title: url,
  fields: { url, username, password, totp },
  notes: 'keep me',
  updatedAt: '',
});

beforeEach(async () => {
  session = new Map();
  const v = await createVault(PASS, KDF);
  keys = v.keys;
  vaultKey = v.vaultKey;
  items = [
    { id: 'gh', blob: await encryptItem(vaultKey, 'gh', login('https://github.com', 'me', 'pw-github')) },
    {
      id: 'bk',
      blob: await encryptItem(
        vaultKey,
        'bk',
        login('https://bank.test', 'me', 'pw-bank', 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'),
      ),
    },
  ];
  vault = make();
});

describe('the Vault in the extension (AC5)', () => {
  it('locked: no logins, no password; a wrong passphrase opens nothing', async () => {
    expect(await vault.view('https://github.com/')).toMatchObject({ state: 'locked', logins: [] });
    await expect(vault.forPage('gh', 'https://github.com/')).rejects.toThrow('locked');
    await expect(vault.unlock('wrong')).rejects.toThrow();
    expect(session.size).toBe(0);
  });

  it('open: the page’s own login comes first; it fills only there', async () => {
    await vault.unlock(PASS);
    const v = await vault.view('https://github.com/login');
    expect(v.logins.map((l) => [l.id, l.fits])).toEqual([
      ['gh', true],
      ['bk', false],
    ]);
    expect(JSON.stringify(v)).not.toContain('pw-');
    expect((await vault.forPage('gh', 'https://gist.github.com/x')).password).toBe('pw-github');
    for (const bad of ['http://github.com/', 'https://github.com.evil.test/', 'https://bank.test/'])
      await expect(vault.forPage('gh', bad)).rejects.toThrow('another site');
  });

  it('survives a sleeping worker, but not the auto-lock time', async () => {
    await vault.unlock(PASS);
    vault = make(); // the service worker woke up again
    expect((await vault.view(null)).state).toBe('open');
    clock += 5 * 60_000 + 1;
    await vault.expire();
    expect(session.has('vault')).toBe(false);
    expect((await vault.view(null)).state).toBe('locked');
  });

  it('gives one-time codes', async () => {
    await vault.unlock(PASS);
    expect((await vault.code('bk')).code).toMatch(/^\d{6}$/);
    await expect(vault.code('gh')).rejects.toThrow();
  });
});

describe('saving a sign-in (AC6)', () => {
  it('asks for a new one, saves it encrypted, and forgets the pending copy', async () => {
    expect(await vault.seen('https://new.test/join', 'me@x.test', 'S3cret-new')).toBe(true);
    expect(JSON.stringify(await vault.view(null))).not.toContain('S3cret-new');
    await expect(vault.savePending()).rejects.toThrow('locked');
    await vault.unlock(PASS);
    expect(await vault.savePending()).toBe('Saved in the Vault');
    const added = items.find((i) => !['gh', 'bk'].includes(i.id))!;
    expect(added.blob).not.toContain('S3cret');
    expect(await decryptItem(vaultKey, added.id, added.blob)).toMatchObject({
      title: 'new.test',
      fields: { username: 'me@x.test', password: 'S3cret-new', url: 'https://new.test' },
    });
    expect(session.has('pendingLogin')).toBe(false);
  });

  it('updates the one it has (keeping the rest) and stays quiet about one it knows', async () => {
    await vault.unlock(PASS);
    expect(await vault.seen('https://github.com/session', 'me', 'pw-github')).toBe(false);
    expect(await vault.seen('https://github.com/settings', '', 'changed-1')).toBe(true);
    expect((await vault.view(null)).pending?.updates).toBe('gh');
    expect(await vault.savePending()).toBe('Password updated in the Vault');
    expect(items).toHaveLength(2);
    expect(await decryptItem(vaultKey, 'gh', items.find((i) => i.id === 'gh')!.blob)).toMatchObject({
      notes: 'keep me',
      fields: { username: 'me', password: 'changed-1' },
    });
  });

  it('never from http; gone after five minutes', async () => {
    expect(await vault.seen('http://plain.test/', 'a', 'password')).toBe(false);
    await vault.seen('https://x.test/', 'a', 'password');
    clock += 5 * 60_000 + 1;
    await vault.expire();
    expect(session.has('pendingLogin')).toBe(false);
  });
});
