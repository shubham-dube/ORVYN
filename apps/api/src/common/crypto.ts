import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 256-bit opaque token, base64url. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Uniform 6-digit code. */
export const randomCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Stored form of a secret (token/code): HMAC-SHA256 with a server-side pepper; the DB alone cannot reverse it. */
export const hashSecret = (pepper: string, value: string): string =>
  createHmac('sha256', pepper).update(value).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
