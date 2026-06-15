---
status: seed
last_updated: 2026-06-15
---

# Seed: Phone-number normalization + per-user dedup

**Origin**: Parked follow-up from PR #78 (per-user org-override removal). See `~/.claude/plans/spicy-dreaming-crystal.md` § Parked follow-up #2 and `memory/pr-78-close-out.md`.

## Problem
`user_phones.number` is stored raw (no E.164 column) alongside separate `country_code` + `extension`. There is no uniqueness on the value, so a user can accidentally hold the same number twice. Raw-string uniqueness is leaky (`+15095551234` vs `509-555-1234`).

## Proposed
1. Add an E.164-normalized column (or expression) on `user_phones`.
2. Partial `UNIQUE(user_id, normalized_number) WHERE is_active` to prevent a user duplicating their own number.

## HARD CONSTRAINT (do NOT violate)
- **Must NOT be broadened to per-org or global number uniqueness** — that would forbid legitimately shared lines (family/solo providers: org HQ line == user line == multiple family members' line). Verified in PR #78 that shared numbers are intentionally allowed. Per-user scope only.
- Confirm the phone UI doesn't legitimately store the same number under multiple labels/types as separate rows before adding a hard unique (else it'd false-block). If it does, scope the unique appropriately or use soft dedup.
- Addresses are free-form/multi-field → no uniqueness constraint recommended (keep only the existing one-primary-per-user).

## Not started. Independent of the org-override removal; do normalization first, then the unique.
