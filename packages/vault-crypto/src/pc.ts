import sodium from 'libsodium-wrappers-sumo';
import { b64, BadChatData, chatReady, unb64 } from './chat';

/**
 * Messages between a phone or browser and a PC (ADR-0019): XChaCha20-Poly1305 under the key made at pairing, bound to
 * the session, the direction and a counter. The same construction is in apps/desktop/src-tauri/src/pc/seal.rs and
 * apps/mobile/lib/pc/pc_crypto.dart; all three read fixtures/pc-vectors.json.
 */
export type PcDir = 'c' | 'p';
export interface PcPairing {
  id: string;
  key: Uint8Array;
  name: string;
}

const PREFIX = 'ORVYN-PC1';
const aad = (sid: string, dir: PcDir, n: number) => `orvyn-pc-v1|${sid}|${dir}|${n}`;

/** Call `chatReady()` first. */
export function pcSeal(
  key: Uint8Array,
  sid: string,
  dir: PcDir,
  n: number,
  plain: string,
  nonce: Uint8Array = sodium.randombytes_buf(24),
): string {
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    sodium.from_string(plain),
    aad(sid, dir, n),
    null,
    nonce,
    key,
  );
  const out = new Uint8Array(24 + ct.length);
  out.set(nonce);
  out.set(ct, 24);
  return `m.${n}.${b64(out)}`;
}

/** Opens the message that must be number `n`; anything else is refused. */
function pcOpen(key: Uint8Array, sid: string, dir: PcDir, n: number, frame: string): string {
  const [m, at, body, extra] = frame.split('.');
  if (m !== 'm' || at !== String(n) || !body || extra !== undefined)
    throw new BadChatData('not the next message');
  try {
    const raw = unb64(body);
    return sodium.to_string(
      sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        raw.slice(24),
        aad(sid, dir, n),
        raw.slice(0, 24),
        key,
      ),
    );
  } catch {
    throw new BadChatData('cannot open');
  }
}

/** One side of a session: counts what it sends and what it opens. Call `chatReady()` first. */
export class PcChannel {
  private sent = 0;
  private opened = 0;
  constructor(
    private readonly key: Uint8Array,
    private readonly sid: string,
    private readonly me: PcDir,
  ) {}
  seal(plain: string): string {
    return pcSeal(this.key, this.sid, this.me, this.sent++, plain);
  }
  open(frame: string): string {
    const text = pcOpen(this.key, this.sid, this.me === 'c' ? 'p' : 'c', this.opened, frame);
    this.opened++;
    return text;
  }
}

/** The phone's half of a session's name; the PC answers with the other. */
export async function pcNonce(): Promise<string> {
  const s = await chatReady();
  return b64(s.randombytes_buf(16));
}

/** The code the PC shows: on its own, or at the end of a link (after #, which browsers never send). */
export async function readPairing(text: string): Promise<PcPairing | null> {
  const s = await chatReady();
  const m = new RegExp(`${PREFIX}\\.([\\w-]{16})\\.([\\w-]{43})\\.([\\w-]{1,200})`).exec(text);
  if (!m) return null;
  try {
    const key = unb64(m[2]!);
    return key.length === 32 ? { id: m[1]!, key, name: s.to_string(unb64(m[3]!)) } : null;
  } catch {
    return null;
  }
}
