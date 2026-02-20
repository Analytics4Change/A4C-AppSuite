---
status: current
last_updated: 2026-02-19
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Split handler architecture where each domain event has a dedicated `handle_<aggregate>_<action>()` function, dispatched via explicit CASE routers for independent validation. Covers the synchronous trigger handler pattern only — for async patterns (pg_notify + Temporal), see [event-processing-patterns.md](./event-processing-patterns.md). Includes event type naming convention (dots for hierarchy, underscores for compound names).

**When to read**:
- Adding a new domain event type
- Choosing an event type name
- Debugging event processing failures
- Understanding how projections are updated

**Prerequisites**: Familiarity with CQRS concepts (see [event-sourcing-overview.md](../../architecture/data/event-sourcing-overview.md))

**Key topics**: `handler`, `event-handler`, `router`, `process_event`, `split-handlers`, `event-type-naming`, `naming-convention`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# Event Handler Pattern

## Architecture Overview

A4C uses a **split handler architecture** for processing domain events into CQRS projections:

| Component | Count | Purpose |
|-----------|-------|---------|
| **Routers** | 13 active | Thin CASE dispatchers (~50 lines each) |
| **Handlers** | 52 | Focused event processors (20-50 lines each) |
| **Triggers** | 5 | On `domain_events` (1 BEFORE INSERT/UPDATE, 4 AFTER INSERT) |

> **Note**: This document covers the **synchronous trigger handler pattern** used for projection updates. For async side effects (email, DNS, webhooks), see [Event Processing Patterns](./event-processing-patterns.md).

### Previous Architecture (Monolithic)

Before January 2026, each domain had a single monolithic processor:

```sql
-- OLD: 500+ line function handling ALL user events
CREATE OR REPLACE FUNCTION process_user_event(p_event record)
RETURNS void AS $$
BEGIN
  CASE p_event.event_type
    WHEN 'user.created' THEN
      -- 50 lines of logic inline
    WHEN 'user.phone.added' THEN
      -- 40 lines of logic inline
    -- ... 10 more event types inline
  END CASE;
END;
$$;
```

**Problems**:
- Adding one event required replacing the entire function
- Bug in one handler broke ALL event processing for that domain
- plpgsql_check couldn't pinpoint issues to specific handlers
- Code reviews showed entire function diffs

### Current Architecture (Split Handlers)

```
domain_events → process_domain_event() BEFORE INSERT trigger (single trigger)
                        ↓
        Special routing: *.linked / *.unlinked events → process_junction_event(NEW)
                        ↓
        Routes by stream_type to:
        ├── process_user_event(NEW)           (user lifecycle, phones, addresses, schedules, clients)
        ├── process_organization_event(NEW)   (org lifecycle, subdomains, bootstrap, invitations)
        ├── process_organization_unit_event(NEW)
        ├── process_rbac_event(NEW)           (roles, permissions, user role assignments)
        ├── process_invitation_event(NEW)     (invited, accepted, revoked, expired)
        ├── process_contact_event(NEW)        (CRUD + user linking)
        ├── process_address_event(NEW)
        ├── process_phone_event(NEW)
        ├── process_email_event(NEW)
        ├── process_access_grant_event(NEW)   (cross-tenant grants)
        └── process_impersonation_event(NEW)
                        ↓
        Each router dispatches by event_type to:
        ├── handle_user_created()
        ├── handle_user_phone_added()
        ├── handle_organization_created()
        └── ... (50 handlers total)
```

> **⚠️ CRITICAL: Single trigger only — NEVER create per-event-type triggers**
>
> There is exactly ONE trigger on `domain_events`: the `process_domain_event_trigger`
> (BEFORE INSERT/UPDATE). It routes by `stream_type` to the appropriate router.
>
> **Do NOT** create additional triggers with WHEN clauses filtering specific event types
> (e.g., `WHEN (NEW.event_type = ANY (ARRAY['user.foo.created', ...]))`). This pattern
> was used in an early migration but was removed by `remove_duplicate_event_triggers`
> (migration `20260204220526`). Duplicate triggers cause double-processing.
>
> When adding new event types, only add a CASE line to the appropriate router function.

> **⚠️ Field name: Use `stream_id`, NOT `aggregate_id`**
>
> The `domain_events` table column is `stream_id`. Handlers receive the full row from
> `process_domain_event()` which passes `NEW`. Always use `p_event.stream_id` —
> `p_event.aggregate_id` does not exist and causes a runtime error.

## Router Pattern

