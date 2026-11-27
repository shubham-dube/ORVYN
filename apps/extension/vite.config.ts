import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Where each build talks to. Production is the default; `development` = your PC; `e2e` = the test stack.
 * A self-hosted server: set VITE_API_URL and VITE_WEB_URL when building (the release workflow does).
 */
const live = {
  api: process.env.VITE_API_URL || 'https://api.orvyn.dubey.app',
  web: process.env.VITE_WEB_URL || 'https://orvyn.dubey.app',
};
const TARGETS: Record<string, { api: string; web: string }> = {
  production: live,
  store: live,
  development: { api: 'http://localhost:4000', web: 'http://localhost:3000' },
  e2e: { api: 'http://localhost:4100', web: 'http://localhost:3100' },
};

const readKey = (f: string) =>
  (JSON.parse(readFileSync(resolve(__dirname, f), 'utf8')) as { key: string }).key;

/** MV3 manifest, generated so host permissions match the build target. */
function manifest(mode: string, t: { api: string; web: string }): Plugin {
  return {
    name: 'orvyn-manifest',
    generateBundle() {
      const api = new URL(t.api);
      const ws = `${api.protocol === 'https:' ? 'wss' : 'ws'}://${api.host}`;
      const m = {
        manifest_version: 3,
        name: mode === 'production' || mode === 'store' ? 'ORVYN' : `ORVYN (${mode})`,
        description: 'Keep, fill, find and remember anything on the web, and see where your day went.',
        version: '0.2.0',
        minimum_chrome_version: '127',
        action: { default_popup: 'popup.html', default_title: 'ORVYN', default_icon: icons() },
        icons: icons(),
        background: { service_worker: 'background.js', type: 'module' },
        side_panel: { default_path: 'panel.html' },
        omnibox: { keyword: 'o' },
        incognito: 'not_allowed',
        commands: {
          _execute_action: { suggested_key: { default: 'Alt+Shift+O' } },
          'drop-page': { suggested_key: { default: 'Alt+Shift+D' }, description: 'Drop this page' },
          'fill-page': { suggested_key: { default: 'Alt+Shift+F' }, description: 'Fill this form' },
        },
        permissions: [
          'identity',
          'storage',
          'unlimitedStorage',
          'notifications',
          'alarms',
          'tabs',
          'scripting',
          'contextMenus',
          'sidePanel',
          'idle',
          'webNavigation',
        ],
        // every site, for filling, Recall and My Day (D-0020-1); passwords never go through a page's own script
        host_permissions: ['http://*/*', 'https://*/*'],
        content_scripts: [
          {
            matches: ['http://*/*', 'https://*/*'],
            js: ['content.js'],
            all_frames: true,
            run_at: 'document_idle',
          },
        ],
        content_security_policy: {
          // wasm: libsodium (the Vault); images from pages are fetched to be dropped
          extension_pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src ${api.origin} ${ws} https: http: data:`,
        },
        // unpacked builds keep a fixed id so the API can allowlist it; the store gives its own
        ...(mode === 'store'
          ? {}
          : { key: readKey(mode === 'production' ? 'prod-key.json' : 'dev-key.json') }),
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
      sourcemap: mode !== 'production' && mode !== 'store',
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'popup.html'),
          panel: resolve(__dirname, 'panel.html'),
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
