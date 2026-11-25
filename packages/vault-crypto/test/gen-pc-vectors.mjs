// node packages/vault-crypto/test/gen-pc-vectors.mjs (after a build)
import { writeFileSync } from 'node:fs';
import { b64, chatReady, pcSeal } from '../dist/index.js';

await chatReady();
const key = Uint8Array.from({ length: 32 }, (_, i) => i);
const nonce = Uint8Array.from({ length: 24 }, (_, i) => 100 + i);
const sid = 'AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBA';
const messages = [
  ['c', 0, '{"t":"auth","pin":"example"}'],
  ['p', 0, 'नमस्ते ✓'],
  ['p', 41, ''],
].map(([dir, n, plain]) => ({ dir, n, plain, frame: pcSeal(key, sid, dir, n, plain, nonce) }));
const id = b64(Uint8Array.from({ length: 12 }, (_, i) => 50 + i));
const name = 'My PC';
const text = `ORVYN-PC1.${id}.${b64(key)}.${b64(new TextEncoder().encode(name))}`;
writeFileSync(
  new URL('../fixtures/pc-vectors.json', import.meta.url),
  JSON.stringify({ key: b64(key), nonce: b64(nonce), sid, pairing: { text, id, name }, messages }, null, 2) +
    '\n',
);
