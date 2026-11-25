import { Inject, Injectable } from '@nestjs/common';
import sodium from 'libsodium-wrappers';
import { ENV, type Env } from '../config/env';

/**
 * Seals a person's private records at rest (ADR-0018): libsodium secretbox with a key per person and purpose, derived
 * from FILES_MASTER_KEY, which lives only in the environment. A copied database alone reveals nothing, and one
 * person's blob cannot be opened as another's.
 */
@Injectable()
export class Seal {
  private master: Uint8Array | null = null;
  constructor(@Inject(ENV) private readonly env: Env) {}

  private async key(ownerId: string, purpose: string): Promise<Uint8Array> {
    await sodium.ready;
    this.master ??= this.env.FILES_MASTER_KEY
      ? sodium.from_base64(this.env.FILES_MASTER_KEY, sodium.base64_variants.ORIGINAL)
      : sodium.crypto_generichash(32, 'orvyn-dev-files-master-key');
    return sodium.crypto_generichash(
      sodium.crypto_secretbox_KEYBYTES,
      `orvyn-${purpose}-v1|${ownerId}`,
      this.master,
    );
  }

  /** One key for many values (a day has thousands of spans). */
  async for(ownerId: string, purpose: string) {
    const key = await this.key(ownerId, purpose);
    return {
      seal: (value: unknown): string => {
        const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
        const box = sodium.crypto_secretbox_easy(sodium.from_string(JSON.stringify(value)), nonce, key);
        return `v1.${sodium.to_base64(nonce)}.${sodium.to_base64(box)}`;
      },
      open: <T>(sealed: string): T => {
        const [v, n, b] = sealed.split('.');
        if (v !== 'v1' || !n || !b) throw new Error('unknown sealed format');
        return JSON.parse(
          sodium.to_string(
            sodium.crypto_secretbox_open_easy(sodium.from_base64(b), sodium.from_base64(n), key),
          ),
        ) as T;
      },
    };
  }
}
