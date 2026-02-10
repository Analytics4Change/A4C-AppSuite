# CQRS Dual-Write Pattern Audit

## Architecture Decision Record

**Date**: 2026-02-06
**Status**: ✅ COMPLETE — All migrations applied, all cleanup done, all documentation updated.
**Completed**: 2026-02-09
**Supersedes**: Original audit skeleton (same file)

---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Comprehensive audit of all `api.*` functions for CQRS compliance. Found 5 functions with violations (2 dual-write, 3 direct-write-only), plus 2 critical event routing bugs where event type naming mismatches cause handlers to never fire, and 1 function referencing non-existent columns that will throw at runtime. All issues remediated across 8 migrations.

**When to read**:
- Understanding the CQRS remediation history
- When modifying `api.*` functions that write to projections
- When adding new event types to routers
- Understanding the event type naming convention

**Key topics**: `cqrs`, `dual-write`, `event-routing`, `audit`, `projection-write`, `remediation`

**Estimated read time**: 20 minutes
<!-- TL;DR-END -->

---

## 1. Executive Summary

This audit examined all 21 `api.*` functions that were flagged for potential CQRS violations. The documented pattern requires all state changes to flow through domain events:

```
API function -> INSERT INTO domain_events -> BEFORE INSERT trigger -> router -> handler -> projection updated
```

### Classification Results

| Category | Count | Functions |
|----------|-------|-----------|
| Read-only (false positives) | 3 | `get_invitation_by_id`, `get_organizations_paginated`, `list_users` |
| Event-only (correct) | 8 | `create_organization_unit`, `deactivate_organization_unit`, `reactivate_organization_unit`, `update_organization_unit`, `update_role`, `create_role`, `sync_role_assignments`, `update_user` |
| **Dual-write violations** | **2** | `update_organization_direct_care_settings`, `update_user_access_dates` |
| **Direct-write-only violations** | **3** | `update_organization_status`, `resend_invitation`, `revoke_invitation` |
| Acceptable exceptions | 2 | `accept_invitation` (deprecated), `switch_org_unit` (session preference) |

### Critical Bugs Found During Audit

Beyond the CQRS pattern violations, the audit uncovered bugs that are more urgent:

| Bug | Severity | Impact |
|-----|----------|--------|
| **Event type naming mismatch** (2 functions) | P0 | Handlers never fire; direct writes are the only working mechanism |
| **Non-existent column references** (`revoke_invitation`) | P0 | Function throws runtime error when called with matching rows |
| **`aggregate_id` reference** in handler | P1 | Handler would fail if ever invoked (currently masked by routing bug) |

### Post-Remediation Bugs Discovered (Code Review)

| Bug | Severity | Impact | Fix |
|-----|----------|--------|-----|
| **`user.invited` routing missing** in `process_user_event` | P0 | New invitations would not populate projection | Migration `20260209031755` |
| **CHECK constraint** missing `'revoked'` on `invitations_projection` | P1 | `invitation.revoked` handler would violate constraint | Migration `20260209031755` |
| **Dispatcher ELSE** used WARNING instead of EXCEPTION | P2 | Unknown `stream_type` silently ignored | Migration `20260209161446` |
| **Dead router entries** in `process_organization_event` | P2 | Unreachable `user.invited`/`invitation.resent` cases | Migration `20260209161446` |

---

## 2. Detailed Findings

### 2.1 Event Type Naming Mismatch (P0 - CRITICAL)

Two API functions emit event types using underscores where the router expects dots. The events are inserted into `domain_events`, the BEFORE INSERT trigger fires, the router's CASE statement does not match the event type, the ELSE branch raises a WARNING (non-fatal), the trigger marks the event as processed, and control returns to the API function. The handler never fires.

#### Function: `api.update_organization_direct_care_settings`

| Aspect | Value |
|--------|-------|
| Event type emitted | `organization.direct_care_settings_updated` (underscore before "updated") |
| Router CASE expects | `organization.direct_care_settings.updated` (dot before "updated") |
| Handler | `handle_organization_direct_care_settings_updated` -- exists but never invoked |
| Handler bug | References `p_event.aggregate_id` (column does not exist; should be `stream_id`) |
| Direct write | `UPDATE organizations_projection SET direct_care_settings = v_new_settings, updated_at = now()` |
| Evidence | 5+ events in `domain_events` with type `organization.direct_care_settings_updated`, all showing `processed_at` set, `processing_error` NULL |
| Current behavior | Direct write in API function updates projection. Handler never runs. Audit trail exists (event is recorded) but event replay would NOT reproduce the projection state. |

