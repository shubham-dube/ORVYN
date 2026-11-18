# ADR-0010: One AI gateway with a daily cap

- Status: Accepted
- Date: 2026-11-18
- Related: D13, D19, AGENTS.md ("LLM calls go only through the `ai` module"), spec 0003

## Context

Drop, the Today parser fallback and later the Assistant need a model. Cost must stay inside a cap the founder
sets, every call must be accountable, and text from documents, messages and pages must never steer the model
into acting.

## Decision

- An api module `ai` is the only code that talks to a model. Callers name a **task** (`drop.understand`,
  `today.parse`); the module picks the route (`AI_ROUTES`, default Fable for Drop per D13) and provider
  (OpenRouter; a deterministic fake in tests and e2e).
- **Structured output only**: callers pass a zod schema; the reply is parsed, repaired once, then rejected. The
  model can only propose data — it has no tools and nothing it returns is executed. Untrusted content is wrapped
  and labelled as data in the prompt.
- **Daily cap** (`AI_DAILY_BUDGET_USD`, $1 by D19) across all people, checked before each call from the
  `ai_usage` ledger (task, model, tokens, cost, owner, time). When reached, calls fail with `ai_paused` and
  callers keep the work waiting until the next day (in the founder's time zone). Raising it is the founder's call.
- Per-person fairness: a person may use at most half of the day's cap, so one friend can't use it all up.

## Consequences

Work that needs AI is asynchronous (queued), visible as "waiting" when paused, and tested without a network.
