# Add `platform.admin.failed_event_detail_viewed` audit emission to `api.get_failed_events_with_detail`

**Status**: seed (not yet planned)
**Priority**: Medium (PHI-bearing data, audit asymmetry vs. sibling RPC)
**Origin**: PR #48 architect-review Note #2 (software-architect-dbc, 2026-05-06)

## Problem

`api.get_failed_events_with_detail` returns `processing_error_detail` rows that may contain raw `PG_EXCEPTION_DETAIL` strings — the column is documented PHI-bearing per migration `20260430002824`'s `COMMENT ON COLUMN`. Despite returning more sensitive data than its sibling, the RPC does NOT emit an audit event when invoked.

The sibling RPC `api.get_failed_events` (`baseline_v4.sql:2479-2422`, currently in production) DOES emit a `platform.admin.failed_events_viewed` event before returning. The asymmetry is a pre-existing gap from `20260430002824` (where the detail RPC was originally created) and was outside PR #48's scope.

## Why this matters

- HIPAA audit trail: every read of PHI-bearing data should be auditable. The sibling RPC sets this expectation; the detail RPC violates it.
- Forensic completeness: if the detail dashboard ever surfaces a leak (e.g., a developer pastes a `processing_error_detail` row into a non-confidential channel), the `domain_events` audit trail must record who read what and when.
- Pattern consistency: the platform-admin operations stream has `platform.admin.*_viewed` precedent; closing this gap keeps the registry uniform.

## Proposed shape

Emit a `platform.admin.failed_event_detail_viewed` event before the SELECT in `api.get_failed_events_with_detail`. Event metadata includes `user_id`, `reason: 'Failed event detail dashboard view'`, and optionally `p_limit` / `p_offset` for query scoping. Event_data is empty or echoes the pagination parameters.

Reference the existing `api.get_failed_events` emit pattern verbatim — same stream_type (`platform_admin` or whatever it currently uses), same event-naming style.

## Steps

1. Read `baseline_v4.sql:2479-2422` for the `api.get_failed_events` emit pattern.
2. Verify the `platform.admin.failed_events_viewed` event_type is registered in AsyncAPI (`infrastructure/supabase/contracts/asyncapi.yaml`); add the `_detail_viewed` variant if it's not already there.
3. Confirm a router/handler exists that no-ops or projects this event type (likely `process_platform_admin_event` or similar). If no router exists, audit how the sibling event is currently handled — it may be `WHEN ... THEN NULL` (audit-only).
4. Create migration: `supabase migration new add_failed_event_detail_viewed_audit_emission`. CREATE OR REPLACE the RPC with the new emit statement. Function signature unchanged → OID stable → `@a4c-rpc-shape: envelope` COMMENT preserved.
5. Generate types if any new fields exposed (likely not).
6. UAT: as a platform admin (any caller for whom `has_platform_privilege()` returns TRUE; on dev that's `super_admin`), call the RPC; query `domain_events WHERE event_type = 'platform.admin.failed_event_detail_viewed' AND event_metadata->>'user_id' = '<your_user_id>'` to confirm.

## Out of scope

- ~~Adding `platform.view_event_details` to a role template~~ — **resolved by 2026-06-09 consolidation migration** (`20260609212115_seed_grant_perms_into_provider_admin_and_fix_failed_events_detail_gate.sql`): the granular `platform.view_event_details` permission was retired as YAGNI; the RPC gate now uses `has_platform_privilege()` uniformly. The companion seed card `seed-platform-view-event-details-permission-seed.md` was archived as part of the same change.

## Files involved

- `infrastructure/supabase/supabase/migrations/20260430002824_strip_processing_error_detail_with_admin_rpc.sql:61-100` (current RPC body)
- `infrastructure/supabase/supabase/migrations/20260212010625_baseline_v4.sql:2479-2422` (sibling RPC pattern reference)
- `infrastructure/supabase/contracts/asyncapi.yaml` (event registration check)

## Trigger to start

Follow-up to PR #48 (sibling fix). No external trigger; can be picked up any time bandwidth allows.