#### Function: `api.update_user_access_dates`

| Aspect | Value |
|--------|-------|
| Event type emitted | `user.access_dates_updated` (underscore) |
| Router CASE expects | `user.access_dates.updated` (dot) |
| Handler | `handle_user_access_dates_updated` -- exists but never invoked |
| Handler code | Correct (uses `p_event.event_data` fields, no `aggregate_id` bug) |
| Direct write | `UPDATE user_organizations_projection SET access_start_date = ..., access_expiration_date = ..., updated_at = now()` |
| Evidence | 0 events found in `domain_events` (feature may not have been used in production yet) |
| Current behavior | Direct write in API function updates projection. Handler never runs. |
| Ordering concern | Event is emitted BEFORE the direct write. Because the trigger is BEFORE INSERT and synchronous, the handler (if it matched) would run before the direct write. With both the handler and direct write updating the same row, the direct write would overwrite the handler's `updated_at = p_event.created_at` with `updated_at = now()`. |

### 2.2 Non-Existent Column References (P0 - CRITICAL)

#### Function: `api.revoke_invitation`

| Aspect | Value |
|--------|-------|
| Problem | Updates `revoked_at` and `revoke_reason` columns that do not exist on `invitations_projection` |
| plpgsql_check result | `error:42703: column "revoked_at" of relation "invitations_projection" does not exist` |
| No event emission | No domain event is emitted; no audit trail |
| Callers | Frontend (`SupabaseUserCommandService.revokeInvitation`), Temporal workflow (`revoke-invitations.ts` compensation activity) |
| Impact | **This function will throw a runtime error** when called with `status = 'pending'` rows. Invitation revocation is broken. |
| Existing handler | `process_invitation_event` handles `invitation.revoked` inline (not a separate handler) and correctly updates `status = 'revoked'`, `updated_at = p_event.created_at` |

### 2.3 Direct-Write-Only Violations

#### Function: `api.update_organization_status`

| Aspect | Value |
|--------|-------|
| Problem | Directly updates `organizations_projection.is_active`, `deactivated_at`, `deleted_at` with no event emission |
| No authorization | No permission check, no `auth.uid()` reference |
| Callers | Temporal workflows only (`activate-organization.ts`, `deactivate-organization.ts`) |
| Temporal workflow behavior | The workflows call `api.update_organization_status` for the projection write, then emit their own events (`organization.activated`, `organization.deactivated`) via `emitEvent()` / `emitOrganizationActivated()` |
| Existing handlers | `handle_organization_deactivated`, `handle_organization_reactivated`, `handle_organization_deleted` -- all exist and use `stream_id` correctly |
| Impact | The function itself creates no audit trail, but the calling workflows DO emit events separately. This is a split-responsibility pattern rather than a true gap. However, it means the projection is updated BEFORE the event exists, breaking the event-first guarantee. |

#### Function: `api.resend_invitation`

| Aspect | Value |
|--------|-------|
| Problem | Directly updates `invitations_projection` (token, expires_at, status, updated_at) with no event emission |
| plpgsql_check | Clean (no column errors) |
| Callers | Frontend calls Edge Function `resend-invitation` (not listed in current Edge Functions -- likely handled through `invite-user` or another path), and `SupabaseUserCommandService.resendInvitation` |
| Existing handler | `handle_invitation_resent` exists in `process_invitation_event` router and in `process_organization_event` router (both handle `invitation.resent`). Handler updates `token`, `expires_at`, `status = 'pending'`, `updated_at` via `invitation_id` from `event_data`. |
| Impact | No audit trail for invitation resends. Event replay would not reproduce resent invitations. |

### 2.4 Dual-Write Violations (Redundancy Analysis)

For the two dual-write functions (`update_organization_direct_care_settings` and `update_user_access_dates`), the question "is the direct write redundant?" has a definitive answer: **No, the direct write is the ONLY working mechanism** because the event type naming mismatch prevents the handler from ever firing.

If the event type naming were fixed, the direct writes WOULD be redundant because:
1. The trigger is BEFORE INSERT (synchronous, same transaction)
2. `api.emit_domain_event()` does the INSERT
3. The trigger fires and the handler updates the projection
4. Control returns to the API function with the projection already updated
5. The API function's direct write then overwrites the handler's work