Routers are thin CASE dispatchers that call individual handlers:

```sql
CREATE OR REPLACE FUNCTION process_user_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  CASE p_event.event_type
    -- User lifecycle
    WHEN 'user.created' THEN PERFORM handle_user_created(p_event);
    WHEN 'user.synced_from_auth' THEN PERFORM handle_user_synced_from_auth(p_event);
    WHEN 'user.deactivated' THEN PERFORM handle_user_deactivated(p_event);
    WHEN 'user.reactivated' THEN PERFORM handle_user_reactivated(p_event);

    -- Role assignments
    WHEN 'user.role.assigned' THEN PERFORM handle_user_role_assigned(p_event);

    -- Phone management
    WHEN 'user.phone.added' THEN PERFORM handle_user_phone_added(p_event);
    WHEN 'user.phone.updated' THEN PERFORM handle_user_phone_updated(p_event);
    WHEN 'user.phone.removed' THEN PERFORM handle_user_phone_removed(p_event);

    -- Address management
    WHEN 'user.address.added' THEN PERFORM handle_user_address_added(p_event);
    WHEN 'user.address.updated' THEN PERFORM handle_user_address_updated(p_event);
    WHEN 'user.address.removed' THEN PERFORM handle_user_address_removed(p_event);

    -- Preferences
    WHEN 'user.notification_preferences.updated' THEN
      PERFORM handle_user_notification_preferences_updated(p_event);

    -- Unhandled event type — MUST be EXCEPTION, not WARNING
    ELSE
      RAISE EXCEPTION 'Unhandled event type "%" in process_user_event', p_event.event_type
        USING ERRCODE = 'P9001';
  END CASE;
END;
$$;
```

