# CQRS Dual-Write Pattern Audit

## Architecture Decision Record

**Date**: 2026-02-06
**Status**: P0 + P1 (Migrations 1-3) applied, P2 4c applied, P2 4a/4b pending
**Priority**: P2 cleanup next (drop deprecated functions, naming convention docs)
**Supersedes**: Original audit skeleton (same file)

---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Comprehensive audit of all `api.*` functions for CQRS compliance. Found 5 functions with violations (2 dual-write, 3 direct-write-only), plus 2 critical event routing bugs where event type naming mismatches cause handlers to never fire, and 1 function referencing non-existent columns that will throw at runtime.

**When to read**:
- Before implementing any remediation migration
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

#### `api.accept_invitation` (Deprecated)

The function body contains `RAISE WARNING 'DEPRECATED: No longer called. Event processor handles updates.'`. It is not called by any active code path. The Edge Function `accept-invitation` handles this flow via event emission. **Recommendation**: Drop the function in a future cleanup migration.

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

### 3.2 Exception: `api.update_organization_status`

This function is called by Temporal workflows that emit their own events separately. The recommended fix is:
- Convert the function to emit the appropriate event type (`organization.activated`, `organization.deactivated`, `organization.deleted`)
- Remove the direct projection write
- Update the Temporal activities to stop emitting separate events and stop calling this function, OR
- Simpler: modify the activities to emit events through `api.emit_domain_event()` via RPC and remove the `update_organization_status` function entirely

The simpler approach is preferred because the Temporal activities already have the business logic to determine the correct event type.

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

### Migration 1: Fix Critical Bugs (P0) -- APPLIED

**Priority**: P0 -- Fix before any other changes
**Risk**: Low (fixes broken functions, no behavior change for working ones)
**Dependencies**: None
**Migration**: `20260206234839_fix_p0_cqrs_critical_bugs`
**Status**: Applied and verified 2026-02-06

#### 1a. Fix `api.revoke_invitation` -- Non-existent columns + missing event

**Problem**: Function references `revoked_at` and `revoke_reason` columns that do not exist. No event emitted.

**Fix**: Rewrite to emit `invitation.revoked` event and remove direct write. The existing handler in `process_invitation_event` already handles `invitation.revoked`.

```sql
CREATE OR REPLACE FUNCTION api.revoke_invitation(
  p_invitation_id UUID,
  p_reason TEXT DEFAULT 'manual_revocation'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_invitation RECORD;
BEGIN
  -- Check invitation exists and is pending
  SELECT id, organization_id INTO v_invitation
  FROM invitations_projection
  WHERE id = p_invitation_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Emit domain event (handler in process_invitation_event updates projection)
  PERFORM api.emit_domain_event(
    p_stream_type := 'invitation',
    p_stream_id := p_invitation_id,
    p_event_type := 'invitation.revoked',
    p_event_data := jsonb_build_object(
      'invitation_id', p_invitation_id,
      'reason', p_reason,
      'revoked_at', now()
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', auth.uid(),
      'reason', p_reason
    )
  );

  RETURN true;
END;
$$;
```

**Note**: The existing handler in `process_invitation_event` for `invitation.revoked` sets `status = 'revoked'` and `updated_at`. It does NOT set `revoked_at` or `revoke_reason` because those columns do not exist. If revocation reason tracking is needed, add columns to `invitations_projection` first, then update the handler.

#### 1b. Fix event type mismatch for `update_organization_direct_care_settings`

**Problem**: API emits `organization.direct_care_settings_updated`, router matches `organization.direct_care_settings.updated`.

**Fix**: Update the router CASE to match the emitted event type (underscore format). Also fix the handler's `aggregate_id` bug.

```sql
-- Fix the router CASE clause
-- In process_organization_event, change:
--   WHEN 'organization.direct_care_settings.updated' THEN
-- To:
--   WHEN 'organization.direct_care_settings_updated' THEN

-- Fix the handler
CREATE OR REPLACE FUNCTION handle_organization_direct_care_settings_updated(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
BEGIN
  UPDATE organizations_projection SET
    direct_care_settings = p_event.event_data->'settings',
    updated_at = p_event.created_at  -- Use event timestamp, not now()
  WHERE id = p_event.stream_id;  -- Fixed: was aggregate_id
END;
$$;
```

#### 1c. Fix event type mismatch for `update_user_access_dates`

**Problem**: API emits `user.access_dates_updated`, router matches `user.access_dates.updated`.

