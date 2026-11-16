// Cross-platform `pnpm dev` for the API (Windows has no `&`): tsc in watch mode, node restarts on rebuilt output.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const tscBin = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const tsc = spawn(
  process.execPath,
  [tscBin, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'],
  { stdio: 'inherit' },
);
let api;
const start = () => {
  api = spawn(process.execPath, ['--watch', '--enable-source-maps', 'dist/main.js'], { stdio: 'inherit' });
};
const wait = setInterval(() => {
  if (existsSync('dist/main.js')) {
    clearInterval(wait);
    start();
  }
}, 500);
const stop = () => {
  tsc.kill();
  api?.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
