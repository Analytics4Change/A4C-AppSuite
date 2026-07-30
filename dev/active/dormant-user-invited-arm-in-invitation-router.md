---
status: seed
last_updated: 2026-07-30
---

# Seed: dead `WHEN 'user.invited'` arm in `process_invitation_event`

**Origin**: `software-architect-dbc` review of PR #106 (F13).

**Priority**: Low. Nothing is broken today — the risk is that the dead arm gets
resurrected and quietly diverges from the live writer.

## What's there

`infrastructure/supabase/handlers/routers/process_invitation_event.sql:12-47` has a
`WHEN 'user.invited'` arm that INSERTs into `invitations_projection` with
`ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, …`.

**It never runs.** Verified live on dev:

```
stream_type   event_type              count
user          user.invited              26
invitation    invitation.accepted       16
invitation    invitation.revoked         8
organization  invitation.email.sent      2
```

`user.invited` is emitted by `invite-user/index.ts:1213` on the **`user`** stream, so
the dispatcher routes it to `process_user_event` → `handle_user_invited`. Zero events
have ever reached the `invitation`-stream copy. (`20260218234005_restore_user_invited_route.sql`
is the migration that wired the *user*-router arm; the invitation-router arm is the
leftover.)

## Why it matters

Two writers for one projection, one of them invisible:

| | live | dormant |
|---|---|---|
| function | `handle_user_invited` | `process_invitation_event` inline |
| conflict key | `(invitation_id)` | `(id)` |
| field extraction | `safe_jsonb_extract_text(...)` | bare `event_data->>...` |
| notification-pref default | `phoneId` / `inApp` (camel) | `phone_id` / `in_app` (snake) |

The two defaults **already disagree**. If someone ever emits `user.invited` on the
`invitation` stream — or "fixes" routing by pointing it at this router — the
projection starts getting a different shape than every existing row, and the
`ON CONFLICT DO UPDATE SET email` overwrites a stored email with a raw
(un-normalized) one.

## Options

1. **Delete the arm** (recommended). It has never executed; the router's `ELSE`
   already `RAISE EXCEPTION`s, which is the correct behaviour for an event that
   should not arrive on this stream. Removes the divergence by construction.
2. **Keep it and reconcile** — make it `PERFORM handle_user_invited(p_event)` so
   there is one body. Cheaper to write, but preserves a route that should not exist.

## Verification

- After the change, re-run the count query above: `user.invited` still routes on the
  `user` stream and processes without a `processing_error`.
- Emitting `user.invited` with `stream_type='invitation'` raises (not silently
  writes) — that is the desired outcome under option 1.

## Related

- `dev/active/normalize-email-at-the-source.md` — `handle_user_invited` is one of the
  unnormalized write paths in that card's table
- PR #106 F13
