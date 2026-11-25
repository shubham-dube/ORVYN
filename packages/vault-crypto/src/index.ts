import sodium from 'libsodium-wrappers-sumo';

/**
 * The Vault's cryptography (ADR-0004, D24). Everything here runs on the person's device; the server only ever stores the
 * strings this produces. Argon2id turns the passphrase into a key-encryption key, a random vault key encrypts every
 * item with XChaCha20-Poly1305, and a recovery key (shown once) wraps the vault key a second way. The Dart
 * implementation (apps/mobile/lib/vault/vault_crypto.dart) reads the same fixtures/vectors.json.
 */

export interface KdfParams {
  /** Argon2id passes */
  ops: number;
  /** Argon2id memory in KiB */
  memKiB: number;
}
/** 32 MiB, 3 passes: above the OWASP minimum, and fast enough to unlock on a phone. */
export const DEFAULT_KDF: KdfParams = { ops: 3, memKiB: 32 * 1024 };

/** What the server stores for a person's vault keys: two atomic strings. */
export interface VaultKeys {
  /** JSON: { v, salt, ops, memKiB, wrap } — the vault key wrapped by the passphrase-derived key */
  pass: string;
  /** the vault key wrapped by the recovery key */
  recovery: string;
}

export class WrongPassphrase extends Error {
  constructor() {
    super('wrong passphrase');
  }
}
export class WrongRecoveryKey extends Error {
  constructor() {
    super('wrong recovery key');
  }
}
export class BadVaultData extends Error {}

const V = 'v1';
const AAD_PASS = 'orvyn-vault-wrap-v1|pass';
const AAD_RECOVERY = 'orvyn-vault-wrap-v1|recovery';
const aadItem = (id: string) => `orvyn-vault-item-v1|${id}`;

let ready: Promise<typeof sodium> | null = null;
const lib = () => (ready ??= sodium.ready.then(() => sodium));

const b64 = (u: Uint8Array) => sodium.to_base64(u, sodium.base64_variants.URLSAFE_NO_PADDING);
const unb64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);

function seal(key: Uint8Array, plain: Uint8Array, aad: string, nonce?: Uint8Array): string {
  const n = nonce ?? sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, aad, null, n, key);
  return `${V}.${b64(n)}.${b64(ct)}`;
}

function open(key: Uint8Array, blob: string, aad: string): Uint8Array {
  const [v, n, c, extra] = blob.split('.');
  if (v !== V || !n || !c || extra !== undefined) throw new BadVaultData('unknown format');
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, unb64(c), aad, unb64(n), key);
  } catch {
    throw new BadVaultData('could not decrypt');
  }
}

