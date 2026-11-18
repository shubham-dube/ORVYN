// Renders the brand SVGs (brand/*.svg) into every icon the apps need, with Chromium for exact gradients and glow.
//   node scripts/brand-render.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const svg = (name) => readFileSync(join(root, 'brand', name), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();

/** Draw an SVG at `size`, optionally inside a padded square (for maskable/adaptive icons). */
async function png(file, source, size, { pad = 0, background = 'transparent' } = {}) {
  const inner = Math.round(size * (1 - pad * 2));
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:${background};width:${size}px;height:${size}px;display:grid;place-items:center">` +
      `<div style="width:${inner}px;height:${inner}px">${source.replace('<svg ', `<svg style="width:${inner}px;height:${inner}px" `)}</div></body></html>`,
  );
  const out = join(root, file);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: background === 'transparent', clip: { x: 0, y: 0, width: size, height: size } });
}

const mark = svg('mark.svg');
const glyph = svg('glyph.svg');
const mono = svg('mono.svg');
const night = 'radial-gradient(circle at 28% 18%, #1d2f7a, #0b1236 50%, #04060e)';

// web (favicon, PWA, Apple, notifications)
for (const s of [48, 96, 180, 192, 512]) await png(`apps/web/public/icons/icon-${s}.png`, mark, s);
await png('apps/web/public/icons/maskable-512.png', glyph, 512, { pad: 0.16, background: night });
await png('apps/web/public/icons/badge-96.png', mono, 96);
writeFileSync(join(root, 'apps/web/app/icon.svg'), mark);
writeFileSync(join(root, 'apps/web/public/brand/mark.svg'), mark);
writeFileSync(join(root, 'apps/web/public/brand/glyph.svg'), glyph);

// Android launcher: legacy square icons and adaptive (foreground glyph on the night background), status-bar icon
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(densities)) {
  const res = `apps/mobile/android/app/src/main/res`;
  await png(`${res}/mipmap-${d}/ic_launcher.png`, mark, Math.round(48 * k));
  await png(`${res}/mipmap-${d}/ic_launcher_foreground.png`, glyph, Math.round(108 * k), { pad: 0.2 });
  await png(`${res}/mipmap-${d}/ic_launcher_monochrome.png`, mono, Math.round(108 * k), { pad: 0.24 });
  await png(`${res}/drawable-${d}/ic_stat_orvyn.png`, mono, Math.round(24 * k), { pad: 0.04 });
  await png(`${res}/drawable-${d}/splash_logo.png`, glyph, Math.round(160 * k));
}

// Chrome extension
for (const s of [16, 32, 48, 128]) await png(`apps/extension/public/icons/icon-${s}.png`, mark, s);

// Windows tray app
await png('apps/desktop/src-tauri/icons/32x32.png', mark, 32);
await png('apps/desktop/src-tauri/icons/128x128.png', mark, 128);
await png('apps/desktop/src-tauri/icons/128x128@2x.png', mark, 256);
await png('apps/desktop/src-tauri/icons/icon.png', mark, 512);
for (const s of [16, 24, 32, 48, 64, 256]) await png(`brand/out/ico-${s}.png`, mark, s);

// social preview (landing page)
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<html><body style="margin:0;width:1200px;height:630px;background:${night};font-family:'Inter Display',Inter,sans-serif;color:#fff;display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box">
  <div style="width:300px;height:300px;flex:none">${glyph.replace('<svg ', '<svg style="width:300px;height:300px" ')}</div>
  <div><div style="font-size:92px;font-weight:700;letter-spacing:14px">ORVYN</div>
  <div style="font-size:36px;line-height:1.3;color:#c7d2fe;margin-top:18px;max-width:640px">Your whole life, in one private place.<br/>Tasks, money, documents and secrets — with AI that asks before it acts.</div></div></body></html>`);
await page.screenshot({ path: join(root, 'apps/web/public/brand/og.png') });
await browser.close();
console.log('brand rendered');
