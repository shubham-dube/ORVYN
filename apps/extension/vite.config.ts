import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Where each build talks to. Production is the default; `development` = your PC; `e2e` = the test stack. */
const TARGETS: Record<string, { api: string; web: string }> = {
  production: { api: 'https://api.orvyn.dubey.app', web: 'https://orvyn.dubey.app' },
  development: { api: 'http://localhost:4000', web: 'http://localhost:3000' },
  e2e: { api: 'http://localhost:4100', web: 'http://localhost:3100' },
};

/** MV3 manifest, generated so host permissions match the build target. */
function manifest(mode: string, t: { api: string; web: string }): Plugin {
  const devKey = (JSON.parse(readFileSync(resolve(__dirname, 'dev-key.json'), 'utf8')) as { key: string })
    .key;
  return {
    name: 'orvyn-manifest',
    generateBundle() {
      const api = new URL(t.api);
      const m = {
        manifest_version: 3,
        name: mode === 'production' ? 'ORVYN' : `ORVYN (${mode})`,
        description: 'Your ORVYN in Chrome: live notifications now, capture from any page next.',
        version: '0.1.0',
        minimum_chrome_version: '116',
        action: { default_popup: 'popup.html', default_title: 'ORVYN', default_icon: icons() },
        icons: icons(),
        background: { service_worker: 'background.js', type: 'module' },
        // least privilege: no content scripts, no <all_urls>, no tabs read access
        permissions: ['identity', 'storage', 'notifications', 'alarms'],
        host_permissions: [`${api.origin}/*`, `${api.protocol === 'https:' ? 'wss' : 'ws'}://${api.host}/*`],
        content_security_policy: {
          extension_pages: `script-src 'self'; object-src 'self'; connect-src ${api.origin} ${api.protocol === 'https:' ? 'wss' : 'ws'}://${api.host}`,
        },
        // unpacked dev/e2e builds keep a fixed id so the API can allowlist it; the store assigns production's
        ...(mode === 'production' ? {} : { key: devKey }),
      };
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(m, null, 2) });
    },
  };
}

const icons = () => ({
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
});

export default defineConfig(({ mode }) => {
  const t = TARGETS[mode] ?? TARGETS.production!;
  return {
    plugins: [react(), tailwindcss(), manifest(mode, t)],
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(t.api),
      'import.meta.env.VITE_WEB_URL': JSON.stringify(t.web),
    },
    build: {
      outDir: `dist/${mode}`,
      emptyOutDir: true,
      sourcemap: mode !== 'production',
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'popup.html'),
          background: resolve(__dirname, 'src/background.ts'),
        },
        output: {
          entryFileNames: (c) => (c.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        },
      },
    },
    test: { include: ['test/**/*.test.ts'], environment: 'node' },
  };
});
