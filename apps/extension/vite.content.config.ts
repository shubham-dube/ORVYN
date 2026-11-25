import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** The content script: one plain file (content scripts can't be modules), added to what the main build made. */
export default defineConfig(({ mode }) => ({
  build: {
    outDir: `dist/${mode}`,
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, 'src/page/content.ts'),
      formats: ['iife'],
      name: 'orvynPage',
      fileName: () => 'content.js',
    },
  },
}));
