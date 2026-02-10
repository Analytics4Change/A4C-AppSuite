# Context: CQRS Dual-Write Remediation Audit

## Decision Record

**Date**: 2026-02-05 to 2026-02-09
**Feature**: CQRS Dual-Write Remediation
**Goal**: Eliminate all CQRS violations in `api.*` functions so every projection update flows exclusively through domain event handlers, ensuring audit trail completeness and event replay fidelity.

### Key Decisions

1. **Fix router CASE to match emitted event types (not vice versa)**: The emitted event types (`organization.direct_care_settings_updated` with underscore) were already stored in `domain_events`. Changing the emitted type would orphan existing events. So we updated the router to match the existing underscore convention, and documented the naming convention as the standard.

2. **Remove direct writes AFTER verifying handlers work**: Each dual-write fix was sequenced: fix routing first (P0), verify handler fires, then remove direct write (P1). This eliminated risk of breaking projections.

3. **Replace `activateOrganization` with event emission, keep `deactivateOrganization` as safety net**: The user explicitly required the safety net compensation activity be preserved. It was rewritten as a CQRS-compliant direct-write to `organizations_projection` — an intentional CQRS exception because if event emission has already failed, emitting another event would also fail.

4. **Single combined migrations where possible**: P1 dual-write removal and `resend_invitation` fix were combined into one migration (`20260207000203`) since they had no ordering dependency.

5. **Upgrade dispatcher ELSE to EXCEPTION**: `process_domain_event()` previously used `RAISE WARNING` for unknown stream_types, which silently marked events as processed. Changed to `RAISE EXCEPTION` so unknown types are caught and recorded in `processing_error`. Required adding explicit no-op entries for administrative stream_types (`platform_admin`, `workflow_queue`, `test`).

## Technical Context

### Architecture

The A4C event-driven architecture uses a single-trigger pattern:

```
INSERT INTO domain_events
  → BEFORE INSERT trigger: process_domain_event()
    → Routes by stream_type to router function (e.g., process_user_event)
      → Routes by event_type to handler (e.g., handle_user_invited)
        → Handler updates projection table
  → Event stored with processed_at timestamp
```

API functions call `api.emit_domain_event()` which does the INSERT. The trigger fires synchronously within the same transaction, so by the time the INSERT returns, the projection is already updated.

### Tech Stack

- **Database**: PostgreSQL via Supabase (PL/pgSQL functions, triggers)
- **Migrations**: Supabase CLI (`supabase migration new`, `supabase db push --linked`)
- **Validation**: `plpgsql_check` extension via `supabase db lint --level error`
- **Workflows**: Temporal.io (TypeScript activities emit events via Supabase client)
- **Frontend types**: Generated via `supabase gen types typescript --linked`

### Dependencies

- `domain_events` table — event store, single source of truth
- `process_domain_event_trigger` — BEFORE INSERT OR UPDATE trigger
- 16 router functions (`process_user_event`, `process_organization_event`, etc.)
- 54+ handler functions (`handle_user_invited`, `handle_organization_created`, etc.)
- Temporal workflow: `organization-bootstrap/workflow.ts` (Saga compensation)

## File Structure

### SQL Migrations Created

- `20260206234839_fix_p0_cqrs_critical_bugs.sql` — Fix routing mismatches, broken revoke_invitation
- `20260207000203_p1_remove_dual_writes_fix_resend.sql` — Remove dual writes, fix resend_invitation
- `20260207004639_p1_fix_bootstrap_handlers_org_status.sql` — Bootstrap handlers replace activateOrganization
- `20260207013604_p2_postgrest_pre_request_tracing.sql` — PostgREST pre-request hook for tracing
- `20260207020902_p2_drop_deprecated_accept_invitation.sql` — Drop deprecated function
- `20260207021836_p2_drop_org_status_functions.sql` — Drop org status RPCs
- `20260209031755_fix_user_invited_routing_and_check_constraint.sql` — Fix user.invited routing + CHECK
- `20260209161446_cleanup_dead_router_entries_and_dispatcher_else.sql` — Clean dead entries, upgrade ELSE

### TypeScript Files Modified

