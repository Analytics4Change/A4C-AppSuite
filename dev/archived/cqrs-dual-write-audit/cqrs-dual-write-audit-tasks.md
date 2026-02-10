# Tasks: CQRS Dual-Write Remediation Audit

## Phase 1: Audit + P0 Critical Bug Fixes ✅ COMPLETE

- [x] Audit all 21 `api.*` functions for CQRS violations
- [x] Classify functions: read-only (3), event-only (8), dual-write (2), direct-write-only (3), exceptions (2)
- [x] Identify event type naming mismatches (2 functions: `direct_care_settings`, `access_dates`)
- [x] Identify non-existent column references (`revoke_invitation`)
- [x] Fix `api.revoke_invitation` — emit `invitation.revoked` event, remove direct write
- [x] Fix router CASE for `organization.direct_care_settings_updated`
- [x] Fix handler `aggregate_id` → `stream_id` bug in `handle_organization_direct_care_settings_updated`
- [x] Fix router CASE for `user.access_dates_updated`
- [x] Apply migration `20260206234839` and verify

## Phase 2: P1 Remove Dual Writes + Fix Direct-Write-Only ✅ COMPLETE

- [x] Remove direct write from `api.update_organization_direct_care_settings`
- [x] Remove direct write from `api.update_user_access_dates`
- [x] Rewrite `api.resend_invitation` to emit `invitation.resent` event
- [x] Apply combined migration `20260207000203` and verify
- [x] Create `handle_bootstrap_completed` handler (sets `is_active = true`)
- [x] Create `handle_bootstrap_failed` handler (sets `is_active = false`)
- [x] Create `handle_bootstrap_cancelled` handler
- [x] Add bootstrap event routing to `process_organization_event`
- [x] Apply migration `20260207004639` and verify
- [x] Create `emitBootstrapCompletedActivity` in TypeScript
- [x] Create `emitBootstrapFailedActivity` in TypeScript
- [x] Update workflow to use new activities instead of `activateOrganization`

## Phase 3: P2 Cleanup + Documentation ✅ COMPLETE

- [x] Drop deprecated `api.accept_invitation` (migration `20260207020902`)
- [x] Add PostgREST pre-request hook for tracing (migration `20260207013604`)
- [x] Document event type naming convention in `event-handler-pattern.md`
- [x] Drop `api.update_organization_status` and `api.get_organization_status` (migration `20260207021836`)
- [x] Delete `activate-organization.ts` activity
- [x] Rewrite `deactivateOrganization` as CQRS-compliant safety net (direct-write to projection)
- [x] Remove `ActivateOrganizationParams`, `emitOrganizationActivated` (dead code)
- [x] Restore `DeactivateOrganizationParams` in types
- [x] Update workflow compensation block (restore safety net)
- [x] Update test mocks for new activity names
- [x] Create ADR: `adr-cqrs-dual-write-remediation.md`
- [x] Update `event-sourcing-overview.md` (fix trigger example)
- [x] Update `infrastructure/CLAUDE.md` (naming convention warning)
- [x] Update `AGENT-INDEX.md` (new keywords + ADR catalog entry)

## Phase 4: Post-Remediation Code Review Fixes ✅ COMPLETE

- [x] Run `software-architect-dbc` code review across all 8 commits
- [x] Fix `user.invited` routing — add CASE to `process_user_event()` (migration `20260209031755`)
- [x] Fix `chk_invitation_status` CHECK constraint to include `'revoked'` (migration `20260209031755`)
- [x] Add stuck event reprocessing safety net (0 rows affected)
- [x] Remove dead `user.invited`/`invitation.resent` entries from `process_organization_event()` (migration `20260209161446`)
- [x] Upgrade `process_domain_event()` ELSE from WARNING to EXCEPTION P9002 (migration `20260209161446`)
- [x] Add `platform_admin`, `workflow_queue`, `test` as no-op stream_type entries
- [x] Regenerate `database.types.ts` (frontend + workflows)
- [x] Update ADR: "Remaining P2 Cleanup" → "Completed P2 Cleanup"
- [x] Add `deactivated_at` to safety net direct-write
- [x] Update `workflows/README.md` (directory listing)
- [x] Update `implementation.md` (activity listings)
- [x] Update `activities-reference.md` (safety net description)
- [x] Mark audit document as complete

## Success Validation Checkpoints

### Immediate Validation
- [x] Zero `processing_error` entries in `domain_events`
- [x] `supabase db lint --level error` passes clean
- [x] All 8 migrations applied successfully via `supabase db push --linked`

### Feature Complete Validation
- [x] All event types route correctly: dispatcher → router → handler → projection
- [x] No dual writes remain in any `api.*` function
- [x] `database.types.ts` matches current schema (no dropped function references)
- [x] `deactivateOrganization` safety net preserved with CQRS-compliant direct-write
- [x] All router ELSE clauses use RAISE EXCEPTION (not WARNING)
- [x] ADR and documentation reflect final state

### Production Stability Validation
- [x] All existing events reprocessable (no stuck events)
- [x] Unknown stream_types caught by EXCEPTION (recorded in `processing_error`)
- [x] Administrative stream_types (`platform_admin`, `workflow_queue`, `test`) pass through as no-ops

## Git Commits

| Commit | Description |
|--------|-------------|
| `b89605cb` | fix: P0 CQRS critical bugs — routing mismatches, broken revoke_invitation |
| `79a1cfd3` | fix: P1 CQRS remove dual writes, fix resend_invitation event emission |
| `f7439013` | fix: Migration 3b — bootstrap handlers replace activateOrganization |
| `b33e4b8a` | feat: P2 PostgREST pre-request hook for automatic event tracing |
| `d3e7e196` | feat: P2 drop deprecated accept_invitation, document event naming convention |
| `8614e18e` | docs: CQRS remediation ADR, fix trigger example, add naming convention refs |
| `5313024c` | fix: P2 cleanup — drop org status RPCs, rewrite deactivateOrganization safety net |
| `98ea0125` | chore: review recommendations — regen types, fix docs, clean dead router entries |
| `e066e94e` | fix: P0 add user.invited routing to process_user_event, fix revoked CHECK constraint |
| `821fe847` | docs: mark CQRS dual-write remediation audit as complete |

## Current Status

**Phase**: All phases complete
**Status**: ✅ COMPLETE
**Last Updated**: 2026-02-09
**Next Step**: Archive. Remaining follow-up work tracked separately: handler code generation (`dev/active/handler-reference-files.md`), test mock cleanup (pre-existing, out of scope).
