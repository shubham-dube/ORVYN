// Regenerates fixtures/chat-vectors.json:  pnpm exec tsx test/gen-chat-vectors.ts   (only when the format changes on purpose)
import { writeFileSync } from 'node:fs';
import { b64, encryptFile, encryptMessage, fingerprint, newDeviceKeys, sealKey } from '../src/chat';

const bytes = (n: number, start: number) => Uint8Array.from({ length: n }, (_, i) => (start + i * 7) & 255);
const alice = await newDeviceKeys({ box: bytes(32, 1), sign: bytes(32, 2) });
const bobPhone = await newDeviceKeys({ box: bytes(32, 3), sign: bytes(32, 4) });
const bobLaptop = await newDeviceKeys({ box: bytes(32, 5), sign: bytes(32, 6) });
const ids = {
  conversationId: '0193f000-0000-7000-8000-00000000c0c0',
  messageId: '0193f000-0000-7000-8000-0000000000a1',
};
const payload = { t: 'text', text: 'Dinner at 8? 🍕 ünïcode', replyTo: null };
const fixed = {
  key: bytes(32, 50),
  nonce: bytes(24, 60),
  seals: [
    { ephemeral: bytes(32, 70), nonce: bytes(24, 80) },
    { ephemeral: bytes(32, 90), nonce: bytes(24, 100) },
  ],
};
const sealed = await encryptMessage(
  payload,
  {
    ...ids,
    deviceId: 'alice-phone',
    signSecret: alice.signSecret,
    recipients: [
      { deviceId: 'bob-phone', boxPublic: bobPhone.boxPublic },
      { deviceId: 'bob-laptop', boxPublic: bobLaptop.boxPublic },
    ],
  },
  fixed,
);
const file = await encryptFile(new TextEncoder().encode('a photo, pretend'), {
  key: bytes(32, 110),
  nonce: bytes(24, 120),
});
const out = {
  $comment: 'Shared by TypeScript (test/chat.test.ts) and Dart (apps/mobile/test/chat_crypto_test.dart).',
  devices: { alice, bobPhone, bobLaptop },
  fingerprints: { alice: await fingerprint(alice.boxPublic, alice.signPublic) },
  ...ids,
  senderDeviceId: 'alice-phone',
  payload,
  fixed: {
    key: b64(fixed.key),
    nonce: b64(fixed.nonce),
    seals: fixed.seals.map((x) => ({ ephemeral: b64(x.ephemeral), nonce: b64(x.nonce) })),
  },
  sealed,
  sealOnly: {
    key: b64(bytes(32, 130)),
    sealed: await sealKey(bytes(32, 130), bobPhone.boxPublic, {
      ephemeral: bytes(32, 140),
      nonce: bytes(24, 150),
    }),
  },
  file: { plain: 'a photo, pretend', key: file.key, nonce: file.nonce, bytes: b64(file.bytes) },
};
writeFileSync(new URL('../fixtures/chat-vectors.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
// eslint-disable-next-line no-console
console.log('wrote fixtures/chat-vectors.json');
