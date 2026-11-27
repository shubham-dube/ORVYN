# 0019 — Notifications, everywhere, set your way

Status: **In progress**, 2026-11-24. Decisions: D-0019-1…7. Builds on spec 0001 (the notify pipeline), D22
(reminder ways) and D23 (WhatsApp to myself).

## Why

Every module already sends notifications through one pipeline: the inbox, the live socket, web push, Android FCM,
email copies, WhatsApp copies, alarms, and repeats until acknowledged. The settings are much coarser than that:

- quiet hours;
- "email me for urgent";
- mute a whole module.

Today reminders and Library expiry have their own channel choices; nothing else does. I can't say "IPO closing
day: ring my phone", "Split: in-app only" or "card bill due: also email me".

## The channels (D-0019-1)

| Channel      | What it is                                                                                        | Where it works                 |
| ------------ | ------------------------------------------------------------------------------------------------- | ------------------------------ |
| **In-app**   | the bell and the inbox, on every device, live                                                     | always, unless the type is off |
| **Push**     | the phone's shade (FCM) and browser notifications (web push)                                      | Android, browsers              |
| **Urgent**   | push that ignores quiet hours and module mute, and comes back every 5 min (×6) until acknowledged | Android, browsers              |
| **Alarm**    | urgent, and it rings like an alarm clock                                                          | Android                        |
| **Email**    | a copy to my sign-in address                                                                      | everywhere                     |
| **WhatsApp** | a copy to my confirmed number (D23) — off until a number is confirmed                             | WhatsApp                       |

## The rule (D-0019-2)

- **Every notification has a type.** For each type I choose:
  - **On** or **Off**. Off means nothing at all, not even the inbox. Security types can't be turned off.
  - **The ways**, any of: Push, Urgent, Alarm, Email, WhatsApp. None chosen means in-app only.
- **Each type comes with a sensible default,** shown in the table below.
- **Something I set on the item itself wins:** a task's own reminder ways, a document's expiry ways. These types
  say "set on each task / document" and their defaults live where they always did (Today → Reminders, Library).
- **Quiet hours and module mute still apply to everything except Urgent and Alarm.**
- **Each type has "Send me a sample",** to hear what an alarm sounds like or to check that email arrives. On
  Android, **"Send one of each"** sends a sample of every kind that is on, six seconds apart, each through its own
  ways, with progress and Stop: the whole set-up tested end to end.

## The catalog (D-0019-3) — what, when, and the default

Each row below is one type. All of them are listed in the app under Settings → Notifications, grouped by module.

**Security** (always on):

| Type        | When it fires                   | Default     | Can be              |
| ----------- | ------------------------------- | ----------- | ------------------- |
| New sign-in | a device signs in to my account | Push, Email | any ways; never off |

**Today**:

| Type                        | When it fires                                               | Default                      | Can be    |
| --------------------------- | ----------------------------------------------------------- | ---------------------------- | --------- |
| Task reminders              | at each reminder time of a task                             | per task (Today → Reminders) | per task  |
| Event reminders             | before each event, as set                                   | per event / Today defaults   | per event |
| Morning list                | the day's dated tasks, at the digest time                   | Push                         | any       |
| Calendar needs reconnecting | Google refused the calendar link                            | Push, Email                  | any       |
| From your tools             | GitHub review requested / assigned; ClickUp due or assigned | Push                         | any       |

**Brief**:

| Type                | When it fires                                         | Default | Can be |
| ------------------- | ----------------------------------------------------- | ------- | ------ |
| Your Brief is ready | the morning Brief, at its time                        | Push    | any    |
| Things slipped      | 3+ overdue tasks, once a day                          | Push    | any    |
| Budget nudge        | a budget at 80% (with ⅓ of the month left) or used up | Push    | any    |
| Payments to look at | 5+ unreviewed payments in a day                       | Push    | any    |
| Drop is filling up  | 3+ things waiting in Drop                             | Push    | any    |

**Mail**:

