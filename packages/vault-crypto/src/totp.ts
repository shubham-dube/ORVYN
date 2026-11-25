/** One-time codes (RFC 6238), computed on this device only. */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export interface Totp {
  secret: string;
  digits: number;
  period: number;
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512';
  issuer?: string;
  account?: string;
}

/** A secret as people paste it: a bare base32 secret or a whole otpauth:// link. */
export function parseTotp(input: string): Totp | null {
  const s = input.trim();
  if (!s) return null;
  if (/^otpauth:\/\/totp\//i.test(s)) {
    try {
      const u = new URL(s);
      const secret = u.searchParams.get('secret') ?? '';
      base32(secret);
      const label = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
      const [a, b] = label.includes(':') ? label.split(':', 2) : [undefined, label];
      const alg = (u.searchParams.get('algorithm') ?? 'SHA1').toUpperCase();
      return {
        secret,
        digits: Number(u.searchParams.get('digits')) || 6,
        period: Number(u.searchParams.get('period')) || 30,
        algorithm: alg === 'SHA256' ? 'SHA-256' : alg === 'SHA512' ? 'SHA-512' : 'SHA-1',
        issuer: u.searchParams.get('issuer') ?? a?.trim(),
        account: b?.trim() || undefined,
      };
    } catch {
      return null;
    }
  }
  try {
    if (base32(s).length < 10) return null;
  } catch {
    return null;
  }
  return { secret: s, digits: 6, period: 30, algorithm: 'SHA-1' };
}

/** The code for a moment (RFC 6238 / RFC 4226 dynamic truncation). */
export async function totpCode(t: Totp, atMs = Date.now()): Promise<string> {
  const counter = Math.floor(atMs / 1000 / t.period);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(base32(t.secret)),
    { name: 'HMAC', hash: t.algorithm },
    false,
    ['sign'],
  );
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1]! & 0x0f;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** t.digits).padStart(t.digits, '0');
}

/** Seconds left on the current code. */
export const totpLeft = (t: Pick<Totp, 'period'>, atMs = Date.now()) =>
  t.period - (Math.floor(atMs / 1000) % t.period);
