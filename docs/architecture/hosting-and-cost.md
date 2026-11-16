# Hosting & cost

Goal (D6): the cheapest setup that still has everything production needs.

## Recommended
| Piece | Choice | Cost / month |
|---|---|---|
| Server | **Hetzner Cloud CAX21** (4 ARM vCPU, 8 GB RAM, 80 GB), Docker Compose: api, workers, web, Postgres, Valkey | ~€7 |
| Files | **Cloudflare R2** (10 GB free, no egress fees) | €0 → ~$0.015/GB after |
| DNS, TLS, CDN, DDoS | **Cloudflare** free plan, subdomains of `dubey.app` | €0 |
| Push | FCM (Android), Web Push/VAPID (web + iPhone PWA) | €0 |
| Email | Resend (already set up for JobOS) | €0 (free tier) |
| Backups | nightly encrypted `pg_dump` + WAL archive → R2 (separate bucket, separate key); weekly automatic restore test | ~€0 |
| Monitoring | Uptime Kuma + GlitchTip (Sentry-compatible) self-hosted on the same server; alerts to email/WhatsApp | €0 |
| Server snapshots | Hetzner backups (+20%) | ~€1.5 |
| **Total** | | **≈ €9/month + AI usage** |

AI usage is controlled by per-person daily budgets; cheap models do the volume work, strong models only where
listed in `ai.md`.

Alternatives: Oracle Cloud "Always Free" ARM (4 cores, 24 GB, $0) — viable but free instances can be
reclaimed and support is minimal; a Hetzner Singapore server — lower latency from India for a few euros more.
Scaling path: a second server for workers, then managed Postgres — only when needed.
