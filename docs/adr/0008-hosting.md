# ADR-0008: Hosting

- Status: Accepted (founder: D6, cheapest with nothing cut) · Date: 2026-11-16 · Related: hosting-and-cost.md

## Decision

One Hetzner ARM VPS with Docker Compose (api, workers, web, Postgres, Valkey, monitoring), Cloudflare in front,
Cloudflare R2 for files and encrypted backups. ≈ €9/month plus AI usage.
