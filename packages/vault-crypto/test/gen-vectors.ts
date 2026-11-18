// Regenerates fixtures/vectors.json:  pnpm exec tsx test/gen-vectors.ts   (only when the format changes on purpose)
import { writeFileSync } from 'node:fs';
import { createVault, encryptBytes, formatRecoveryKey, rewrapPassphrase, toB64 } from '../src';

const bytes = (n: number, start: number) => Uint8Array.from({ length: n }, (_, i) => (start + i * 7) & 255);
const kdf = { ops: 2, memKiB: 1024 };
const vaultKey = bytes(32, 1);
const recoveryKey = bytes(32, 100);
const salt = bytes(16, 200);
const nonces = [bytes(24, 10), bytes(24, 40)];
const made = await createVault('correct horse battery staple ünïcode', kdf, {
  vaultKey,
  recoveryKey,
  salt,
  nonces,
});
const plain = JSON.stringify({
  kind: 'login',
  title: 'Bank',
  username: 'me@example.test',
  password: 'p@ss ✓',
  notes: '',
});
const itemNonce = bytes(24, 77);
const out = {
  $comment:
    'Shared by TypeScript (test/vectors.test.ts) and Dart (apps/mobile/test/vault_crypto_test.dart). Argon2id is kept light here so tests are quick.',
  kdf,
  passphrase: 'correct horse battery staple ünïcode',
  vaultKey: toB64(vaultKey),
  recoveryKeyBytes: toB64(recoveryKey),
  recoveryKeyText: formatRecoveryKey(recoveryKey),
  salt: toB64(salt),
  keys: made.keys,
  rewrap: {
    newPassphrase: 'a second passphrase',
    salt: toB64(bytes(16, 3)),
    nonce: toB64(bytes(24, 9)),
    pass: await rewrapPassphrase(vaultKey, 'a second passphrase', kdf, {
      salt: bytes(16, 3),
      nonces: [bytes(24, 9)],
    }),
  },
  item: {
    id: '0193b2f0-7c3a-7a11-9d6e-0a1b2c3d4e5f',
    plaintext: plain,
    nonce: toB64(itemNonce),
    blob: await encryptBytes(
      vaultKey,
      '0193b2f0-7c3a-7a11-9d6e-0a1b2c3d4e5f',
      new TextEncoder().encode(plain),
      itemNonce,
    ),
  },
};
writeFileSync(new URL('../fixtures/vectors.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
// eslint-disable-next-line no-console
console.log('written');
