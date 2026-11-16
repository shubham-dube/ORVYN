# ORVYN for Chrome (Manifest V3)

Live ORVYN notifications in Chrome (badge, native notifications with Open/Dismiss), connected through the web app
— no password typed into the extension. Capture from any page arrives with Drop.

- `src/core.ts` — PKCE, callback checks, API client (refresh token in extension storage, single-flight refresh).
- `src/background.ts` — service worker: connect via `chrome.identity.launchWebAuthFlow` → `/connect` on the web app,
  live socket with keep-alive, badge, notifications. Least privilege: no content scripts, no page access.
- `src/popup.tsx` — Aurora Glass popup.

## Try it locally

1. In the repo's `.env`: `EXTENSION_IDS=hapijaoahockgcidibcnbghpajpnnanh` (the dev id, pinned by `dev-key.json`;
   `pnpm setup:local` adds it for you). Restart `pnpm dev`.
2. `pnpm --filter @orvyn/extension build:dev` (or `dev` to rebuild on change).
3. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension/dist/development`.
4. Click the ORVYN icon → **Connect to ORVYN** → approve in the window that opens.

## Release

`pnpm --filter @orvyn/extension build` → zip `dist/production` → Chrome Web Store. Add the store-assigned id to
`EXTENSION_IDS` on the server (and keep the dev id there only if you still use unpacked builds).

Tests: `pnpm --filter @orvyn/extension test` (logic) and `apps/web/e2e/extension.spec.ts` (real Chromium: connect,
live notification, badge, dismiss, disconnect).
