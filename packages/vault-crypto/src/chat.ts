import sodium from 'libsodium-wrappers-sumo';

/**
 * Chat encryption (ADR-0014): a fresh key per message, sealed to every device with X25519 + BLAKE2b +
 * XChaCha20-Poly1305 and signed with Ed25519. The Dart side (apps/mobile/lib/chat/chat_crypto.dart) reads the same
 * fixtures/chat-vectors.json and must produce identical bytes for identical inputs.
 */

const SEAL_LABEL = 'orvyn-chat-seal-v1';
const SIG_LABEL = 'orvyn-chat-sig-v1';
const enc = new TextEncoder();
const dec = new TextDecoder();

let ready: Promise<typeof sodium> | null = null;
export const chatReady = () => (ready ??= sodium.ready.then(() => sodium));

export const b64 = (u: Uint8Array) => sodium.to_base64(u, sodium.base64_variants.URLSAFE_NO_PADDING);
export const unb64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);
const cat = (...xs: Uint8Array[]) => {
  const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of xs) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};

export class BadChatData extends Error {}

/** A device's keys. Secrets stay on the device. */
export interface DeviceKeys {
  boxPublic: string;
  boxSecret: string;
  signPublic: string;
  signSecret: string;
}

/** New device keys (seeds only for test vectors). */
export async function newDeviceKeys(seeds?: { box: Uint8Array; sign: Uint8Array }): Promise<DeviceKeys> {
  const s = await chatReady();
  const boxSecret = seeds?.box ?? s.randombytes_buf(32);
  const boxPublic = s.crypto_scalarmult_base(boxSecret);
  const sign = s.crypto_sign_seed_keypair(seeds?.sign ?? s.randombytes_buf(32));
  return {
    boxPublic: b64(boxPublic),
    boxSecret: b64(boxSecret),
    signPublic: b64(sign.publicKey),
    // the 32-byte seed is the secret we keep (Ed25519 expands it the same way everywhere)
    signSecret: b64(sign.privateKey.slice(0, 32)),
  };
}

/** A short fingerprint of a device's public keys, to compare in person. */
export async function fingerprint(boxPublic: string, signPublic: string): Promise<string> {
  const s = await chatReady();
  const h = s.crypto_generichash(10, cat(unb64(boxPublic), unb64(signPublic)), null);
  return [...h]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .match(/.{4}/g)!
    .join(' ');
}

function aead(key: Uint8Array, plain: Uint8Array, aad: Uint8Array, nonce: Uint8Array) {
  return sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, aad, null, nonce, key);
}
function unaead(key: Uint8Array, ct: Uint8Array, aad: Uint8Array, nonce: Uint8Array) {
  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, aad, nonce, key);
  } catch {
    throw new BadChatData('cannot open');
  }
}

/** Seals a 32-byte key to one device: E ‖ nonce ‖ ciphertext (base64url). */
export async function sealKey(
  key: Uint8Array,
  recipientBoxPublic: string,
  fixed?: { ephemeral: Uint8Array; nonce: Uint8Array },
): Promise<string> {
  const s = await chatReady();
  const R = unb64(recipientBoxPublic);
  const e = fixed?.ephemeral ?? s.randombytes_buf(32);
  const E = s.crypto_scalarmult_base(e);
  const shared = s.crypto_scalarmult(e, R);
  const w = s.crypto_generichash(32, cat(enc.encode(SEAL_LABEL), shared, E, R), null);
  const n = fixed?.nonce ?? s.randombytes_buf(24);
  return b64(cat(E, n, aead(w, key, cat(E, R), n)));
}

export async function openKey(sealed: string, myBoxSecret: string): Promise<Uint8Array> {
  const s = await chatReady();
  const raw = unb64(sealed);
  if (raw.length < 32 + 24 + 16) throw new BadChatData('short');
  const E = raw.slice(0, 32);
  const n = raw.slice(32, 56);
  const sk = unb64(myBoxSecret);
  const R = s.crypto_scalarmult_base(sk);
  const shared = s.crypto_scalarmult(sk, E);
  const w = s.crypto_generichash(32, cat(enc.encode(SEAL_LABEL), shared, E, R), null);
  return unaead(w, raw.slice(56), cat(E, R), n);
}

const contentAad = (conv: string, id: string, device: string) =>
  enc.encode(`orvyn-chat-v1|${conv}|${id}|${device}`);

async function digest(conv: string, id: string, device: string, nonce: Uint8Array, ct: Uint8Array) {
  const s = await chatReady();
  return s.crypto_generichash(
    32,
    cat(enc.encode(SIG_LABEL), enc.encode(conv), enc.encode(id), enc.encode(device), nonce, ct),
    null,
  );
}

