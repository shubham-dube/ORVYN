import { Chrome, Download, Globe, Monitor, Smartphone } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteButton, SiteHeading } from '@/components/site';
import { DOWNLOADS } from '@/lib/downloads';

export const metadata: Metadata = {
  title: 'Download',
  description: 'ORVYN for Android, Windows, Chrome and every browser.',
};

function Card({
  icon,
  name,
  line,
  children,
  steps,
}: {
  icon: ReactNode;
  name: string;
  line: string;
  children: ReactNode;
  steps: string[];
}) {
  return (
    <li className="glass-pane flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-[15px] text-white [background:var(--orv-accent-grad)]">
          {icon}
        </span>
        <div>
          <h2 className="text-[20px] font-semibold">{name}</h2>
          <p className="text-[14px] text-orv-muted">{line}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-[14px] text-orv-muted">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </li>
  );
}

export default function DownloadPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-12 px-5 pt-10">
      <SiteHeading eyebrow="Download" title="ORVYN on every device you use.">
        Sign in once on each; everything stays in step. The newest builds are always here.
      </SiteHeading>
      <ul id="install" className="grid gap-4 md:grid-cols-2">
        <Card
          icon={<Smartphone size={22} aria-hidden />}
          name="Android"
          line="Android 8 and newer"
          steps={[
            'Download the APK on your phone.',
            'Open it; if asked, allow installs from your browser (Settings → Install unknown apps).',
            'Sign in, allow notifications, and in Settings → Notifications tick the alarm checklist.',
          ]}
        >
          <SiteButton href={DOWNLOADS.android} primary download>
            <Download size={16} aria-hidden /> Download APK
          </SiteButton>
        </Card>
        <Card
          icon={<Monitor size={22} aria-hidden />}
          name="Windows"
          line="Windows 10 and 11 · tray app"
          steps={[
            'Run the installer (Windows may ask “More info → Run anyway” for a new app).',
            'It opens ORVYN in your browser to connect — approve it.',
            'It lives in the tray: notifications, and Ctrl+Shift+Space to add anything.',
          ]}
        >
          <SiteButton href={DOWNLOADS.windows} primary download>
            <Download size={16} aria-hidden /> Download for Windows
          </SiteButton>
        </Card>
        <Card
          icon={<Chrome size={22} aria-hidden />}
          name="Chrome extension"
          line="Chrome, Edge, Brave"
          steps={
            DOWNLOADS.chromeStore
              ? ['Add it from the Chrome Web Store.', 'Click the ORVYN icon and connect.']
              : [
                  'Download the zip and unzip it into a folder you keep.',
                  'Open chrome://extensions, turn on Developer mode, then “Load unpacked” and pick the folder.',
                  'Click the ORVYN icon and connect.',
                ]
          }
        >
          {DOWNLOADS.chromeStore ? (
            <SiteButton href={DOWNLOADS.chromeStore} primary external>
              <Chrome size={16} aria-hidden /> Add to Chrome
            </SiteButton>
          ) : (
            <SiteButton href={DOWNLOADS.chromeZip} primary download>
              <Download size={16} aria-hidden /> Download extension
            </SiteButton>
          )}
        </Card>
        <Card
          icon={<Globe size={22} aria-hidden />}
          name="Web — and iPhone, Mac"
          line="Any modern browser"
          steps={[
            'Open ORVYN and sign in.',
            'iPhone: Share → Add to Home Screen. Mac/PC: the install icon in the address bar.',
            'Settings → Notifications → Turn on, to get them while the tab is closed.',
          ]}
        >
          <SiteButton href="/sign-in" primary>
            Open ORVYN
          </SiteButton>
        </Card>
      </ul>
      <p className="text-[14px] text-orv-muted">
        Every build, with its notes:{' '}
        <a href={DOWNLOADS.releases} className="text-orv-accent underline" target="_blank" rel="noreferrer">
          all releases
        </a>
        .
      </p>
    </div>
  );
}
