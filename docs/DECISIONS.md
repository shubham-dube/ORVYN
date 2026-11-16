# Decisions

The founder's choices (newest first). Technical consequences are recorded as ADRs in `adr/`.

## Decided — 2026-11-16
| # | Topic | Decision |
|---|---|---|
| D1 | Name | **ORVYN** (repo `shubham-dube/ORVYN`). The assistant inside is also called Orvyn. |
| D2 | Phones | **Android + iPhone.** Android: native Flutter app on Play Store. iPhone: until there is an Apple developer account, the installable web app (PWA) — with home-screen icon, offline and push notifications. The Flutter app is built iOS-ready so it can ship the day an account exists. |
| D3 | Code layout | **One new monorepo** (this repo). JobOS stays in its own repo and connects through its API. |
| D4 | Documents & AI | **Everything in the Library is AI-readable** (encrypted at rest on the server; the AI can read, categorise and search it). **Secrets go to the Vault**, which is zero-knowledge: unreadable to the server and to the AI. |
| D5 | First feature | Foundation, then **Tasks + Calendar**. |
| D6 | Hosting | **Cheapest setup that still includes everything production needs** (backups, monitoring, TLS, push, file storage). See `architecture/hosting-and-cost.md`. |
| D7 | Design | Glassmorphism, perfectionism in small details, light **and** dark, striking motion, original ideas. See `design/principles.md`. |
| D8 | App stores | Play Store first. No Apple developer account yet. |
| D9 | Users | The founder plus **5–50 friends**, with features enabled per person by the founder. |

## Open — needed before the step that uses them
| # | Question | Needed for | Recommendation |
|---|---|---|---|
| O1 | Approve hosting: Hetzner VPS (~€7–9/month) + Cloudflare R2 + Cloudflare (free) | Foundation deploy | Yes (alternative: Oracle free tier, $0 but can be reclaimed) |
| O2 | Domain: e.g. `orvyn.dubey.app` (+ `api.`) on the existing `dubey.app` | Foundation deploy | Use subdomains of dubey.app |
| O3 | Google Play developer account ($25 one-time) | First Android release (internal testing track) | Create when the Tasks + Calendar MVP is ready |
| O4 | Sign-in methods | Foundation spec | Google + passkeys + email code |
| O5 | Approve the "Aurora Glass" direction (or ask for changes) — see design/principles.md | Foundation (design system) | — |
| O6 | AI provider/key for ORVYN (OpenRouter like JobOS, budget per day) | Drop / Assistant | Reuse OpenRouter, separate key and budget |
| O7 | Banks and UPI apps used | Money | — |
| O8 | Chat encryption library (licences differ) | Chat | decide in Chat spec |
