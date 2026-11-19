import type { Metadata } from 'next';
import { SiteHeading } from '@/components/site';

export const metadata: Metadata = { title: 'FAQ', description: 'Questions people ask about ORVYN.' };

const QA: [string, string][] = [
  [
    'How do I join?',
    'ORVYN is invite-only while it grows. Someone already on ORVYN can invite you; you sign in with the email they invited.',
  ],
  ['Does it cost anything?', 'Not while it’s invite-only.'],
  [
    'Which devices?',
    'Android (the full app), Windows (tray app), the Chrome extension, and any browser — installable on iPhone and Mac as an app.',
  ],
  [
    'Does ORVYN read my SMS?',
    'Only payment alerts from banks and UPI apps, on your phone, and only if you turn it on. The messages never leave the phone; just the amount, merchant and date are synced.',
  ],
  [
    'Can you see my passwords?',
    'No. The Vault is encrypted on your device with a key we never have. If you lose both your passphrase and your recovery key, nobody can open it — not even us.',
  ],
  [
    'Why does an alarm not ring on my phone?',
    'Android needs a few permissions: Settings → Notifications in ORVYN shows a checklist (alarms & reminders, full-screen, battery) with a button for each.',
  ],
  [
    'I don’t get notifications on Windows.',
    'Install the Windows tray app, or turn on notifications in the browser (Settings → Notifications → Turn on) and allow Chrome/Edge in Windows’ notification settings. Settings → Your devices → Test shows exactly what happened.',
  ],
  [
    'Can I connect more than one Google account?',
    'Yes — as many as you use. Each can schedule Meet meetings; Gmail is an optional add-on per account.',
  ],
  [
    'Does AI decide things for me?',
    'No. It suggests and explains why. Anything about money, messages or deleting waits for your tap.',
  ],
  [
    'Can I get my data out?',
    'Yes: Money exports to spreadsheets, documents download as they were, and you can ask for everything.',
  ],
];

export default function Faq() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 px-5 pt-10">
      <SiteHeading eyebrow="FAQ" title="Questions, answered." />
      <div className="flex flex-col gap-2">
        {QA.map(([q, a]) => (
          <details key={q} className="glass-pane group p-5 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold">
              {q}
              <span className="text-orv-muted transition-transform group-open:rotate-45" aria-hidden>
                +
              </span>
            </summary>
            <p className="mt-3 text-[15px] leading-relaxed text-orv-muted">{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