The direct writes also introduce a timestamp inconsistency: handlers use `p_event.created_at` for `updated_at`, while the direct writes use `now()`. In a synchronous BEFORE INSERT trigger, these are nearly identical but semantically different -- the event timestamp should be authoritative for replay fidelity.

### 2.5 Acceptable Exceptions

#### `api.accept_invitation` (Deprecated — DROPPED)

The function body contained `RAISE WARNING 'DEPRECATED: No longer called. Event processor handles updates.'`. It was not called by any active code path. The Edge Function `accept-invitation` handles this flow via event emission. **Dropped** in migration `20260207020902`.

#### `api.switch_org_unit`

Writes to the `users` table (NOT a projection table), updating `current_org_unit_id`. This is a session-level preference, not a domain state change. The `users` table is the Supabase Auth `auth.users` table extended with custom columns. This is architecturally appropriate and does not require event sourcing.

---

## 3. Unified Remediation Approach

### 3.1 Design Principle

All violations should be fixed the same way: **remove direct writes from API functions and rely on event handlers for projection updates**. This is justified by:

1. **Synchronous trigger**: The BEFORE INSERT trigger guarantees the handler runs within the same transaction. The projection IS updated by the time the API function's INSERT returns.
2. **Event replay**: Direct writes cannot be replayed from the event store.
3. **Audit trail**: HIPAA requires all state changes in the audit log.
4. **Single responsibility**: The handler is the sole owner of projection updates.

### 3.2 Exception: `api.update_organization_status` (DROPPED)

This function was called by Temporal workflows that emitted their own events separately. The fix was:
- Created `emitBootstrapCompletedActivity` (handler sets `is_active = true`)
- Created `emitBootstrapFailedActivity` (handler sets `is_active = false`)
- Deleted `activate-organization.ts` activity
- Rewrote `deactivateOrganization` as CQRS-compliant safety net (direct-write fallback)
- Dropped `api.update_organization_status` and `api.get_organization_status`

### 3.3 Risk Assessment: Removing Direct Writes

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Handler has wrong column name | **HIGH** -- handler for `direct_care_settings_updated` uses `p_event.aggregate_id` | Fix handler FIRST, then remove direct write |
| Event type mismatch causes handler to not fire | **HIGH** -- exactly the current situation | Fix event type OR router CASE, verify handler fires, then remove direct write |
| Handler logic differs from direct write | **LOW** -- verified handlers match the direct write logic | Test in staging after fix |
| Transaction rollback behavior changes | **NONE** -- both handler and direct write are in the same transaction | N/A |
| Performance impact | **NONE** -- handler already exists and runs (or would run with fix); removing direct write reduces work | N/A |

---

## 4. Specific Remediation Plan

### Migration 1: Fix Critical Bugs (P0) — ✅ APPLIED

**Priority**: P0 -- Fix before any other changes
**Risk**: Low (fixes broken functions, no behavior change for working ones)
**Dependencies**: None
**Migration**: `20260206234839_fix_p0_cqrs_critical_bugs`
**Status**: Applied and verified 2026-02-06

#### 1a. Fix `api.revoke_invitation` -- Non-existent columns + missing event

**Problem**: Function references `revoked_at` and `revoke_reason` columns that do not exist. No event emitted.

**Fix**: Rewrite to emit `invitation.revoked` event and remove direct write. The existing handler in `process_invitation_event` already handles `invitation.revoked`.

#### 1b. Fix event type mismatch for `update_organization_direct_care_settings`

**Problem**: API emits `organization.direct_care_settings_updated`, router matches `organization.direct_care_settings.updated`.

**Fix**: Update the router CASE to match the emitted event type (underscore format). Also fix the handler's `aggregate_id` bug.

#### 1c. Fix event type mismatch for `update_user_access_dates`

**Problem**: API emits `user.access_dates_updated`, router matches `user.access_dates.updated`.

**Fix**: Update the router CASE to match the emitted event type (underscore format).

### Migration 2: Remove Dual-Write Redundancy (P1) — ✅ APPLIED

**Priority**: P1 -- After Migration 1 is verified in production
**Risk**: Medium (behavior change, but handler already tested via Migration 1)
**Dependencies**: Migration 1 must be applied and verified first
**Migration**: `20260207000203_p1_remove_dual_writes_fix_resend` (combined with Migration 3a)
**Status**: Applied and verified 2026-02-06

