# ORVYN for Chrome (Manifest V3)

Keep, fill, find and remember anything on the web, and see where the day went (spec 0020, ADR-0017, ADR-0018).

| File                             | What it does                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/background.ts`              | Service worker: connect, live notifications, menus, shortcuts, address bar, all of the below |
| `src/page/content.ts`, `form.ts` | In every page, isolated: counts, text, sign-ins, reading and filling forms                   |
| `src/match.ts`                   | Which fact answers which field; which login fits which site                                  |
| `src/vault.ts`                   | The Vault: key in session memory only                                                        |
| `src/tracker.ts`                 | My Day spans                                                                                 |
| `src/recall.ts`                  | Pages read and prices seen, on this device only                                              |
| `src/popup.tsx`, `tabs.tsx`      | The popup and the side panel                                                                 |

## Try it

1. `pnpm --filter @orvyn/extension build` (your real ORVYN) or `build:dev` (local stack).
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension/dist/production` (or
   `dist/development`).
3. Click the icon → **Connect to ORVYN** → approve.

The ids are pinned: production `dbliehpgdjiimgfigjkbmbholcnoffek`, development `hapijaoahockgcidibcnbghpajpnnanh`. The API
accepts only ids in `EXTENSION_IDS` (several, separated by commas).

## The Web Store

`pnpm --filter @orvyn/extension build:store`, zip `dist/store`, upload as **Unlisted**, then add the id the store gives to
`EXTENSION_IDS`. The review asks why each permission is needed:

- all sites, `scripting`, `webNavigation`: fill forms and saved logins on any site; `tabs`, `idle`: My Day;
  `contextMenus`, `sidePanel`, `notifications`, `alarms`, `storage`, `unlimitedStorage`, `identity`: the features named.

`store-key.pem` (git-ignored) is the private half of the production id. Nothing needs it day to day; keep a copy somewhere
safe if you want to keep that id.

## Tests

`pnpm --filter @orvyn/extension test` (logic) · `apps/web/e2e/extension.spec.ts` and `zzz-extension-brain.spec.ts` (real
Chromium).
