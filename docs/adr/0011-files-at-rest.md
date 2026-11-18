# ADR-0011: Files encrypted at rest with their own keys

- Status: Accepted
- Date: 2026-11-18
- Related: security.md ("every uploaded object encrypted with its own data key"), ADR-0008 (R2), D4, spec 0003

## Decision

- api module `files`: an upload gets a random 32-byte data key; the bytes are encrypted with libsodium
  **secretstream** (XChaCha20-Poly1305) and stored in the object store (local directory in development and tests,
  Cloudflare R2 through the S3 API in production). The data key is stored only wrapped with `FILES_MASTER_KEY`
  (secretbox), which lives in the environment, never in the database or the bucket.
- Rows: id, owner, name, type, size, sha256 of the plain bytes, wrapped key, object key. Every read checks the owner.
  Downloads are streamed and decrypted by the API; there are no public or pre-signed URLs.
- Limits: 15 MB per file; images, PDFs and text only for now.
- The AI may read a file the person dropped (D4, D21); Vault files will be separate and zero-knowledge (ADR-0004).

## Consequences

A copied bucket or database alone reveals nothing. Losing `FILES_MASTER_KEY` loses the files: it is kept with the
backup key (deploy guide).
