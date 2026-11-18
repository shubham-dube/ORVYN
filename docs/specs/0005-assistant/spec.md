# Spec 0005: Assistant (and the finished `ai` module)

Status: Approved scope (roadmap step 5; D13, D19, D25) · Phase 5 · Module: `assistant` (teal)

## Problem

Answers and small changes are spread across modules. The Assistant answers from your data and does small things when
you ask, but never changes anything without your tap.

## User stories

- "What's on tomorrow?", "How much did I spend on food this month?", "When does my insurance expire?", "Find the rent
  agreement" — answered from my own data with the sources shown.
- "Remind me to call Priya at 6 by alarm", "Add 240 for lunch yesterday", "Move my dentist task to Friday" → it
  proposes exactly that; I confirm or change it.
- It never sees the Vault, never acts silently on money, messages or deletion, and treats document text as data.

## Scope

**In:** threads and messages (owner-scoped), a tool loop on the `ai` module with **read** tools (agenda, tasks,
Money summary/search, Library search, Drop inbox) and **proposals** (create task / reminder, create event, add
expense, save note, complete task, move task), confirm/dismiss, sources, history, web + Android + command bar entry;
`ai` module completion: usage ledger views (person and owner), per-task routes, timeouts/retries, status and limits in
Settings.
**Out (later):** voice conversations, proactive nudges (Brief), actions on Chat or the Vault.

## Acceptance criteria

- [ ] AC1 Questions about agenda, tasks, spending and documents are answered from the person's data only (tests with
      two people).
- [ ] AC2 Every change is a proposal; nothing is created until confirmed; confirming applies exactly what was shown;
      stale proposals (task gone) fail safely.
- [ ] AC3 No tool reads the Vault; text in documents/messages can't trigger actions (injection test).
- [ ] AC4 The $1/day cap is respected; paused state is shown in the chat.
- [ ] AC5 Usage by day/task/person is visible to the person (their own) and the owner (everyone's).
