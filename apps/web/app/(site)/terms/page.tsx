import type { Metadata } from 'next';
import { SitePage } from '@/components/site';
import { CONTACT } from '@/lib/downloads';

export const metadata: Metadata = { title: 'Terms', description: 'The terms for using ORVYN.' };

export default function Terms() {
  return (
    <SitePage title="Terms of use" line="Last updated 19 November 2026.">
      <h2>Using ORVYN</h2>
      <p>
        ORVYN is a personal app offered by invitation. Use it lawfully and for yourself; don’t try to reach
        other people’s data, overload the service or break its security.
      </p>
      <h2>Your content</h2>
      <p>
        What you put in ORVYN is yours. You let us store and process it only to run ORVYN for you. You can
        take it out or delete it at any time.
      </p>
      <h2>Suggestions are suggestions</h2>
      <p>
        ORVYN reads messages, receipts and documents to suggest tasks, entries and dates. Check what matters —
        especially money and deadlines — before relying on it.
      </p>
      <h2>Availability</h2>
      <p>
        We work to keep ORVYN running and your data safe, with backups, but it is provided as is while it is
        invite-only. Features may change.
      </p>
      <h2>Contact</h2>
      <p>
        <a href={CONTACT}>contact us</a>
      </p>
    </SitePage>
  );
}