export interface Recipient {
  deviceId: string;
  boxPublic: string;
}
export interface Sealed {
  ciphertext: string;
  nonce: string;
  signature: string;
  keys: { deviceId: string; sealed: string }[];
}

/** Encrypts one message for every device. `fixed` only for test vectors. */
export async function encryptMessage(
  payload: unknown,
  o: {
    conversationId: string;
    messageId: string;
    deviceId: string;
    signSecret: string;
    recipients: Recipient[];
  },
  fixed?: { key: Uint8Array; nonce: Uint8Array; seals: { ephemeral: Uint8Array; nonce: Uint8Array }[] },
): Promise<Sealed> {
  const s = await chatReady();
  const key = fixed?.key ?? s.randombytes_buf(32);
  const nonce = fixed?.nonce ?? s.randombytes_buf(24);
  const ct = aead(
    key,
    enc.encode(JSON.stringify(payload)),
    contentAad(o.conversationId, o.messageId, o.deviceId),
    nonce,
  );
  const sig = s.crypto_sign_detached(
    await digest(o.conversationId, o.messageId, o.deviceId, nonce, ct),
    s.crypto_sign_seed_keypair(unb64(o.signSecret)).privateKey,
  );
  const keys: Sealed['keys'] = [];
  for (const [i, r] of o.recipients.entries())
    keys.push({ deviceId: r.deviceId, sealed: await sealKey(key, r.boxPublic, fixed?.seals[i]) });
  return { ciphertext: b64(ct), nonce: b64(nonce), signature: b64(sig), keys };
}

/** Checks the sender's signature, opens this device's key, decrypts. */
export async function decryptMessage<T = unknown>(
  m: {
    conversationId: string;
    id: string;
    senderDeviceId: string;
    ciphertext: string;
    nonce: string;
    signature: string;
  },
  sealedForMe: string,
  myBoxSecret: string,
  senderSignPublic: string,
): Promise<T> {
  const s = await chatReady();
  const ct = unb64(m.ciphertext);
  const nonce = unb64(m.nonce);
  const ok = s.crypto_sign_verify_detached(
    unb64(m.signature),
    await digest(m.conversationId, m.id, m.senderDeviceId, nonce, ct),
    unb64(senderSignPublic),
  );
  if (!ok) throw new BadChatData('bad signature');
  const key = await openKey(sealedForMe, myBoxSecret);
  return JSON.parse(
    dec.decode(unaead(key, ct, contentAad(m.conversationId, m.id, m.senderDeviceId), nonce)),
  ) as T;
}

/**
 * Open a sealed message with its message key `K` handed over by a device that could unseal it (carrying old chats over,
 * ADR-0016). The sender's signature is checked first, so a key can't be used to plant words in someone's mouth.
 */
export async function openMessageWithKey<T = unknown>(
  m: {
    conversationId: string;
    id: string;
    senderDeviceId: string;
    ciphertext: string;
    nonce: string;
    signature: string;
  },
  key: Uint8Array,
  senderSignPublic: string,
): Promise<T> {
  const s = await chatReady();
  const ct = unb64(m.ciphertext);
  const nonce = unb64(m.nonce);
  const ok = s.crypto_sign_verify_detached(
    unb64(m.signature),
    await digest(m.conversationId, m.id, m.senderDeviceId, nonce, ct),
    unb64(senderSignPublic),
  );
  if (!ok) throw new BadChatData('bad signature');
  try {
    return JSON.parse(
      dec.decode(unaead(key, ct, contentAad(m.conversationId, m.id, m.senderDeviceId), nonce)),
    ) as T;
  } catch {
    throw new BadChatData('wrong key');
  }
}

/** A file, encrypted before upload: the key and nonce go inside the message. */
export async function encryptFile(bytes: Uint8Array, fixed?: { key: Uint8Array; nonce: Uint8Array }) {
  const s = await chatReady();
  const key = fixed?.key ?? s.randombytes_buf(32);
  const nonce = fixed?.nonce ?? s.randombytes_buf(24);
  return {
    key: b64(key),
    nonce: b64(nonce),
    bytes: aead(key, bytes, enc.encode('orvyn-chat-file-v1'), nonce),
  };
}

export async function decryptFile(bytes: Uint8Array, key: string, nonce: string): Promise<Uint8Array> {
  await chatReady();
  return unaead(unb64(key), bytes, enc.encode('orvyn-chat-file-v1'), unb64(nonce));
}
