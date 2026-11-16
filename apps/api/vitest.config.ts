import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // decorator metadata for Nest DI; the cast bridges two peer-resolved copies of vite's Plugin type in the workspace
  plugins: [swc.vite({ module: { type: 'es6' } }) as never],
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false, // one shared test database
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
