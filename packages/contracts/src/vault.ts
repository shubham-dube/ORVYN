import { z } from 'zod';

/**
 * Vault (spec 0004, ADR-0004): the server holds only strings it cannot read. Item contents — title, kind, every field —
 * are inside `blob`; the keys record holds the vault key wrapped by the passphrase and by the recovery key.
 */
export const VAULT_KEYS = 'vault.keys';
export const VAULT_ITEM = 'vault.item';

/** Item kinds live inside the encrypted blob; this is what the apps put there. */
export const VAULT_KINDS = ['login', 'card', 'id', 'apikey', 'recovery', 'note'] as const;

/** One record per person, addressed by their own id. Two atomic strings so concurrent devices can't mix them. */
export const VaultKeysFields = z.object({
  pass: z.string().min(20).max(1500),
  recovery: z.string().min(20).max(800),
});
export type VaultKeysFields = z.infer<typeof VaultKeysFields>;

/** `v1.<nonce>.<ciphertext>` — about 1.4 MB at most (small attachments live inside it). */
export const VaultItemFields = z.object({
  blob: z
    .string()
    .min(20)
    .max(1_400_000)
    .regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
});
export type VaultItemFields = z.infer<typeof VaultItemFields>;
