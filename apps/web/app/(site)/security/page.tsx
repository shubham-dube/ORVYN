import type { Metadata } from 'next';
import { SitePage } from '@/components/site';
import { CONTACT } from '@/lib/downloads';

export const metadata: Metadata = { title: 'Security', description: 'How ORVYN protects what is yours.' };

export default function Security() {
  return (
    <SitePage title="How your data is protected" line="Plainly: what we do, what we can’t do, and why.">
      <h2>The Vault is zero-knowledge</h2>
      <p>
        Your Vault is locked with a key made on your device from your passphrase (Argon2id). Each item is
        encrypted on the device (XChaCha20-Poly1305) before it is saved. The server stores only ciphertext;
        your key never leaves your devices. We cannot read your Vault, reset it, or hand it to anyone. Your
        recovery key — shown once — is the only way back if you forget the passphrase.
      </p>
      <h2>Everything else is yours alone</h2>
      <ul>
        <li>
          Every request is checked against who you are; nobody else’s data is reachable, including the
          owner’s.
        </li>
        <li>
          Files are encrypted at rest; tokens for connected accounts are sealed and never sent to devices.
        </li>
        <li>
          Sign in with passkeys or a one-time email code — no passwords to leak. Sign out any device remotely.
        </li>
        <li>
          Payment SMS and app alerts are read on your phone; only the amount, merchant and date are synced.
        </li>
      </ul>
      <h2>AI, with rules</h2>
      <ul>
        <li>
          ORVYN’s own rules handle most things; AI is used only when needed, with a strict daily budget.
        </li>
        <li>
          Content is sent as data, never as instructions, and only for the task at hand. Never the Vault.
        </li>
        <li>AI never acts on its own on money, messages or deletion: it proposes, you confirm.</li>
        <li>Your data is never used to train models and never sold.</li>
      </ul>
      <h2>Found a problem?</h2>
      <p>
        Please tell us at <a href={CONTACT}>contact us</a>. We fix first and thank you publicly if you like.
      </p>
    </SitePage>
  );
}
