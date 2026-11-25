import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { b64, chatReady, PcChannel, pcSeal, readPairing, unb64 } from '../src';

const v = JSON.parse(readFileSync(new URL('../fixtures/pc-vectors.json', import.meta.url), 'utf8')) as {
  key: string;
  nonce: string;
  sid: string;
  pairing: { text: string; id: string; name: string };
  messages: { dir: 'c' | 'p'; n: number; plain: string; frame: string }[];
};

describe('PC messages (ADR-0019)', () => {
  beforeAll(async () => void (await chatReady()));

  it('gives the same bytes as the PC and the Android app', async () => {
    for (const m of v.messages)
      expect(pcSeal(unb64(v.key), v.sid, m.dir, m.n, m.plain, unb64(v.nonce))).toBe(m.frame);
    const p = await readPairing(`https://orvyn.dubey.app/pc#${v.pairing.text}`);
    expect({ ...p, key: b64(p!.key) }).toEqual({ id: v.pairing.id, name: v.pairing.name, key: v.key });
    expect(await readPairing('hello')).toBeNull();
  });

  it('refuses changed, repeated, reordered, reflected messages and those of another session', () => {
    const key = unb64(v.key);
    const phone = new PcChannel(key, 's1', 'c');
    const pc = new PcChannel(key, 's1', 'p');
    const a = phone.seal('a');
    const b = phone.seal('b');
    expect(() => pc.open(b)).toThrow();
    const at = a.length - 10;
    expect(() => pc.open(a.slice(0, at) + (a[at] === 'A' ? 'B' : 'A') + a.slice(at + 1))).toThrow();
    expect(() => phone.open(a)).toThrow();
    expect(() => new PcChannel(key, 's2', 'p').open(a)).toThrow();
    expect(() => new PcChannel(new Uint8Array(32), 's1', 'p').open(a)).toThrow();
    expect(pc.open(a)).toBe('a');
    expect(() => pc.open(a)).toThrow();
    expect(pc.open(b)).toBe('b');
  });
});