**Key characteristics**:
- Explicit CASE (not dynamic dispatch) - plpgsql_check validates all handler calls
- One line per event type - easy to scan and modify
- No business logic - only dispatching
- RAISE EXCEPTION for unhandled types — caught by `process_domain_event()` and recorded in `processing_error` (visible in admin dashboard). NEVER use RAISE WARNING (it's invisible and marks the event as processed).
- If an event type intentionally has no handler, add an explicit no-op: `WHEN 'audit.only' THEN NULL;`

## Handler Pattern

Each handler is a focused function for a single event type:

```sql
CREATE OR REPLACE FUNCTION handle_user_phone_added(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id UUID := (p_event.event_data->>'user_id')::UUID;
  v_phone_id UUID := (p_event.event_data->>'phone_id')::UUID;
  v_org_id UUID := (p_event.event_data->>'org_id')::UUID;
BEGIN
  IF v_org_id IS NULL THEN
    -- Global phone (visible across all orgs)
    INSERT INTO user_phones (
      id, user_id, label, type, number, extension,
      country_code, is_primary, sms_capable, is_active, created_at, updated_at
    ) VALUES (
      v_phone_id,
      v_user_id,
      p_event.event_data->>'label',
      p_event.event_data->>'type',
      p_event.event_data->>'number',
      p_event.event_data->>'extension',
      COALESCE(p_event.event_data->>'country_code', '+1'),
      COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, false),
      COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, false),
      true,
      p_event.created_at,
      p_event.created_at
    )
    ON CONFLICT (id) DO NOTHING;  -- Idempotent
  ELSE
    -- Org-specific phone override
    INSERT INTO user_org_phone_overrides (
      id, user_id, organization_id, label, type, number, extension,
      country_code, is_primary, sms_capable, is_active, created_at, updated_at
    ) VALUES (
      v_phone_id,
      v_user_id,
      v_org_id,
      p_event.event_data->>'label',
      p_event.event_data->>'type',
      p_event.event_data->>'number',
      p_event.event_data->>'extension',
      COALESCE(p_event.event_data->>'country_code', '+1'),
      COALESCE((p_event.event_data->>'is_primary')::BOOLEAN, false),
      COALESCE((p_event.event_data->>'sms_capable')::BOOLEAN, false),
      true,
      p_event.created_at,
      p_event.created_at
    )
    ON CONFLICT (id) DO NOTHING;  -- Idempotent
  END IF;
END;
$$;
```

**Key characteristics**:
- Single responsibility - one event type only
- Idempotent - uses `ON CONFLICT DO NOTHING` or `DO UPDATE`
- Uses `p_event.created_at` for timestamps (not `NOW()`)
- No error handling - parent trigger catches exceptions
- No event emission - handlers only update projections

## Adding a New Event Handler

### Step 1: Create the Handler Function

```sql
-- File: new migration via `supabase migration new add_user_foo_handler`

CREATE OR REPLACE FUNCTION handle_user_foo_created(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_foo_id UUID := (p_event.event_data->>'foo_id')::UUID;
  v_user_id UUID := (p_event.event_data->>'user_id')::UUID;
BEGIN
  INSERT INTO user_foos (id, user_id, name, created_at, updated_at)
  VALUES (
    v_foo_id,
    v_user_id,
    p_event.event_data->>'name',
    p_event.created_at,
    p_event.created_at
  )
  ON CONFLICT (id) DO NOTHING;
END;
$$;
```

### Step 2: Add CASE Line to Router

```sql
-- In the same migration, update the router
CREATE OR REPLACE FUNCTION process_user_event(p_event record)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  CASE p_event.event_type
    -- ... existing handlers ...
    WHEN 'user.foo.created' THEN PERFORM handle_user_foo_created(p_event);
    ELSE RAISE EXCEPTION 'Unhandled event type "%" in process_user_event', p_event.event_type
      USING ERRCODE = 'P9001';
  END CASE;
END;
$$;
```

### Step 3: Deploy via Supabase CLI

```bash
cd infrastructure/supabase
supabase migration new add_user_foo_handler
# Edit the generated file with handler + router update
supabase db push --linked --dry-run  # Preview
supabase db push --linked            # Apply
```

### Step 4: CI Validates with plpgsql_check

The GitHub Actions workflow automatically:
1. Applies migration to validate SQL syntax
2. Runs `supabase db lint --level error` to validate all PL/pgSQL functions
3. Blocks deployment if any function has errors

## Available Routers and Handlers

### User Events Router: `process_user_event()`

| Event Type | Handler |
|------------|---------|
| `user.created` | `handle_user_created` |
| `user.synced_from_auth` | `handle_user_synced_from_auth` |
| `user.role.assigned` | `handle_user_role_assigned` |
| `user.role.revoked` | `handle_user_role_revoked` |
| `user.access_dates_updated` | `handle_user_access_dates_updated` |
| `user.notification_preferences.updated` | `handle_user_notification_preferences_updated` |
| `user.address.added` | `handle_user_address_added` |
| `user.address.updated` | `handle_user_address_updated` |
| `user.address.removed` | `handle_user_address_removed` |
| `user.phone.added` | `handle_user_phone_added` |
| `user.phone.updated` | `handle_user_phone_updated` |
| `user.phone.removed` | `handle_user_phone_removed` |
| `user.client.assigned` | `handle_user_client_assigned` |
| `user.client.unassigned` | `handle_user_client_unassigned` |

### Organization Events Router: `process_organization_event()`

| Event Type | Handler |
|------------|---------|
| `organization.created` | `handle_organization_created` |
| `organization.updated` | `handle_organization_updated` |
| `organization.deactivated` | `handle_organization_deactivated` |
| `organization.reactivated` | `handle_organization_reactivated` |
| `organization.deleted` | `handle_organization_deleted` |
| `organization.subdomain_status.changed` | `handle_organization_subdomain_status_changed` |
| `organization.subdomain.verified` | `handle_organization_subdomain_verified` |
| `organization.subdomain.dns_created` | `handle_organization_subdomain_dns_created` |
| `organization.subdomain.failed` | `handle_organization_subdomain_failed` |
| `organization.activated` | `handle_organization_activated` |
| `organization.direct_care_settings_updated` | `handle_organization_direct_care_settings_updated` |
| `organization.bootstrap.initiated` | No-op (informational event) |
| `organization.bootstrap.completed` | `handle_bootstrap_completed` |
| `organization.bootstrap.failed` | `handle_bootstrap_failed` |
| `organization.bootstrap.cancelled` | `handle_bootstrap_cancelled` |
| `invitation.resent` | `handle_invitation_resent` (forwarding CASE — pre-v15 Edge Function emitted with `stream_type='organization'`; delegates to `process_invitation_event()` handler) |

### Organization Unit Events Router: `process_organization_unit_event()`

| Event Type | Handler |
|------------|---------|
| `organization_unit.created` | `handle_organization_unit_created` |
| `organization_unit.updated` | `handle_organization_unit_updated` |
| `organization_unit.deactivated` | `handle_organization_unit_deactivated` |
| `organization_unit.reactivated` | `handle_organization_unit_reactivated` |
| `organization_unit.deleted` | `handle_organization_unit_deleted` |

### Schedule Events Router: `process_schedule_event()`

| Event Type | Handler |
|------------|---------|
| `schedule.created` | `handle_schedule_created` |
| `schedule.updated` | `handle_schedule_updated` |
| `schedule.deactivated` | `handle_schedule_deactivated` |
| `schedule.reactivated` | `handle_schedule_reactivated` |
| `schedule.deleted` | `handle_schedule_deleted` |
| `schedule.user_assigned` | `handle_schedule_user_assigned` |
| `schedule.user_unassigned` | `handle_schedule_user_unassigned` |

### RBAC Events Router: `process_rbac_event()`

| Event Type | Handler |
|------------|---------|
| `role.created` | `handle_role_created` |
| `role.updated` | `handle_role_updated` |
| `role.deactivated` | `handle_role_deactivated` |
| `role.reactivated` | `handle_role_reactivated` |
| `role.deleted` | `handle_role_deleted` |
| `role.permission.granted` | `handle_role_permission_granted` |
| `role.permission.revoked` | `handle_role_permission_revoked` |
| `permission.defined` | `handle_permission_defined` |
| `permission.updated` | `handle_permission_updated` |
| `user.role.assigned` | `handle_rbac_user_role_assigned` |
| `user.role.revoked` | `handle_user_role_revoked` |

### Invitation Events Router: `process_invitation_event()`

| Event Type | Handler |
|------------|---------|
| `user.invited` | Inline: INSERT into `invitations_projection` |
| `invitation.accepted` | Inline: UPDATE status to 'accepted' |
| `invitation.revoked` | Inline: UPDATE status to 'revoked' |
| `invitation.expired` | Inline: UPDATE status to 'expired' |
| `invitation.resent` | `handle_invitation_resent` |

### Additional Routers (Inline Handlers)

The following routers handle events with inline CASE logic rather than separate `handle_*` functions. They follow the same CQRS compliance requirements.

| Router | Stream Types | Event Types |
|--------|-------------|-------------|
| `process_contact_event` | `contact` | `contact.created`, `contact.updated`, `contact.deleted`, `contact.user.linked`, `contact.user.unlinked` |
| `process_address_event` | `address` | `address.created`, `address.updated`, `address.deleted` |
| `process_phone_event` | `phone` | `phone.created`, `phone.updated`, `phone.deleted` |
| `process_email_event` | `email` | `email.created`, `email.updated`, `email.deleted` |
| `process_access_grant_event` | `access_grant` | `access_grant.created`, `access_grant.revoked`, `access_grant.expired`, `access_grant.suspended`, `access_grant.reactivated` |
| `process_impersonation_event` | `impersonation` | `impersonation.started`, `impersonation.renewed`, `impersonation.ended` |
| `process_junction_event` | (any `*.linked`/`*.unlinked`) | `organization.contact.linked`, `contact.phone.linked`, etc. |

## Event Type Naming Convention

Event types follow a dot-separated hierarchy: `{stream_type}.{entity}.{action}` or `{stream_type}.{action}`.

### Rules

1. **Dots separate hierarchy levels** — stream type, optional sub-entity, and action:
   - `user.created` (stream_type + action)
   - `user.phone.added` (stream_type + entity + action)
   - `organization.subdomain.verified` (stream_type + entity + action)

2. **Underscores for compound words within a level** — when a stream type, entity name, or action is multi-word, use underscores:
   - `organization_unit.created` (compound stream type)
   - `organization.direct_care_settings_updated` (compound entity + action)
   - `user.synced_from_auth` (compound action)
   - `user.notification_preferences.updated` (compound entity)

3. **Never use dots within a compound name** — dots always mean hierarchy boundaries:
   - `organization.direct_care_settings_updated` (compound action name)
   - ~~`organization.direct_care_settings.updated`~~ (wrong — the router won't match)

4. **Action names are past tense** — events describe what already happened:
   - `created`, `updated`, `deleted`, `deactivated`, `revoked`, `synced_from_auth`

### Quick Reference

| Pattern | Example | Explanation |
|---------|---------|-------------|
| `{stream}.{action}` | `user.created` | Simple action on stream entity |
| `{stream}.{entity}.{action}` | `user.phone.added` | Action on sub-entity |
| `{stream}.{compound_action}` | `organization.direct_care_settings_updated` | Multi-word action (underscores) |
| `{compound_stream}.{action}` | `organization_unit.created` | Multi-word stream type (underscores) |
| `{stream}.{entity}.{compound_action}` | `organization.subdomain.dns_created` | Sub-entity with compound action |

### Historical Note

Early development used inconsistent conventions, with some routers expecting dot-separated compound names (`organization.direct_care_settings.updated`) while API functions emitted underscore-separated names (`organization.direct_care_settings_updated`). This mismatch caused handlers to silently never fire. Fixed in migration `20260206234839_fix_p0_cqrs_critical_bugs`.

## CQRS Compliance Requirements

Every handler MUST follow these rules:

| Requirement | How to Implement |
|-------------|------------------|
| **Idempotent** | Use `ON CONFLICT (id) DO NOTHING` or `DO UPDATE` |
| **Timestamp from event** | Use `p_event.created_at`, not `NOW()` |
| **No event emission** | Handlers only update projections |
| **No cross-projection queries** | Projections are denormalized |
| **No direct projection writes in API functions** | API functions emit events; only handlers update projections |

> **Resolved Issues (see [CQRS Dual-Write Audit](../../../dev/archived/cqrs-dual-write-audit/cqrs-dual-write-audit-context.md))**:
> All P0 and P1 CQRS violations have been remediated:
> - Event type naming mismatches fixed (migration `20260206234839`)
> - Dual-write patterns removed from API functions (migration `20260207000203`)
> - Direct-write-only functions converted to emit events (migrations `20260207000203`, `20260207004639`)
> - Router ELSE clauses updated to RAISE EXCEPTION (migration `20260207000203`)
> - Deprecated `api.accept_invitation` dropped (migration `20260207020902`)

## Debugging Event Processing

### Check for Failed Events

```sql
SELECT id, event_type, stream_id, processing_error, created_at
FROM domain_events
WHERE processing_error IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;
```

### Reprocess a Failed Event

```sql
UPDATE domain_events
SET processed_at = NULL, processing_error = NULL
WHERE id = '<event_id>';
```

### Trace Event Processing

```sql
-- Find all events for a stream (entity)
SELECT id, event_type, processed_at, processing_error, created_at
FROM domain_events
WHERE stream_id = '<stream_id>'
ORDER BY created_at;
```

### Validate a Specific Handler

```sql
SELECT * FROM plpgsql_check_function('handle_user_phone_added(record)'::regprocedure);
```

## Handler Reference Files

Canonical SQL source for every handler, router, and trigger is at `infrastructure/supabase/handlers/`. These files serve two purposes:

1. **Day Zero migration resets**: Copy unchanged functions verbatim into new baseline migrations — prevents column drift and logic errors
2. **Regular development**: Reference when modifying existing handlers — copy, then modify the copy

These are documentation files (not deployment artifacts) — the source of truth is always the deployed database via migrations.

```
handlers/
├── README.md                    # Sync rules, usage instructions
├── trigger/                     # 5 trigger function files
├── routers/                     # 12 active router files
├── user/                        # 20 handler files
├── organization/                # 11 handler files
├── organization_unit/           # 5 handler files
├── rbac/                        # 10 handler files
├── bootstrap/                   # 3 handler files
└── invitation/                  # 1 handler file
```

**Workflow**:
1. **Before modifying a handler**: Read `handlers/<domain>/<handler>.sql`, copy it into your migration, modify the copy
2. **After creating a migration**: Update the reference file to match the new version
3. **Adding a new handler**: Create handler + router CASE line in migration, then create reference file
4. **Day Zero baseline consolidation**: Copy unchanged functions verbatim from reference files — see [Day 0 Migration Guide](../guides/supabase/DAY0-MIGRATION-GUIDE.md#handler-reference-files)

## Related Documentation

- [Event Processing Patterns](./event-processing-patterns.md) - Decision guide for choosing sync vs async patterns
- [Event Sourcing Overview](../../architecture/data/event-sourcing-overview.md) - CQRS architecture
- [Event Sourcing & CQRS Projections](../../architecture/data/event-sourcing-overview.md) - Projection table design
- [Event Observability](../guides/event-observability.md) - Monitoring, tracing, failed events
- [Supabase Migrations](../guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) - Idempotent migration patterns
- [Day 0 Migration Guide](../guides/supabase/DAY0-MIGRATION-GUIDE.md) - Baseline consolidation with handler reference files
- [AsyncAPI Contracts](../../../infrastructure/supabase/contracts/README.md) - Event schema definitions
- [CQRS Dual-Write Audit](../../../dev/archived/cqrs-dual-write-audit/cqrs-dual-write-audit-context.md) - Audit of CQRS compliance violations