**Fix**: Update the router CASE to match the emitted event type (underscore format).

```sql
-- In process_user_event, change:
--   WHEN 'user.access_dates.updated' THEN
-- To:
--   WHEN 'user.access_dates_updated' THEN
```

**Decision point**: The naming convention for event types is inconsistent. Most events use dots (`user.phone.added`, `organization.subdomain.verified`), but the API functions emit with underscores for compound action names. The recommendation is to standardize on the emitted format (underscore) because:
- Events already exist in production with the underscore format
- Changing the emitted format would require fixing all callers
- Changing the router is a single-point fix

### Migration 2: Remove Dual-Write Redundancy (P1) -- APPLIED

**Priority**: P1 -- After Migration 1 is verified in production
**Risk**: Medium (behavior change, but handler already tested via Migration 1)
**Dependencies**: Migration 1 must be applied and verified first
**Migration**: `20260207000203_p1_remove_dual_writes_fix_resend` (combined with Migration 3a)
**Status**: Applied and verified 2026-02-06

#### 2a. Remove direct write from `update_organization_direct_care_settings`

After Migration 1 fixes the routing, the handler will fire and update the projection. The direct write becomes redundant. Remove it from both overloads (3-param and 4-param versions).

The function should:
1. Validate permissions (keep)
2. Read current settings (keep -- needed for event data)
3. Build new settings (keep -- needed for event data)
4. **Remove**: `UPDATE organizations_projection SET ...`
5. Emit domain event (keep)
6. Return `v_new_settings` (keep -- handler has already updated the projection by this point)

#### 2b. Remove direct write from `update_user_access_dates`

After Migration 1 fixes the routing, the handler will fire. Remove the direct write.

The function should:
1. Validate authorization (keep)
2. Validate dates (keep)
3. Read old values (keep -- needed for event data)
4. Emit domain event (keep)
5. **Remove**: `UPDATE user_organizations_projection SET ...`
6. **Remove**: `IF NOT FOUND` check (the handler does upsert logic)

**Note on return value**: The function currently returns `void` and raises an exception if no row is found. After removing the direct write, the existence check should move before the event emission.

### Migration 3: Fix Direct-Write-Only Functions (P1)

**Priority**: P1
**Risk**: Medium
**Dependencies**: None (independent of Migrations 1-2)

#### 3a. Fix `api.resend_invitation` -- APPLIED

**Migration**: `20260207000203_p1_remove_dual_writes_fix_resend` (combined with Migration 2)
**Status**: Applied and verified 2026-02-06. Also added `invitation.resent` CASE to `process_invitation_event` router and fixed its ELSE clause to RAISE EXCEPTION.

**Problem**: Direct write with no event. Handler `handle_invitation_resent` exists but is never triggered.

**Fix**: Replace direct write with event emission. Use stream_type `invitation` so the event routes through `process_invitation_event` which now handles `invitation.resent` (also present in `process_organization_event` as dead code).

```sql
CREATE OR REPLACE FUNCTION api.resend_invitation(
  p_invitation_id UUID,
  p_new_token TEXT,
  p_new_expires_at TIMESTAMPTZ
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- Check invitation exists and is in resendable state
  SELECT EXISTS(
    SELECT 1 FROM invitations_projection
    WHERE id = p_invitation_id AND status IN ('pending', 'expired')
  ) INTO v_exists;

  IF NOT v_exists THEN
    RETURN false;
  END IF;

  -- Emit domain event (handler updates projection)
  PERFORM api.emit_domain_event(
    p_stream_type := 'invitation',
    p_stream_id := p_invitation_id,
    p_event_type := 'invitation.resent',
    p_event_data := jsonb_build_object(
      'invitation_id', p_invitation_id,
      'token', p_new_token,
      'expires_at', p_new_expires_at
    ),
    p_event_metadata := jsonb_build_object(
      'user_id', auth.uid()
    )
  );

  RETURN true;
END;
$$;
```

**Routing note**: When `stream_type = 'invitation'`, the event routes to `process_invitation_event`. But `invitation.resent` is NOT in `process_invitation_event`'s CASE -- it is only in `process_organization_event`. This means using `stream_type := 'invitation'` would cause the event to fall through to ELSE.

**Options**:
1. Add `invitation.resent` to `process_invitation_event` (preferred -- the event is about an invitation, not an organization)
2. Use `stream_type := 'organization'` and pass the org_id as stream_id (breaks convention)

