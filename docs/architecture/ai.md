# AI

## Where a strong model (Fable / Opus) earns its cost
| Job | Model tier | Why |
|---|---|---|
| **Drop understanding** — photo/voice/screenshot/PDF → typed object with fields | strong | messy multimodal input, Indian formats (UPI, ₹, dates), many target types |
| **Assistant** — plan across modules, call tools, confirm | strong | multi-step reasoning, correctness matters |
| **IPO analyst** — read a 300–400 page RHP + financials + peers → reasoned verdict | strong, long context | depth of reading; cited reasoning |
| Library auto-organise (title, tags, collection, expiry, amounts) | mid | high volume, structured |
| Transaction categorisation / merchant clean-up | small (+ rules learned from corrections) | very high volume, cheap |
| Natural-language task/event parsing | rules first, small model fallback | must be instant |
| Embeddings for search/RAG | **local model on the server** (free) | volume; privacy |

All calls go through the `ai` module: routing per task (like JobOS), daily budget per person, tracing,
structured outputs with validation, prompt caching for stable context.

## Guarantees
- Sources shown for every answer built from your data.
- Anything consequential (money entries, sending messages, deleting, changing events with other people) is a
  **proposal** that needs a tap.
- Vault never enters AI context. Content from files/web/messages is data, never instructions.
- Corrections are stored and reused (few-shot memory per person), so it gets better at *your* life.

## RAG over your data
Chunks from Library documents, notes, tasks, events, transactions (summaries), chat (only if E2E keys allow —
by default chat stays out of server-side AI). Hybrid retrieval (full-text + pgvector) scoped to the person
and to modules they have enabled.
