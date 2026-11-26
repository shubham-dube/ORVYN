import type { ServerMessage } from '@orvyn/contracts';
import { b64, chatReady, PcChannel } from '@orvyn/vault-crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PcLink } from '../lib/pc';

/** A PC at the other end (the real one is apps/desktop/src-tauri/src/pc). */
const key = new Uint8Array(32).fill(7);
const pair = { id: 'pair-aaaaaaaaaaa', key, name: 'PC' };

function setup() {
  const sent: { to?: string; s: string; d: string }[] = [];
  let hear: (m: ServerMessage) => void = () => undefined;
  let online = true;
  let seen = 0;
  const out: [string, string, boolean][] = [];
  const link = new PcLink(
    pair,
    { send: (f) => online && (sent.push(f), true), on: (h) => ((hear = h), () => undefined) },
    {
      changed: () => undefined,
      output: (...x) => out.push(x),
      opened: () => undefined,
      problem: () => undefined,
      did: () => undefined,
    },
    'Test',
  );
  let chan: PcChannel;
  const s = () => sent.filter((f) => f.d.startsWith('o.')).at(-1)!.s;
  const pc = {
    raw: (d: string, from = 'pc') => hear({ type: 'pc', from, s: s(), d }),
    answer: (half = 'HALF') => {
      chan = new PcChannel(key, `${s()}.${half}`, 'p');
      pc.raw(`r.${half}`);
    },
    say: (m: unknown) => pc.raw(chan.seal(JSON.stringify(m))),
    /** what it asked since last time */
    asked: () =>
      sent
        .slice(seen, (seen = sent.length))
        .filter((f) => f.d.startsWith('m.'))
        .map((f) => JSON.parse(chan.open(f.d)) as Record<string, unknown>),
    chan: () => chan,
  };
  return {
    link,
    pc,
    sent,
    out,
    hello: () => hear({ type: 'hello', userId: 'u', deviceId: 'd' }),
    off: () => (online = false),
  };
}
const term = { id: 't1', name: 'PowerShell', since: 0, exit: null };
const hello = { t: 'hello', pc: 'PC', shells: [{ id: 'pwsh', name: 'PowerShell' }], terms: [term] };

describe('the terminal link to my PC', () => {
  beforeEach(async () => {
    await chatReady();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('finds the PC, asks for the PIN, sends it only encrypted and only to that device', async () => {
    const t = setup();
    await t.link.connect();
    expect(t.sent[0]).toMatchObject({ d: 'o.pair-aaaaaaaaaaa' });
    expect(t.sent[0]!.to).toBeUndefined();
    t.pc.answer();
    expect(t.link.status).toBe('pin');
    t.link.enterPin('826193');
    expect(t.sent.at(-1)!.to).toBe('pc');
    expect(JSON.stringify(t.sent)).not.toContain('826193');
    expect(t.pc.asked()).toEqual([{ t: 'auth', pin: '826193', name: 'Test' }]);
    t.pc.say({ t: 'badpin', left: 4 });
    expect([t.link.status, t.link.left]).toEqual(['pin', 4]);
    t.link.enterPin('826194');
    t.pc.asked();
    t.pc.say(hello);
    expect(t.link.status).toBe('open');
    t.link.stop();
  });

  it('goes on where it was after the network drops, without asking the PIN again', async () => {
    const t = setup();
    await t.link.connect();
    t.pc.answer();
    t.link.enterPin('826193');
    t.pc.asked();
    t.pc.say(hello);
    t.link.attach('t1', 90, 30);
    t.pc.say({ t: 'out', id: 't1', d: 'abc', end: 3, reset: false });
    expect(t.out).toEqual([['t1', 'abc', false]]);
    expect(t.pc.asked()).toEqual([
      { t: 'attach', id: 't1', cols: 90, rows: 30, from: 0 },
      { t: 'ack', id: 't1', end: 3 },
    ]);
    t.hello(); // a new connection to the server
    await vi.advanceTimersByTimeAsync(10);
    expect(t.link.status).toBe('finding');
    expect(t.link.type('t1', 'lost?')).toBe(false); // never typed later by surprise
    t.pc.answer('NEW');
    t.pc.say(hello);
    expect(t.pc.asked()).toEqual([
      { t: 'auth', pin: '826193', name: 'Test' },
      { t: 'attach', id: 't1', cols: 90, rows: 30, from: 3 },
    ]);
    t.link.stop();
  });

  it('starts again on a message that is not the next one; stays out when told off, locked or idle', async () => {
    const t = setup();
    await t.link.connect();
    t.pc.answer();
    t.link.enterPin('x');
    t.pc.say(hello);
    const before = t.sent.length;
    const repeated = t.pc.chan().seal(JSON.stringify({ t: 'pong' }));
    t.pc.raw(repeated);
    t.pc.raw(repeated);
    expect(t.link.status).toBe('finding');
    await vi.advanceTimersByTimeAsync(500);
    expect(t.sent.slice(before).some((f) => f.d.startsWith('o.'))).toBe(true);
    t.pc.answer('B');
    t.pc.raw('x.off', 'someone-else'); // not from the PC
    expect(t.link.status).not.toBe('off');
    t.pc.say({ t: 'end', why: 'idle' });
    expect(t.link.status).toBe('idle');
    t.hello();
    await vi.advanceTimersByTimeAsync(10);
    expect(t.link.status).toBe('idle');
    t.link.stop();
  });

  it('puts a file together from its parts, in order, and confirms each', async () => {
    const t = setup();
    await t.link.connect();
    t.pc.answer();
    t.link.enterPin('x');
    t.pc.say(hello);
    t.pc.asked();
    t.link.deck({ t: 'get', path: 'C:\\a.txt' });
    t.pc.say({ t: 'blob', id: 1, name: 'a.txt', size: 5, part: 3 });
    t.pc.say({ t: 'part', id: 9, n: 0, d: 'AAAA' }); // another one's
    t.pc.say({ t: 'part', id: 1, n: 0, d: b64(new TextEncoder().encode('hel')) });
    expect(t.link.remote.progress).toBeCloseTo(0.6);
    t.pc.say({ t: 'part', id: 1, n: 1, d: b64(new TextEncoder().encode('lo')) });
    expect(t.link.remote.progress).toBeNull();
    expect(await t.link.remote.file!.blob.text()).toBe('hello');
    expect(t.pc.asked()).toEqual([
      { t: 'get', path: 'C:\\a.txt' },
      { t: 'got', id: 1, n: 1 },
      { t: 'got', id: 1, n: 2 },
    ]);
    t.link.stop();
  });

  it('says when nobody answers, and drops what a terminal answers by itself', async () => {
    const t = setup();
    await t.link.connect();
    await vi.advanceTimersByTimeAsync(7000);
    expect(t.link.status).toBe('offline');
    await t.link.connect();
    t.pc.answer();
    t.link.enterPin('x');
    t.pc.asked();
    t.pc.say(hello);
    t.link.type('t1', '\x1b[12;40R');
    t.link.type('t1', '\x1b[A\x1b[?1;2cls\r');
    expect(t.pc.asked()).toEqual([{ t: 'in', id: 't1', d: '\x1b[Als\r' }]);
    // a PC that fell asleep: no answer to the ping, so look again
    await vi.advanceTimersByTimeAsync(20_100);
    expect(t.pc.asked()).toEqual([{ t: 'ping' }]);
    await vi.advanceTimersByTimeAsync(8_100);
    expect(t.link.status).toBe('finding');
    t.link.stop();
  });
});