**Recommendation**: Option 1. Add the CASE clause to `process_invitation_event` and call the existing `handle_invitation_resent` handler from there.

#### 3b. Fix `api.update_organization_status` -- APPLIED

**Migration**: `20260207004639_p1_fix_bootstrap_handlers_org_status`
**Status**: Applied and verified 2026-02-07

**Problem**: Direct write with no event. Called by Temporal workflows that emit their own events.

**Analysis**: The Temporal activities (`activate-organization.ts`, `deactivate-organization.ts`) follow this pattern:
1. Call `api.update_organization_status` (direct projection write)
2. Emit domain event (`organization.activated` / `organization.deactivated`)

This is backwards from the CQRS pattern. The projection is updated before the event exists.

**Solution applied**: Two-part fix (SQL migration + TypeScript workflow changes):

**SQL migration** (deployed first -- additive, safe with old workers):
- Fixed P0 event type mismatch: router CASE lines changed from `bootstrap.*` to `organization.bootstrap.*` (matching actual emitted types)
- Added `organization.bootstrap.initiated` as no-op (informational event)
- Updated `handle_bootstrap_completed` to set `is_active = true` + metadata
- Updated `handle_bootstrap_failed` to set `is_active = false, deactivated_at, deleted_at` + metadata (fixed field name: `error_message` not `error`)
- Updated `handle_bootstrap_cancelled` to set `is_active = false, deactivated_at` + metadata
- Created `handle_organization_activated` for admin UI actions (sets `is_active = true`)
- Updated `handle_organization_deactivated` to set `deactivated_at, deleted_at`

**TypeScript workflow changes** (deployed after SQL):
- Created `emitBootstrapCompleted` typed event emitter (mirrors `emitBootstrapFailed` pattern)
- Created `emitBootstrapCompletedActivity` (mirrors `emitBootstrapFailedActivity` pattern)
- Replaced `activateOrganization` in workflow Step 5 with `emitBootstrapCompletedActivity`
- Kept `deactivateOrganization` as safety net in Saga compensation (if `emitBootstrapFailedActivity` fails, handler never sets `is_active = false`; deactivateOrganization catches this)

**P2 cleanup remaining**:
- Drop `api.update_organization_status` and `api.get_organization_status`
- Delete `activate-organization.ts` activity
- Remove `deactivateOrganization` safety net from compensation (after confirming event emission reliability)
- Remove type definitions (`ActivateOrganizationParams`, `DeactivateOrganizationParams`)

### Migration 4: Cleanup (P2)

**Priority**: P2 -- Low urgency
**Risk**: Low

#### 4a. Drop deprecated `api.accept_invitation`

The function body says DEPRECATED. The Edge Function `accept-invitation` handles this flow. Remove the function.

#### 4b. Event type naming convention documentation

Document the convention: compound action names use underscores (e.g., `direct_care_settings_updated`), not additional dots. Update `event-handler-pattern.md` and AsyncAPI contracts to reflect the actual convention.

#### 4c. Observability gap: missing metadata in `api.*` RPC functions -- APPLIED

**Migration**: `20260207013604_p2_postgrest_pre_request_tracing`
**Status**: Applied 2026-02-07

**Solution applied**: Option 2 (PostgREST pre-request hook) — systemic fix covering all `api.*` RPC functions:
- PostgREST pre-request hook (`public.postgrest_pre_request()`) extracts `X-Correlation-ID` and `traceparent` headers into `app.*` session variables
- `api.emit_domain_event()` enhanced with session variable fallback when metadata fields are NULL
- Frontend custom fetch wrapper injects tracing headers on every Supabase request
- `user_id` auto-injected from `auth.uid()` when not in metadata
- Explicit metadata (from Edge Functions) always takes precedence

All `api.*` RPC functions now automatically get `correlation_id`, `trace_id`, `span_id`, and `user_id` without any signature changes.

**Remaining gap**: `source_function` and `reason` are still not auto-populated (these are context-specific and must be passed explicitly by callers when meaningful).

---

## 5. Dependency Graph

```
Migration 1a (revoke_invitation)     -- ✅ APPLIED (20260206234839)
Migration 1b (direct_care routing)   -- ✅ APPLIED (20260206234839)
Migration 1c (access_dates routing)  -- ✅ APPLIED (20260206234839)

Migration 2a (remove direct_care direct write) -- ✅ APPLIED (20260207000203)
Migration 2b (remove access_dates direct write) -- ✅ APPLIED (20260207000203)

Migration 3a (resend_invitation)     -- ✅ APPLIED (20260207000203)
Migration 3b (update_org_status)     -- ✅ APPLIED (20260207004639 + TypeScript)

Migration 4a (drop accept_invitation) -- PENDING
Migration 4b (naming convention docs) -- PENDING
Migration 4c (observability gap)     -- ✅ APPLIED (20260207013604)
```

