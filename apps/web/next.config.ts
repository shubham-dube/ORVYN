import { join } from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  // the container image builds standalone; local `next start` (e2e) needs the normal output
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // trace workspace packages from the monorepo root so the standalone server is self-contained
  outputFileTracingRoot: join(__dirname, '../..'),
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@orvyn/contracts', '@orvyn/design-tokens', '@orvyn/sync-client'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(self), geolocation=(self), payment=()',
          },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default config;