- `workflows/src/activities/organization-bootstrap/deactivate-organization.ts` — Rewritten as CQRS-compliant safety net (direct-write to projection)
- `workflows/src/activities/organization-bootstrap/index.ts` — Updated exports (removed activateOrganization)
- `workflows/src/workflows/organization-bootstrap/workflow.ts` — Restored deactivateOrganization in compensation, replaced activateOrganization with emitBootstrapCompletedActivity
- `workflows/src/shared/types/index.ts` — Removed ActivateOrganizationParams, restored DeactivateOrganizationParams
- `workflows/src/shared/utils/typed-events.ts` — Removed emitOrganizationActivated
- `workflows/src/shared/utils/index.ts` — Removed emitOrganizationActivated export
- `workflows/src/__tests__/workflows/organization-bootstrap.test.ts` — Updated mocks
- `frontend/src/types/database.types.ts` — Regenerated (dropped functions removed)
- `workflows/src/types/database.types.ts` — Regenerated (dropped functions removed)

### TypeScript Files Deleted

- `workflows/src/activities/organization-bootstrap/activate-organization.ts` — Replaced by event emission
- `workflows/src/activities/organization-bootstrap/__tests__/activate-organization.test.ts` — Deleted with activity

### Documentation Updated

- `documentation/architecture/decisions/adr-cqrs-dual-write-remediation.md` — Created, then updated
- `documentation/infrastructure/patterns/event-handler-pattern.md` — Naming convention section
- `documentation/architecture/data/event-sourcing-overview.md` — Fixed trigger example
- `infrastructure/CLAUDE.md` — Added naming convention warning
- `documentation/AGENT-INDEX.md` — Added keywords and ADR to catalog
- `workflows/README.md` — Updated directory listing
- `documentation/workflows/guides/implementation.md` — Updated activity listings
- `documentation/workflows/reference/activities-reference.md` — Updated safety net description

## Related Components

- **Edge Functions**: `invite-user`, `accept-invitation`, `resend-invitation` — emit events with `stream_type='user'` or `'invitation'`
- **Frontend**: `SupabaseUserCommandService` — calls `api.*` RPC functions
- **Temporal Worker**: Processes bootstrap workflows, emits events via activities
- **Admin Dashboard**: Displays `processing_error` from `domain_events` for failed event monitoring

## Key Patterns and Conventions

### Event Type Naming Convention
- Dots separate hierarchy levels: `organization.bootstrap.completed`
- Underscores for compound names within a level: `organization.direct_care_settings_updated`
- Never dots within compound names: ~~`organization.direct_care_settings.updated`~~

### Event Reprocessing
- Clear `processing_error` and `processed_at` → BEFORE UPDATE trigger fires → `process_domain_event()` re-routes
- Same mechanism used by `api.retry_failed_event()` and bulk reprocessing in migrations

### Router ELSE Behavior
- Must use `RAISE EXCEPTION` (ERRCODE P9001 for routers, P9002 for dispatcher)
- Exceptions caught by `process_domain_event()` outer block, recorded in `processing_error`
- `RAISE WARNING` is invisible and marks events as successfully processed

### Safety Net Pattern
- `deactivateOrganization` is an intentional CQRS exception
- Runs only when event emission has already failed
- Direct-writes to `organizations_projection` (no event emitted)
- Always runs after `emitBootstrapFailed` in compensation sequence

## Reference Materials

- `documentation/architecture/decisions/adr-cqrs-dual-write-remediation.md` — ADR
- `documentation/infrastructure/patterns/event-handler-pattern.md` — Trigger/handler architecture
- `documentation/infrastructure/patterns/event-processing-patterns.md` — Sync vs async pattern selection
- `documentation/architecture/data/event-sourcing-overview.md` — CQRS architecture overview
- `documentation/infrastructure/guides/event-observability.md` — Tracing, failed events, correlation

## Important Constraints

- **HIPAA audit compliance**: Every state change MUST have a domain event in `domain_events`
- **Single trigger rule**: NEVER create per-event-type triggers on `domain_events`
- **Synchronous processing**: BEFORE INSERT trigger means handler runs in same transaction as INSERT
- **Idempotency**: All handlers use `ON CONFLICT` for safe event replay
- **Migration ordering**: Supabase CLI generates timestamps; never create migration files manually

## Why This Approach?

**Alternative considered**: Fix event type naming in emitters (change underscore to dot). Rejected because existing events in `domain_events` already use underscore format. Changing the emitter would mean old events can't be replayed through the router without a data migration.

**Alternative considered**: Keep direct writes as a "belt and suspenders" approach alongside handlers. Rejected because it violates single-responsibility, introduces timestamp inconsistencies (`now()` vs `p_event.created_at`), and breaks event replay fidelity.

**Alternative considered**: Remove `deactivateOrganization` entirely (rely solely on `emitBootstrapFailed`). Rejected by user — the safety net is valuable when event emission itself has failed. Rewritten as CQRS-compliant direct-write instead.