function derive(passphrase: string, salt: Uint8Array, kdf: KdfParams): Uint8Array {
  return sodium.crypto_pwhash(
    32,
    passphrase.normalize('NFKC'),
    salt,
    kdf.ops,
    kdf.memKiB * 1024,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 32 bytes → 52 characters in groups of four: "7K2M-9QXA-…". */
export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

/** Back to bytes; forgiving about case, spaces, dashes and look-alike letters (I, L → 1; O → 0). */
export function parseRecoveryKey(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (clean.length !== 52) throw new WrongRecoveryKey();
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = CROCKFORD.indexOf(ch);
    if (i < 0) throw new WrongRecoveryKey();
    acc = (acc << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((acc >> (bits - 8)) & 255);
      bits -= 8;
      acc &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out.slice(0, 32));
}

export interface Deterministic {
  vaultKey?: Uint8Array;
  recoveryKey?: Uint8Array;
  salt?: Uint8Array;
  nonces?: Uint8Array[];
}

/** First-time setup: a new vault key, wrapped by the passphrase and by a fresh recovery key (returned once, to print). */
export async function createVault(
  passphrase: string,
  kdf: KdfParams = DEFAULT_KDF,
  fixed: Deterministic = {},
): Promise<{ keys: VaultKeys; vaultKey: Uint8Array; recoveryKey: string }> {
  await lib();
  const vaultKey = fixed.vaultKey ?? sodium.randombytes_buf(32);
  const rk = fixed.recoveryKey ?? sodium.randombytes_buf(32);
  const salt = fixed.salt ?? sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const kek = derive(passphrase, salt, kdf);
  const keys: VaultKeys = {
    pass: JSON.stringify({
      v: 1,
      salt: b64(salt),
      ops: kdf.ops,
      memKiB: kdf.memKiB,
      wrap: seal(kek, vaultKey, AAD_PASS, fixed.nonces?.[0]),
    }),
    recovery: seal(rk, vaultKey, AAD_RECOVERY, fixed.nonces?.[1]),
  };
  return { keys, vaultKey, recoveryKey: formatRecoveryKey(rk) };
}

function readPass(keys: VaultKeys) {
  try {
    const p = JSON.parse(keys.pass) as { v: number; salt: string; ops: number; memKiB: number; wrap: string };
    if (p.v !== 1 || !p.salt || !p.wrap) throw new Error();
    return p;
  } catch {
    throw new BadVaultData('unreadable vault keys');
  }
}

/** Open the vault with the passphrase. Wrong passphrase → WrongPassphrase. */
export async function unlock(keys: VaultKeys, passphrase: string): Promise<Uint8Array> {
  await lib();
  const p = readPass(keys);
  try {
    return open(derive(passphrase, unb64(p.salt), { ops: p.ops, memKiB: p.memKiB }), p.wrap, AAD_PASS);
  } catch {
    throw new WrongPassphrase();
  }
}

/** Open the vault with the recovery key. */
export async function unlockWithRecovery(keys: VaultKeys, recoveryKey: string): Promise<Uint8Array> {
  await lib();
  const rk = parseRecoveryKey(recoveryKey);
  try {
    return open(rk, keys.recovery, AAD_RECOVERY);
  } catch {
    throw new WrongRecoveryKey();
  }
}

/** A new passphrase for the same vault key: items are not re-encrypted. Returns the new `pass` string. */
export async function rewrapPassphrase(
  vaultKey: Uint8Array,
  newPassphrase: string,
  kdf: KdfParams = DEFAULT_KDF,
  fixed: Deterministic = {},
): Promise<string> {
  await lib();
  const salt = fixed.salt ?? sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const kek = derive(newPassphrase, salt, kdf);
  return JSON.stringify({
    v: 1,
    salt: b64(salt),
    ops: kdf.ops,
    memKiB: kdf.memKiB,
    wrap: seal(kek, vaultKey, AAD_PASS, fixed.nonces?.[0]),
  });
}

/** Change the passphrase (proving the old one), or reset it with the recovery key. */
export async function changePassphrase(
  keys: VaultKeys,
  oldPassphrase: string,
  newPassphrase: string,
): Promise<VaultKeys> {
  const vk = await unlock(keys, oldPassphrase);
  return { ...keys, pass: await rewrapPassphrase(vk, newPassphrase) };
}
export async function resetPassphrase(
  keys: VaultKeys,
  recoveryKey: string,
  newPassphrase: string,
): Promise<{ keys: VaultKeys; vaultKey: Uint8Array }> {
  const vk = await unlockWithRecovery(keys, recoveryKey);
  return { keys: { ...keys, pass: await rewrapPassphrase(vk, newPassphrase) }, vaultKey: vk };
}

/** Encrypt an item (any JSON) under the vault key, bound to its id so it can't be swapped for another. */
export async function encryptItem(
  vaultKey: Uint8Array,
  itemId: string,
  payload: unknown,
  nonce?: Uint8Array,
): Promise<string> {
  await lib();
  return seal(vaultKey, sodium.from_string(JSON.stringify(payload)), aadItem(itemId), nonce);
}
export async function decryptItem<T = unknown>(
  vaultKey: Uint8Array,
  itemId: string,
  blob: string,
): Promise<T> {
  await lib();
  return JSON.parse(sodium.to_string(open(vaultKey, blob, aadItem(itemId)))) as T;
}
/** Byte-level variants, for the shared test vectors. */
export async function encryptBytes(
  vaultKey: Uint8Array,
  itemId: string,
  plain: Uint8Array,
  nonce: Uint8Array,
): Promise<string> {
  await lib();
  return seal(vaultKey, plain, aadItem(itemId), nonce);
}

/** A random password from the browser's or device's secure generator. */
export function generatePassword(o: { length?: number; symbols?: boolean; digits?: boolean } = {}): string {
  const length = Math.min(128, Math.max(8, o.length ?? 20));
  const sets = [
    'abcdefghijkmnopqrstuvwxyz',
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    ...(o.digits === false ? [] : ['23456789']),
    ...(o.symbols === false ? [] : ['!@#$%^&*-_=+?']),
  ];
  const all = sets.join('');
  const rnd = (n: number) => {
    // rejection sampling, so every character is equally likely
    const max = Math.floor(0x1_0000_0000 / n) * n;
    for (;;) {
      const x = crypto.getRandomValues(new Uint32Array(1))[0]!;
      if (x < max) return x % n;
    }
  };
  const out = sets.map((s) => s[rnd(s.length)]!); // at least one of each kind
  while (out.length < length) out.push(all[rnd(all.length)]!);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.join('');
}

export const toB64 = (u: Uint8Array) => b64(u);
export const fromB64 = (s: string) => unb64(s);
export * from './chat';
export * from './totp';