#### 2a. Remove direct write from `update_organization_direct_care_settings`
#### 2b. Remove direct write from `update_user_access_dates`

### Migration 3: Fix Direct-Write-Only Functions (P1) — ✅ APPLIED

**Priority**: P1
**Risk**: Medium
**Dependencies**: None (independent of Migrations 1-2)

#### 3a. Fix `api.resend_invitation` — ✅ APPLIED

**Migration**: `20260207000203_p1_remove_dual_writes_fix_resend` (combined with Migration 2)
**Status**: Applied and verified 2026-02-06

#### 3b. Fix `api.update_organization_status` — ✅ APPLIED + P2 CLEANUP COMPLETE

**Migration**: `20260207004639_p1_fix_bootstrap_handlers_org_status` (SQL) + `20260207021836_p2_drop_org_status_functions` (cleanup)
**Status**: Applied and verified 2026-02-07. P2 cleanup completed 2026-02-09.

**P2 cleanup completed**:
- Dropped `api.update_organization_status` and `api.get_organization_status` (migration `20260207021836`)
- Deleted `activate-organization.ts` activity (replaced by `emitBootstrapCompletedActivity`)
- Rewrote `deactivateOrganization` as CQRS-compliant safety net — direct-writes to `organizations_projection` instead of calling dropped RPCs. Intentional CQRS exception: if event emission has failed, another event would also fail; direct write is the only reliable fallback.
- Removed `ActivateOrganizationParams`, `emitOrganizationActivated` (unused after deletion)

### Migration 4: Cleanup (P2) — ✅ APPLIED

**Priority**: P2 -- Low urgency
**Risk**: Low

#### 4a. Drop deprecated `api.accept_invitation` — ✅ APPLIED

**Migration**: `20260207020902_p2_drop_deprecated_accept_invitation`
**Status**: Applied 2026-02-07

#### 4b. Event type naming convention documentation — ✅ APPLIED

**Status**: Documented 2026-02-07

Convention documented in `event-handler-pattern.md` under "Event Type Naming Convention" section.

#### 4c. Observability gap: missing metadata in `api.*` RPC functions — ✅ APPLIED

**Migration**: `20260207013604_p2_postgrest_pre_request_tracing`
**Status**: Applied 2026-02-07

### Post-Remediation Fixes (Code Review) — ✅ APPLIED

#### Fix `user.invited` routing + CHECK constraint — ✅ APPLIED

**Migration**: `20260209031755_fix_user_invited_routing_and_check_constraint`
**Status**: Applied 2026-02-09

- Added `WHEN 'user.invited' THEN PERFORM handle_user_invited(p_event)` to `process_user_event()`
- Fixed `chk_invitation_status` CHECK constraint to include `'revoked'`
- Reprocessed any stuck events (0 rows affected)

#### Cleanup dead router entries + dispatcher ELSE — ✅ APPLIED

**Migration**: `20260209161446_cleanup_dead_router_entries_and_dispatcher_else`
**Status**: Applied 2026-02-09

- Removed unreachable `user.invited`/`invitation.resent` from `process_organization_event()`
- Upgraded `process_domain_event()` ELSE from `RAISE WARNING` to `RAISE EXCEPTION` (ERRCODE P9002)
- Added `platform_admin`, `workflow_queue`, `test` as explicit no-op `stream_type` entries

#### Additional review recommendations — ✅ APPLIED

**Status**: Committed 2026-02-09

- Regenerated `database.types.ts` (both frontend and workflows)
- Updated ADR to reflect safety net kept (not removed)
- Added `deactivated_at` to safety net direct-write
- Fixed stale docs referencing deleted `activate-organization.ts`

---

## 5. Complete Migration History

