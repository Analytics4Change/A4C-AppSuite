# Implementation Plan: CQRS Dual-Write Remediation Audit

## Executive Summary

Comprehensive audit and remediation of all `api.*` database functions for CQRS compliance. The A4C-AppSuite event-driven architecture requires all state changes to flow through domain events: API function emits event, BEFORE INSERT trigger fires, router dispatches to handler, handler updates projection. Five functions were found violating this pattern (2 dual-write, 3 direct-write-only), plus 2 critical event routing bugs and 1 function referencing non-existent columns. A post-remediation code review uncovered 4 additional issues (missing router entry, bad CHECK constraint, invisible dispatcher ELSE, dead router entries).

All issues were remediated across 8 SQL migrations and corresponding TypeScript changes, verified in production, and documented.

## Phase 1: Audit and P0 Critical Bug Fixes

### 1.1 Audit All `api.*` Functions
- Classify all 21 flagged functions (read-only, event-only, dual-write, direct-write-only)
- Identify event type naming mismatches between emitters and routers
- Run `plpgsql_check` to find column reference errors
- Document all findings in audit file

### 1.2 Fix P0 Critical Bugs (Migration 1)
- Fix `api.revoke_invitation` — non-existent column references + missing event emission
- Fix event type mismatch for `update_organization_direct_care_settings` (router CASE + handler `aggregate_id` bug)
- Fix event type mismatch for `update_user_access_dates` (router CASE)
- **Migration**: `20260206234839_fix_p0_cqrs_critical_bugs`

## Phase 2: Remove Dual Writes and Fix Direct-Write-Only Functions (P1)

### 2.1 Remove Dual-Write Redundancy (Migration 2)
- Remove direct write from `update_organization_direct_care_settings` (handler now fires correctly)
- Remove direct write from `update_user_access_dates` (handler now fires correctly)

### 2.2 Fix `api.resend_invitation` (Migration 3a)
- Rewrite to emit `invitation.resent` event instead of direct-writing projection
- **Migration**: `20260207000203_p1_remove_dual_writes_fix_resend` (combined with 2.1)

### 2.3 Fix `api.update_organization_status` (Migration 3b)
- Create `emitBootstrapCompletedActivity` and `emitBootstrapFailedActivity` (event-driven)
- Create bootstrap handlers (`handle_bootstrap_completed`, `handle_bootstrap_failed`, `handle_bootstrap_cancelled`)
- Replace `activateOrganization` activity (direct-write) with event emission
- **Migration**: `20260207004639_p1_fix_bootstrap_handlers_org_status`

## Phase 3: P2 Cleanup and Documentation

### 3.1 Drop Deprecated Functions (Migration 4a)
- Drop `api.accept_invitation` (body was already a deprecation warning)
- **Migration**: `20260207020902_p2_drop_deprecated_accept_invitation`

### 3.2 Observability Gap (Migration 4c)
- Add PostgREST pre-request hook for automatic `correlation_id`/`causation_id` tracing
- **Migration**: `20260207013604_p2_postgrest_pre_request_tracing`

### 3.3 P2 Workflow Cleanup
- Drop `api.update_organization_status` and `api.get_organization_status`
- Delete `activate-organization.ts`, rewrite `deactivateOrganization` as CQRS-compliant safety net
- Remove dead TypeScript exports (`ActivateOrganizationParams`, `emitOrganizationActivated`)
- **Migration**: `20260207021836_p2_drop_org_status_functions`

### 3.4 Event Type Naming Convention Documentation
- Document underscore-vs-dot convention in `event-handler-pattern.md`
- Add guard rails to `infrastructure/CLAUDE.md`

## Phase 4: Post-Remediation Code Review and Fixes

### 4.1 Architecture Review
- `software-architect-dbc` agent reviewed all 8 commits against architecture rules
- 8/8 rules PASS, 4 additional issues found

### 4.2 Fix `user.invited` Routing + CHECK Constraint
- Add `WHEN 'user.invited'` to `process_user_event()` (handler existed but was unreachable)
- Fix `chk_invitation_status` CHECK to include `'revoked'`
- **Migration**: `20260209031755_fix_user_invited_routing_and_check_constraint`

### 4.3 Cleanup Dead Router Entries + Dispatcher ELSE
- Remove unreachable `user.invited`/`invitation.resent` cases from `process_organization_event()`
- Upgrade `process_domain_event()` ELSE from WARNING to EXCEPTION (P9002)
- Add no-op entries for `platform_admin`, `workflow_queue`, `test` stream_types
- **Migration**: `20260209161446_cleanup_dead_router_entries_and_dispatcher_else`

### 4.4 Additional Cleanup
- Regenerate `database.types.ts` (frontend + workflows)
- Update ADR, README, activity docs to reflect final state
- Add `deactivated_at` to safety net direct-write

## Success Metrics

### Immediate
- [x] Zero `processing_error` entries in `domain_events`
- [x] `supabase db lint --level error` passes clean
- [x] All event types route correctly through dispatcher → router → handler

### Medium-Term
- [x] No dual writes remain in any `api.*` function
- [x] All projection updates flow exclusively through event handlers
- [x] `database.types.ts` reflects current schema (no dropped function references)

### Long-Term
- [x] Event replay produces identical projection state
- [x] HIPAA audit trail complete for all state changes
- [x] Guard rails prevent future CQRS violations

## Implementation Schedule

| Phase | Dates | Duration |
|-------|-------|----------|
| Phase 1: Audit + P0 | 2026-02-05 to 2026-02-06 | 2 days |
| Phase 2: P1 Fixes | 2026-02-06 to 2026-02-07 | 1 day |
| Phase 3: P2 Cleanup | 2026-02-07 to 2026-02-09 | 2 days |
| Phase 4: Code Review Fixes | 2026-02-09 | 1 day |

**Total**: ~5 days (2026-02-05 to 2026-02-09)

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Handler has wrong column name | Fixed handler FIRST (`aggregate_id` → `stream_id`), then removed direct write |
| Event type mismatch causes handler to not fire | Fixed router CASE to match emitted type, verified handler fires before removing direct write |
| Temporal activity changes cause workflow non-determinism | Used new activity names (not modified existing), deployed workers before DB migration |
| Removing direct writes breaks return values | Verified BEFORE INSERT trigger runs synchronously (projection updated before function returns) |
| `revoke_invitation` fix exposes silent failures | Checked production logs; no pending invitations were affected |

## Next Steps After Completion

1. **Handler Code Generation**: Extract inline handler SQL from baseline migration into individual files (see `dev/active/handler-reference-files.md`)
2. **Test Coverage**: Fix pre-existing test mock issues in `organization-bootstrap.test.ts` (32+ lint/type errors)
3. **Event Schema Validation**: Update AsyncAPI contracts to match corrected event types
