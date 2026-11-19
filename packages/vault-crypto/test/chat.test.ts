import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BadChatData,
  b64,
  decryptFile,
  decryptMessage,
  encryptFile,
  encryptMessage,
  fingerprint,
  newDeviceKeys,
  openKey,
  unb64,
} from '../src/chat';

const v = JSON.parse(readFileSync(new URL('../fixtures/chat-vectors.json', import.meta.url), 'utf8'));

describe('chat crypto (ADR-0014)', () => {
  it('reproduces the shared vectors byte for byte', async () => {
    const again = await encryptMessage(
      v.payload,
      {
        conversationId: v.conversationId,
        messageId: v.messageId,
        deviceId: v.senderDeviceId,
        signSecret: v.devices.alice.signSecret,
        recipients: [
          { deviceId: 'bob-phone', boxPublic: v.devices.bobPhone.boxPublic },
          { deviceId: 'bob-laptop', boxPublic: v.devices.bobLaptop.boxPublic },
        ],
      },
      {
        key: unb64(v.fixed.key),
        nonce: unb64(v.fixed.nonce),
        seals: v.fixed.seals.map((x: { ephemeral: string; nonce: string }) => ({
          ephemeral: unb64(x.ephemeral),
          nonce: unb64(x.nonce),
        })),
      },
    );
    expect(again).toEqual(v.sealed);
    expect(await fingerprint(v.devices.alice.boxPublic, v.devices.alice.signPublic)).toBe(
      v.fingerprints.alice,
    );
  });

  it('every recipient device opens it; nobody else can', async () => {
    const msg = {
      conversationId: v.conversationId,
      id: v.messageId,
      senderDeviceId: v.senderDeviceId,
      ...v.sealed,
    };
    for (const [name, i] of [
      ['bobPhone', 0],
      ['bobLaptop', 1],
    ] as const)
      expect(
        await decryptMessage(
          msg,
          v.sealed.keys[i].sealed,
          v.devices[name].boxSecret,
          v.devices.alice.signPublic,
        ),
      ).toEqual(v.payload);
    const eve = await newDeviceKeys();
    await expect(
      decryptMessage(msg, v.sealed.keys[0].sealed, eve.boxSecret, v.devices.alice.signPublic),
    ).rejects.toThrow(BadChatData);
  });

  it('a forged or moved message fails the signature', async () => {
    const msg = {
      conversationId: v.conversationId,
      id: v.messageId,
      senderDeviceId: v.senderDeviceId,
      ...v.sealed,
    };
    const bob = v.devices.bobPhone;
    await expect(
      decryptMessage(
        { ...msg, conversationId: 'another' },
        v.sealed.keys[0].sealed,
        bob.boxSecret,
        v.devices.alice.signPublic,
      ),
    ).rejects.toThrow('bad signature');
    await expect(
      decryptMessage(msg, v.sealed.keys[0].sealed, bob.boxSecret, v.devices.bobLaptop.signPublic),
    ).rejects.toThrow('bad signature');
  });

  it('a sealed key and a file from the vectors open', async () => {
    expect(b64(await openKey(v.sealOnly.sealed, v.devices.bobPhone.boxSecret))).toBe(v.sealOnly.key);
    expect(new TextDecoder().decode(await decryptFile(unb64(v.file.bytes), v.file.key, v.file.nonce))).toBe(
      v.file.plain,
    );
    const f = await encryptFile(new Uint8Array([1, 2, 3]));
    expect([...(await decryptFile(f.bytes, f.key, f.nonce))]).toEqual([1, 2, 3]);
  });
});
