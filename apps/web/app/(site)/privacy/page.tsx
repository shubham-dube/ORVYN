import type { Metadata } from 'next';
import { SitePage } from '@/components/site';
import { CONTACT } from '@/lib/downloads';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What ORVYN keeps, why, and your choices.',
};

export default function Privacy() {
  return (
    <SitePage title="Privacy" line="Last updated 19 November 2026. Plain words, no tricks.">
      <h2>What we keep</h2>
      <ul>
        <li>Your account: email, name, the devices you signed in on.</li>
        <li>
          What you put in ORVYN: tasks, events, notes, transactions, documents, and your encrypted Vault.
        </li>
        <li>For connected accounts (Google, ClickUp): sealed tokens, only to do what you asked.</li>
        <li>Usage counts for AI (how many calls and their cost) — never the content.</li>
      </ul>
      <h2>What we don’t do</h2>
      <ul>
        <li>No ads, no selling or sharing your data, no tracking across other sites.</li>
        <li>No training of AI models on your data.</li>
        <li>No reading of your Vault — we can’t.</li>
      </ul>
      <h2>Who processes it</h2>
      <p>
        ORVYN runs on cloud servers (Google Cloud, Vercel, Cloudflare R2 for files). When you use an AI
        feature, the content needed for that one task is sent to the model provider (via OpenRouter) and not
        kept by them for training. Push notifications go through Google (Android) or your browser’s push
        service.
      </p>
      <h2>Google user data</h2>
      <p>
        If you connect a Google account, ORVYN uses Calendar to show and change your events and create Meet
        meetings you ask for, and (only if you add it) Gmail read-only to show your unread mail. This data is
        used only to provide those features to you, is not shared, and is deleted when you disconnect.
      </p>
      <h2>Your choices</h2>
      <ul>
        <li>Disconnect any account or device at any time from Settings.</li>
        <li>Export your data, or ask us to delete your account and everything in it.</li>
      </ul>
      <p>
        Questions: <a href={CONTACT}>contact us</a>.
      </p>
    </SitePage>
  );
}
