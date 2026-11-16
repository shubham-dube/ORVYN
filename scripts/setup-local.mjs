// One-time local setup: creates .env with fresh secrets and web-push keys.
//   node scripts/setup-local.mjs you@example.com
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const email = process.argv[2];
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error(
    'usage: node scripts/setup-local.mjs <your-email>   (the first sign-in with it becomes the owner)',
  );
  process.exit(1);
}
if (existsSync('.env')) {
  console.error('.env already exists — edit it instead (or delete it to start over).');
  process.exit(1);
}
const secret = () => randomBytes(48).toString('base64url');
const webpush = createRequire(new URL('../apps/api/package.json', import.meta.url))('web-push');
const vapid = webpush.generateVAPIDKeys();
const set = (text, key, value) => text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);

let env = readFileSync('.env.example', 'utf8');
env = set(env, 'OWNER_EMAIL', email.toLowerCase());
env = set(env, 'JWT_SECRET', secret());
env = set(env, 'TOKEN_PEPPER', secret());
env = set(env, 'VAPID_PUBLIC_KEY', vapid.publicKey);
env = set(env, 'VAPID_PRIVATE_KEY', vapid.privateKey);
// the unpacked dev build of the Chrome extension (apps/extension/dev-key.json pins this id)
env = set(env, 'EXTENSION_IDS', 'hapijaoahockgcidibcnbghpajpnnanh');
writeFileSync('.env', env);
console.log(`Wrote .env — owner ${email.toLowerCase()}, fresh secrets, web-push keys. Next: pnpm dev`);
