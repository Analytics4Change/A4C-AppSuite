# manage-user delete → SQL RPC — Plan

## Executive Summary

Extract `delete` from `manage-user` Edge Function into a new SQL RPC with Pattern A v2 read-back by construction. Closes the silent-failure gap for user deletion in the same PR as the extraction.

## Phases

| Phase | Description |
|-------|-------------|
| 0 | Inspect v11 delete case + `handle_user_deleted` handler; determine soft vs hard delete semantics |
| 1 | Migration: create `api.delete_user` with Pattern A v2 |
| 2 | Frontend service cutover |
| 3 | Edge Function cleanup |
| 4 | Verification + PR |

## Open Questions

- **O1** — Soft-delete (`users.deleted_at`) vs hard-delete? Per Rule 13 template (SKILL.md), read-back for soft-delete matches `WHERE id = ? AND deleted_at IS NOT NULL`.
- **O2** — Does user deletion cascade to `user_roles_projection`, `user_org_phone_overrides`, etc.? Confirm handler scope before porting.
- **O3** — `auth.users` cleanup — does deletion also remove the auth record? If yes, LB1 applies and this becomes a `deactivate`-style flow (load-bearing). If no (soft-delete only), truly `candidate`.

**If O3 reveals auth.users deletion**: reclassify as load-bearing and park this card.

## Reference

See `context.md`.
