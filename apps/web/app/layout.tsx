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
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-48.png', sizes: '48x48' },
    ],
    apple: '/icons/icon-180.png',
  },
  openGraph: {
    title: 'ORVYN',
    description: 'Your private operating system for everyday life.',
    images: [{ url: '/brand/og.png', width: 1200, height: 630 }],
  },
  twitter: { card: 'summary_large_image', images: ['/brand/og.png'] },
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
