import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BadVaultData,
  changePassphrase,
  createVault,
  decryptItem,
  encryptItem,
  formatRecoveryKey,
  fromB64,
  generatePassword,
  parseRecoveryKey,
  resetPassphrase,
  unlock,
  unlockWithRecovery,
  WrongPassphrase,
  WrongRecoveryKey,
} from '../src';

const v = JSON.parse(readFileSync(new URL('../fixtures/vectors.json', import.meta.url), 'utf8'));
const light = { ops: 1, memKiB: 256 };

describe('shared test vectors (the Android app reads the same file)', () => {
  it('opens the passphrase wrap and the recovery wrap to the same vault key', async () => {
    expect(await unlock(v.keys, v.passphrase)).toEqual(fromB64(v.vaultKey));
    expect(await unlockWithRecovery(v.keys, v.recoveryKeyText)).toEqual(fromB64(v.vaultKey));
  });
  it('opens a re-wrapped passphrase, and an item written by the reference', async () => {
    expect(await unlock({ ...v.keys, pass: v.rewrap.pass }, v.rewrap.newPassphrase)).toEqual(
      fromB64(v.vaultKey),
    );
    expect(await decryptItem(fromB64(v.vaultKey), v.item.id, v.item.blob)).toEqual(
      JSON.parse(v.item.plaintext),
    );
  });
  it('the recovery key text round-trips and is forgiving', () => {
    expect(formatRecoveryKey(fromB64(v.recoveryKeyBytes))).toBe(v.recoveryKeyText);
    expect(parseRecoveryKey(v.recoveryKeyText)).toEqual(fromB64(v.recoveryKeyBytes));
    expect(parseRecoveryKey(v.recoveryKeyText.toLowerCase().replaceAll('-', ' '))).toEqual(
      fromB64(v.recoveryKeyBytes),
    );
  });
});

describe('the vault', () => {
  it('sets up, unlocks with the passphrase, refuses a wrong one', async () => {
    const { keys, vaultKey, recoveryKey } = await createVault('my passphrase', light);
    expect(await unlock(keys, 'my passphrase')).toEqual(vaultKey);
    await expect(unlock(keys, 'my passphrasE')).rejects.toBeInstanceOf(WrongPassphrase);
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
    // nothing readable in what the server would store
    expect(keys.pass + keys.recovery).not.toContain('my passphrase');
  });

  it('recovery key restores access and sets a new passphrase; changing it does not touch items', async () => {
    const { keys, vaultKey, recoveryKey } = await createVault('first', light);
    const blob = await encryptItem(vaultKey, 'item-1', { title: 'Card', number: '4111 1111 1111 1111' });
    const reset = await resetPassphrase(keys, recoveryKey, 'second');
    expect(await unlock(reset.keys, 'second')).toEqual(vaultKey);
    await expect(unlock(reset.keys, 'first')).rejects.toBeInstanceOf(WrongPassphrase);
    expect(reset.keys.recovery).toBe(keys.recovery); // the recovery wrap is unchanged
    const changed = await changePassphrase(reset.keys, 'second', 'third');
    expect(await decryptItem(await unlock(changed, 'third'), 'item-1', blob)).toEqual({
      title: 'Card',
      number: '4111 1111 1111 1111',
    });
    await expect(changePassphrase(reset.keys, 'wrong', 'x')).rejects.toBeInstanceOf(WrongPassphrase);
    await expect(
      unlockWithRecovery(keys, 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA'),
    ).rejects.toBeInstanceOf(WrongRecoveryKey);
    await expect(unlockWithRecovery(keys, 'short')).rejects.toBeInstanceOf(WrongRecoveryKey);
  });

  it('an item is bound to its id and to the vault key, and is never the same twice', async () => {
    const { vaultKey } = await createVault('p', light);
    const a = await encryptItem(vaultKey, 'one', { x: 1 });
    expect(await encryptItem(vaultKey, 'one', { x: 1 })).not.toBe(a);
    await expect(decryptItem(vaultKey, 'two', a)).rejects.toBeInstanceOf(BadVaultData);
    const other = (await createVault('q', light)).vaultKey;
    await expect(decryptItem(other, 'one', a)).rejects.toBeInstanceOf(BadVaultData);
    await expect(decryptItem(vaultKey, 'one', a.slice(0, -4) + 'AAAA')).rejects.toBeInstanceOf(BadVaultData);
    expect(a).not.toContain('"x"');
  });

  it('generates strong passwords with every kind of character', () => {
    for (let i = 0; i < 20; i++) {
      const p = generatePassword({ length: 24 });
      expect(p).toHaveLength(24);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).toMatch(/[!@#$%^&*\-_=+?]/);
    }
    expect(generatePassword({ symbols: false })).not.toMatch(/[!@#$%^&*\-_=+?]/);
    expect(new Set(Array.from({ length: 50 }, () => generatePassword())).size).toBe(50);
  });
});
