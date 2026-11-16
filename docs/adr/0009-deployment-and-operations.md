# ADR-0009: Deployment and operations

- Status: Accepted
- Date: 2026-11-16
- Related: ADR-0008, docs/guides/deploy.md, spec 0001 AC6/AC7

## Context

One founder-run server for 5–50 people. It must be cheap, hard to break into, recoverable after a disaster, and
tell the founder when something is wrong — without anyone being on call.

## Options

- Ingress: open 80/443 with Caddy + Let's Encrypt or a Cloudflare origin certificate (firewall must then be limited
  to Cloudflare's IP ranges) **vs** Cloudflare Tunnel (outbound-only, no open ports, free).
- Builds: CI builds multi-arch images and pushes to a registry (needs QEMU for ARM, registry credentials on the
  server) **vs** the server builds natively from a pinned git revision.
- Errors: hosted Sentry (personal data leaves our control) **vs** self-hosted GlitchTip (Sentry protocol).

## Decision

- **Cloudflare Tunnel → Caddy → services.** The server firewall allows only SSH. Caddy routes by host and overwrites
  `X-Forwarded-For` with `CF-Connecting-IP`, so clients cannot spoof their IP past rate limits.
- **Server-side builds of a git revision** (`infra/deploy.sh`): build → migrate → swap → health wait → automatic
  rollback to the previous revision. CI builds the same Dockerfiles on every push so a broken image never reaches
  the server.
- **Backups:** nightly `pg_dump` encrypted with an age public key → Cloudflare R2, kept 35 days; every Sunday the
  newest backup is downloaded, decrypted, restored into a scratch database and checked. Both jobs ping Uptime Kuma;
  a missed ping alerts the founder. Hetzner snapshots are a second, independent layer.
- **Monitoring:** Uptime Kuma (uptime + backup heartbeats + alerts) and GlitchTip (errors) on the same server.
- **Nothing personal in telemetry:** request logs hold only method, masked path and status; error reports carry the
  exception and route template only (no bodies, headers, query strings, user or breadcrumbs).

## Consequences

- RPO is 24 h (nightly dumps). WAL archiving can tighten it later without changing the rest.
- The age identity lives on the server (root-only) so the restore test can run; R2 alone cannot read backups. Keep a
  copy of the identity in the founder's password manager — without it, backups are unrecoverable.
- Deploys need SSH access to the server; there is no registry to secure.
