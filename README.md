# ORVYN

A personal operating system: one private, AI-native app for the things you do every day — tasks, calendar,
money, documents, secrets, people — on phone, web, browser and desktop.

> Status: **planning / foundation.** Start with [`docs/README.md`](docs/README.md).

## What it is

- **One app, many surfaces:** Android (Flutter), web + installable PWA (Next.js, also the iPhone app for now),
  Chrome extension, Windows tray companion.
- **One backend:** Nest.js modular monolith on PostgreSQL. Every feature is a module you can switch on or off
  per person, so friends can use the same deployment with only the features you give them.
- **AI in the middle, not on the side:** drop anything in (photo, voice note, screenshot, PDF, message) and it
  files itself; one assistant that can read and act across all your modules.
- **Private by design:** everything encrypted; secrets live in a vault that even the server cannot read.

## Repository layout (target)

```
apps/
  api/          Nest.js backend (modules = features)
  web/          Next.js web app + PWA
  mobile/       Flutter app (Android now, iOS when an Apple account exists)
  extension/    Chrome extension (quick capture, save page, later vault autofill)
  desktop/      Windows tray companion (notifications, quick capture)
packages/
  design-tokens/  one source of truth for colour, type, motion → CSS variables + Dart
  contracts/      API schemas shared by api, web, extension, desktop (and generated for Dart)
  crypto/         vault / end-to-end encryption primitives (audited libraries only)
docs/           product, architecture, decisions (ADRs), specs
infra/          docker compose, deploy scripts, backups
```

## Related

- [JobOS](https://github.com/shubham-dube/jobos) — the job-search autopilot. Separate system; ORVYN shows its
  jobs, reviews and notifications through its API.

## Run it on your PC

See [docs/guides/run-locally.md](docs/guides/run-locally.md): `pnpm install`, `pnpm setup:local you@email`,
`pnpm db:up`, `pnpm build`, `pnpm dev`.