```
Migration 1a (revoke_invitation)              — ✅ APPLIED (20260206234839)
Migration 1b (direct_care routing)            — ✅ APPLIED (20260206234839)
Migration 1c (access_dates routing)           — ✅ APPLIED (20260206234839)

Migration 2a (remove direct_care direct write) — ✅ APPLIED (20260207000203)
Migration 2b (remove access_dates direct write) — ✅ APPLIED (20260207000203)

Migration 3a (resend_invitation)              — ✅ APPLIED (20260207000203)
Migration 3b (update_org_status)              — ✅ APPLIED (20260207004639 + TypeScript)
Migration 3b P2 (drop RPCs, cleanup TS)       — ✅ APPLIED (20260207021836 + TypeScript)

Migration 4a (drop accept_invitation)          — ✅ APPLIED (20260207020902)
Migration 4b (naming convention docs)          — ✅ DOCUMENTED (event-handler-pattern.md)
Migration 4c (observability gap)               — ✅ APPLIED (20260207013604)

Post-review: user.invited routing + CHECK      — ✅ APPLIED (20260209031755)
Post-review: dead entries + dispatcher ELSE    — ✅ APPLIED (20260209161446)
Post-review: regen types, fix docs, cleanup    — ✅ COMMITTED (98ea0125)
```

---

## 6. Documentation Updates — ✅ COMPLETED

All documentation updates applied 2026-02-07 through 2026-02-09.

### 6.1 CQRS Compliance ADR — ✅ CREATED

**Location**: `documentation/architecture/decisions/adr-cqrs-dual-write-remediation.md`

### 6.2 Existing Document Updates — ✅ APPLIED

| Document | Update Applied |
|----------|---------------|
| `event-handler-pattern.md` | Naming convention section, resolved issues callout, updated TL;DR/keywords |
| `event-sourcing-overview.md` | Fixed trigger example (AFTER→BEFORE INSERT), added naming convention note, updated code to match actual architecture |
| `infrastructure/CLAUDE.md` | Added naming convention warning (counts already correct at 16/54+) |
| `AGENT-INDEX.md` | Added keywords: `cqrs-compliance`, `event-type-naming`, `naming-convention`. Added ADR to catalog. |
| `workflows/README.md` | Updated directory listing (activate-organization → emit-bootstrap-completed/failed) |
| `implementation.md` | Updated activity listings and test file references |
| `activities-reference.md` | Updated deactivateOrganization description to reflect CQRS safety net rewrite |
| `adr-cqrs-dual-write-remediation.md` | Updated "Remaining P2 Cleanup" → "Completed P2 Cleanup" with full details |
| `database.types.ts` | Regenerated for both frontend and workflows (dropped functions removed) |

### 6.3 Claim Verification — ✅ VERIFIED

"All state changes emit domain events" claims across 15+ documents are now accurate post-remediation. The three previously-violating functions (`update_organization_status`, `resend_invitation`, `revoke_invitation`) have all been fixed to emit events.

---

## 7. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Migration 1 introduces regression | Low | High | Test each router fix with a manual event INSERT in staging; verify handler fires and projection updates |
| Removing direct writes breaks return values | Low | Medium | Verify that handler runs synchronously (BEFORE INSERT confirmed) before removing direct writes |
| Temporal activity changes introduce workflow non-determinism | Medium | High | Use Temporal's versioning API when changing activity behavior; deploy workers before applying database migration |
| Event replay after fix produces different state than current | Low | Low | The current state was produced by direct writes, not handlers. After fix, replay will match handler logic. Document this as expected. |
| `revoke_invitation` fix exposes that revocations were silently failing | High | Medium | Check production logs for ERROR traces from revoke_invitation calls; notify stakeholders if invitations were supposed to be revoked but were not |

---

## 8. Verification Checklist

Post-remediation verification (all passed 2026-02-09):

- [x] `supabase db lint --level error` passes (plpgsql_check validates all functions)
- [x] Events emitted by API functions appear in `domain_events` with correct `event_type`
- [x] Events have `processed_at` set and `processing_error` is NULL
- [x] Projection tables reflect expected state changes
- [x] No `processing_error` entries in `domain_events` (0 total errors)
- [x] `process_domain_event()` ELSE upgraded to EXCEPTION with no-ops for admin stream_types
- [x] All router ELSE clauses use RAISE EXCEPTION (not WARNING)
- [x] `database.types.ts` regenerated (no references to dropped functions)
- [x] `deactivateOrganization` safety net preserved with CQRS-compliant direct-write

---

## Related Documents

- `documentation/architecture/decisions/adr-cqrs-dual-write-remediation.md` -- ADR for this remediation
- `dev/active/handler-reference-files.md` -- Handler extraction plan (depends on this audit)
- `documentation/infrastructure/patterns/event-handler-pattern.md` -- Trigger/handler architecture
- `infrastructure/CLAUDE.md` -- Event handler documentation
- `documentation/architecture/data/event-sourcing-overview.md` -- CQRS architecture overview