| Type           | When it fires                                                  | Default | Can be |
| -------------- | -------------------------------------------------------------- | ------- | ------ |
| Important mail | new mail ORVYN rates as needing me (a reply, a bill, security) | Push    | any    |

**Money**:

| Type                     | When it fires                                                                                                      | Default | Can be     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------- | ---------- |
| A payment to file        | a payment read from the phone (bank message or notification) that ORVYN can't file alone; money in waits for a yes | Push    | any        |
| Filed for you            | ORVYN filed a payment by my rule; a quiet note with Change                                                         | In-app  | any        |
| Bill or subscription due | a recurring payment is due                                                                                         | Push    | any; Alarm |

**Library**:

| Type              | When it fires                                     | Default                | Can be       |
| ----------------- | ------------------------------------------------- | ---------------------- | ------------ |
| Document expiring | a passport, insurance or licence nearing its date | per document (Library) | per document |

**Chat**:

| Type        | When it fires                       | Default | Can be |
| ----------- | ----------------------------------- | ------- | ------ |
| New message | a message in a chat I haven't muted | Push    | any    |

**Split**:

| Type             | When it fires                  | Default | Can be |
| ---------------- | ------------------------------ | ------- | ------ |
| Added to a group | someone adds me                | Push    | any    |
| New expense      | someone adds an expense I'm in | Push    | any    |
| Payment recorded | someone settles with me        | Push    | any    |
| You owe          | someone sends me a reminder    | Push    | any    |

**IPO**:

| Type                      | When it fires                                                                  | Default | Can be     |
| ------------------------- | ------------------------------------------------------------------------------ | ------- | ---------- |
| IPO alerts                | opening / closing / GMP moves / allotment / listing, as the desk's filters say | Push    | any        |
| A partner reported        | a partner taps "I applied / mandate / allotted / sold" on their link           | Push    | any        |
| Last day: not applied yet | 10 am on the close day, with accounts not applied or mandates pending          | Push    | any; Alarm |
| Bids closed               | the round's close summary at 5 pm                                              | Push    | any        |

The Vault sends nothing about what it holds. It is zero-knowledge (ADR-0004), so only the security types touch it.

## Decisions

- **D-0019-1** The channels are In-app, Push, Urgent, Alarm, Email and WhatsApp. WhatsApp to partners stays a
  message I send myself (spec 0018), never automatic.
- **D-0019-2** Rules are per type, kept in the person's notify settings. The item's own ways win over the type's
  rule.
- **D-0019-3** The catalog lives in `packages/contracts` (one list for the API, web and Android). A test fails when
  code sends a notification whose type isn't in the catalog.
- **D-0019-4** Off means no inbox row either (stored dismissed, so actions and dedupe still behave). Security can't
  be turned off.
- **D-0019-5** WhatsApp and Email are copies, sent once (not on every repeat).
- **D-0019-6** Brief nudges keep their on/off in the Brief's own settings; the ways come from here.
- **D-0019-7** "Send me a sample" sends a clearly marked sample through the type's ways, at most once a minute per
  type.

## API

- `GET /notifications/settings` → `{ quietHours, emailFor, mutedModules, rules: { [type]: { on, ways } } }`;
  `PUT /notifications/settings` saves the same shape (unknown types, per-item types and rules equal to the default
  are dropped; security stays on; Alarm only where the type allows it).
- `GET /notifications/catalog` → the catalog, for Android.
- `POST /notifications/sample` with `{ type }` sends a sample.
- `NotifyService.send({ type, … })`: the pipeline applies the person's rule for `type` unless the caller passes
  the item's own ways (`own: true`).

## Acceptance criteria

- [x] AC1 Every `notify.send` names a type from the catalog (test).
- [x] AC2 A rule changes the ways: Off sends nothing, Email adds a copy, Alarm rings and repeats, the default
      applies with no rule, and an item's own ways win (API test).
- [x] AC3 Security can't be turned off; a sample goes out through the type's ways (API test).
- [x] AC4 The web and Android settings list every type by module, with its default, its ways and a sample
      (tests).
