---
status: seed
last_updated: 2026-07-02
---

# Seed: `UsersViewModel.successMessage` is a write-only observable (N2)

**Origin**: `software-architect-dbc` re-review of PR #88 (command-feedback Phase 2), finding **N2** (LOW, pre-existing — not introduced by #88).

## Problem
`UsersViewModel.successMessage` is **set in ~18 places** (including `'Roles updated'` at `UsersViewModel.ts:~1178`) but **rendered nowhere** — `grep '.successMessage'` across `pages/`/`components/` returns 0 hits. It's a write-only observable: dead output surface.

Related staleness: the comment at `UserFormViewModel.ts:~1007-1008` claims "page VM has already set `successMessage = 'Roles updated'`" — this is now **misleading**, because after PR #88 (F6) edit-mode role/profile save success actually surfaces via the new `'Changes saved'` `role="status"` banner (`showCommandSuccess`), not via `successMessage`.

Note: this is **not** an INV-1 problem — because `successMessage` never mounts an announcing region, it can't double-announce. It's a cleanliness / correctness-of-intent issue.

## Proposed (Phase 3 cleanup — pick one)
- **Wire it up**: if the per-operation success strings (`'Roles updated'`, etc.) are worth showing, route them through `showCommandSuccess(...)` so they reach the `role="status"` banner — and delete the redundant `'Changes saved'` generic where a specific message exists.
- **Or remove it**: delete the write-only `successMessage` observable + its ~18 setters, and fix/remove the stale `UserFormViewModel.ts:1007-1008` comment.

Decide based on whether per-operation success copy (vs the generic `'Changes saved'`) adds UX value.

## Verification
- `grep -rn "successMessage" frontend/src` — no write-only observable remains (either consumed or removed).
- `tsc`/`eslint`/`build` green; VM unit tests updated if setters removed.

## ✅ DONE — Phase-3 PR 1 (`feat/command-feedback-phase3-n4-n2`, 2026-07-21)

**Chosen: removed** (the page-level `showCommandSuccess` banner is the authoritative success surface; the VM's write-only per-op strings added no UX value and no test/reader depended on them).

- Deleted the `successMessage` observable + all 17 setters from `UsersViewModel.ts`; removed the now-dead no-op `clearSuccessMessage()` method (`clearMessages()` kept — still clears `error`).
- Fixed the stale `UserFormViewModel.ts` comment that claimed the page VM sets `successMessage = 'Roles updated'` → now points to `showCommandSuccess('Changes saved')`.
- `grep -rn successMessage src/viewModels/users` → 0 hits; `tsc`/`eslint`/`build`/tests green (no test referenced it).
