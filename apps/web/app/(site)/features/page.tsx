import type { Metadata } from 'next';
import { SiteButton, SiteHeading } from '@/components/site';

export const metadata: Metadata = { title: 'Features', description: 'What ORVYN does, part by part.' };

const PARTS: { name: string; tag: string; points: string[] }[] = [
  {
    name: 'Today',
    tag: 'Tasks and calendar on one river of time',
    points: [
      'Type the way you speak — English or Hinglish: “pay rent every 1st”, “kal shaam 6 baje call mom”.',
      'List, board and calendar views; projects, tags, priorities, subtasks, saved filters.',
      'Reminders any way you like: notification, hard notification that comes back, a real alarm, email or WhatsApp.',
      'Several Google Calendars, both ways; plan my day fits tasks into your free time.',
      'Schedule a meeting with a Google Meet link — Google sends the invitations.',
    ],
  },
  {
    name: 'Drop',
    tag: 'One inbox for everything',
    points: [
      'Type, speak, photograph a receipt, share a link or a file from any app.',
      'ORVYN proposes what it is — task, event, expense or note — with a reason. You confirm.',
      'Plain text it understands is handled without any AI at all.',
    ],
  },
  {
    name: 'Money',
    tag: 'Spending that writes itself',
    points: [
      'Bank SMS and UPI app alerts become entries on your phone — the messages never leave it.',
      'A notification asks what each payment was: tap a category, reply “split 3”, or “not mine”.',
      'It learns merchants from your answers; budgets, repeating bills, statements, exports.',
    ],
  },
  {
    name: 'Library',
    tag: 'Papers that organise themselves',
    points: [
      'Upload a PDF or a photo: it’s titled, tagged, summarised and searchable in plain words.',
      'Expiry dates become reminders; amounts due become Money suggestions.',
      'Open photos, PDFs, voice notes, videos and spreadsheets right inside ORVYN.',
    ],
  },
  {
    name: 'Vault',
    tag: 'Secrets only your devices can open',
    points: [
      'Passwords, cards, IDs and notes, encrypted on your device before they’re saved.',
      'A recovery key you keep; lock on a timer; copy that clears itself.',
    ],
  },
  {
    name: 'Connections and people',
    tag: 'Your accounts, your family',
    points: [
      'Google (Calendar, Meet, Gmail) and ClickUp — several of each. More services coming.',
      'Invite family or friends and choose exactly which parts they get. Their data stays theirs.',
    ],
  },
];

export default function Features() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-14 px-5 pt-10">
      <SiteHeading eyebrow="Features" title="Everything ORVYN does — and how it stays out of your way." />
      {PARTS.map((p, i) => (
        <section key={p.name} className="grid gap-6 md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <span className="text-[13px] font-semibold text-orv-accent">0{i + 1}</span>
            <h2 className="mt-1 text-[28px] font-semibold">{p.name}</h2>
            <p className="text-[16px] text-orv-muted">{p.tag}</p>
          </div>
          <ul className="glass-pane flex flex-col gap-3 p-6">
            {p.points.map((t) => (
              <li key={t} className="flex gap-3 text-[15px] leading-relaxed">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full [background:var(--orv-accent-grad)]" />
                {t}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <div className="flex justify-center gap-3">
        <SiteButton href="/sign-in" primary>
          Open ORVYN
        </SiteButton>
        <SiteButton href="/download">Get the apps</SiteButton>
      </div>
    </div>
  );
}
