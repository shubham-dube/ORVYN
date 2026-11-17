import { Inject, Injectable } from '@nestjs/common';
import sodium from 'libsodium-wrappers';
import { ENV, type Env } from '../../config/env';

/**
 * Encrypts provider tokens at rest with libsodium's secretbox (XSalsa20-Poly1305), a random nonce per value and a
 * 32-byte key from the environment (docs/architecture/security.md: audited libraries only, no custom crypto).
 * Outside production a missing key falls back to a fixed development key, so local runs work.
 */
@Injectable()
export class TokenBox {
  private key: Uint8Array | null = null;
  constructor(@Inject(ENV) private readonly env: Env) {}

  private async k(): Promise<Uint8Array> {
    if (this.key) return this.key;
    await sodium.ready;
    const raw = this.env.CALENDAR_TOKEN_KEY
      ? sodium.from_base64(this.env.CALENDAR_TOKEN_KEY, sodium.base64_variants.ORIGINAL)
      : sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, 'orvyn-dev-calendar-token-key');
    if (raw.length !== sodium.crypto_secretbox_KEYBYTES)
      throw new Error('CALENDAR_TOKEN_KEY must be 32 bytes (base64)');
    this.key = raw;
    return raw;
  }

  async seal(plain: string): Promise<string> {
    const key = await this.k();
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const box = sodium.crypto_secretbox_easy(sodium.from_string(plain), nonce, key);
    return `v1.${sodium.to_base64(nonce)}.${sodium.to_base64(box)}`;
  }

  async open(sealed: string): Promise<string> {
    const key = await this.k();
    const [v, n, b] = sealed.split('.');
    if (v !== 'v1' || !n || !b) throw new Error('unknown token format');
    return sodium.to_string(
      sodium.crypto_secretbox_open_easy(sodium.from_base64(b), sodium.from_base64(n), key),
    );
  }
}
