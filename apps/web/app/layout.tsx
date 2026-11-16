import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Aurora } from '@/components/ui/aurora';
import { themeBootScript } from '@/lib/theme';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'ORVYN', template: '%s · ORVYN' },
  description: 'Your private operating system for everyday life.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'ORVYN', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/192', apple: '/icons/180' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#eaf3fb',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      data-phase="day"
      suppressHydrationWarning
    >
      <head>
        {/* set the light before first paint, so the page never flashes the wrong phase */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body style={{ fontFamily: 'var(--font-geist-sans), var(--orv-font-sans)' }}>
        <Aurora />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