**Recommended execution order**:
1. ~~Migration 1 (all three fixes in one migration)~~ -- ✅ APPLIED
2. ~~Verify Migration 1 in production~~ -- ✅ VERIFIED
3. ~~Migration 2 (remove dual writes) + 3a (resend_invitation)~~ -- ✅ APPLIED
4. ~~Migration 3a (resend_invitation)~~ -- ✅ APPLIED (combined with 2)
5. ~~Migration 3b (update_org_status)~~ -- ✅ APPLIED (SQL + TypeScript)
6. Migration 4 (cleanup) -- whenever convenient

---

## 6. Documentation Updates Needed

### 6.1 New Document: CQRS Compliance ADR

**Location**: `documentation/architecture/decisions/adr-cqrs-dual-write-remediation.md`
**Content**: This audit's findings and decisions, formatted as an ADR
**Purpose**: Permanent record of the architectural violations found and how they were resolved

### 6.2 Updates to Existing Documents

| Document | Update Needed |
|----------|---------------|
| `documentation/infrastructure/patterns/event-handler-pattern.md` | 1. Update router/handler counts (16 routers, 41+ handlers per handler-reference-files.md). 2. Add section on event type naming convention. 3. Add warning about naming mismatch pitfall. 4. Update the "Available Routers and Handlers" table to reflect actual event types (underscore format). |
| `documentation/architecture/data/event-sourcing-overview.md` | 1. Add caveat that the trigger code example shows AFTER INSERT but actual system uses BEFORE INSERT. 2. Add note about event type naming convention. |
| `infrastructure/CLAUDE.md` | 1. Update router count from 4 to 16. 2. Update handler count from 37 to 41+. 3. Add warning about event type naming convention in the "Event Handler Architecture" section. |
| `documentation/AGENT-INDEX.md` | Add keyword entries: `dual-write`, `cqrs-compliance`, `event-type-naming` |

### 6.3 Corrections to Claims in Documentation

Several documents claim "all state changes emit domain events." After remediation, this will be true. Until then, the following functions violate this claim:

- `api.update_organization_status` -- no event (workflows emit separately)
- `api.resend_invitation` -- no event
- `api.revoke_invitation` -- no event (also broken due to missing columns)

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

After each migration, verify:

- [ ] `supabase db lint --level error` passes (plpgsql_check validates all functions)
- [ ] Event emitted by API function appears in `domain_events` with correct `event_type`
- [ ] Event has `processed_at` set and `processing_error` is NULL
- [ ] Projection table reflects the expected state change
- [ ] No `RAISE WARNING 'Unknown ... event type'` in PostgreSQL logs for the new event type
- [ ] Frontend operations that call the fixed function still work correctly

---

## 9. SQL Queries for Verification

```sql
-- After Migration 1b: Verify direct_care events are now routed to handler
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  'test-org-id'::uuid, 'organization', 999,
  'organization.direct_care_settings_updated',
  '{"organization_id": "test-org-id", "settings": {"enable_staff_client_mapping": true}}'::jsonb,
  '{"user_id": "test-user"}'::jsonb
);
-- Check: SELECT processed_at, processing_error FROM domain_events WHERE stream_version = 999;
-- Expected: processed_at set, processing_error NULL
-- Cleanup: DELETE FROM domain_events WHERE stream_version = 999;

-- After any migration: Check for unrouted event types
SELECT DISTINCT event_type, count(*)
FROM domain_events
WHERE processing_error IS NULL
  AND processed_at IS NOT NULL
GROUP BY event_type
ORDER BY event_type;

-- Identify events that fell through to ELSE (processed but not handled)
-- These show up in PostgreSQL logs as RAISE WARNING but not in the table
-- Query recent events and spot-check their handlers exist
```

---

## Related Documents

- `dev/active/handler-reference-files.md` -- Handler extraction plan (depends on this audit)
- `documentation/infrastructure/patterns/event-handler-pattern.md` -- Trigger/handler architecture
- `infrastructure/CLAUDE.md` -- Event handler documentation
- `documentation/architecture/data/event-sourcing-overview.md` -- CQRS architecture overview
