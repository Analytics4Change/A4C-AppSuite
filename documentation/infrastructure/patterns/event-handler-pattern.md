---
status: current
last_updated: 2026-02-05
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Split handler architecture where each domain event has a dedicated `handle_<aggregate>_<action>()` function, dispatched via explicit CASE routers for independent validation.

**When to read**:
- Adding a new domain event type
- Debugging event processing failures
- Understanding how projections are updated

**Prerequisites**: Familiarity with CQRS concepts (see [event-sourcing-overview.md](../../architecture/data/event-sourcing-overview.md))

**Key topics**: `handler`, `event-handler`, `router`, `process_event`, `split-handlers`

**Estimated read time**: 8 minutes
<!-- TL;DR-END -->

# Event Handler Pattern

## Architecture Overview

A4C uses a **split handler architecture** for processing domain events into CQRS projections:

| Component | Count | Purpose |
|-----------|-------|---------|
| **Routers** | 4 | Thin CASE dispatchers (~50 lines each) |
| **Handlers** | 37 | Focused event processors (20-50 lines each) |

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
        Routes by stream_type to:
        ├── process_user_event(NEW)
        ├── process_organization_event(NEW)
        ├── process_organization_unit_event(NEW)
        └── process_rbac_event(NEW)
                        ↓
        Each router dispatches by event_type to:
        ├── handle_user_created()
        ├── handle_user_phone_added()
        ├── handle_organization_created()
        └── ... (39+ handlers total)
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
    WHEN 'user.invited' THEN PERFORM handle_user_invited(p_event);

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

    -- Unknown event type
    ELSE
      RAISE WARNING 'Unknown user event type: %', p_event.event_type;
  END CASE;
END;
$$;
```

**Key characteristics**:
- Explicit CASE (not dynamic dispatch) - plpgsql_check validates all handler calls
- One line per event type - easy to scan and modify
- No business logic - only dispatching
- RAISE WARNING for unknown types - aids debugging

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
    ELSE RAISE WARNING 'Unknown user event type: %', p_event.event_type;
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
| `user.invited` | `handle_user_invited` |
| `user.role.assigned` | `handle_user_role_assigned` |
| `user.access_dates.updated` | `handle_user_access_dates_updated` |
| `user.notification_preferences.updated` | `handle_user_notification_preferences_updated` |
| `user.phone.added` | `handle_user_phone_added` |
| `user.phone.updated` | `handle_user_phone_updated` |
| `user.phone.removed` | `handle_user_phone_removed` |
| `user.address.added` | `handle_user_address_added` |
| `user.address.updated` | `handle_user_address_updated` |
| `user.address.removed` | `handle_user_address_removed` |
| `user.schedule.created` | `handle_user_schedule_created` |
| `user.schedule.updated` | `handle_user_schedule_updated` |
| `user.schedule.deactivated` | `handle_user_schedule_deactivated` |
| `user.schedule.reactivated` | `handle_user_schedule_reactivated` |
| `user.schedule.deleted` | `handle_user_schedule_deleted` |
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
| `organization.direct_care_settings.updated` | `handle_organization_direct_care_settings_updated` |
| `bootstrap.completed` | `handle_bootstrap_completed` |
| `bootstrap.failed` | `handle_bootstrap_failed` |
| `bootstrap.cancelled` | `handle_bootstrap_cancelled` |
| `user.invited` | `handle_user_invited` |
| `invitation.resent` | `handle_invitation_resent` |

### Organization Unit Events Router: `process_organization_unit_event()`

| Event Type | Handler |
|------------|---------|
| `organization_unit.created` | `handle_organization_unit_created` |
| `organization_unit.updated` | `handle_organization_unit_updated` |
| `organization_unit.deactivated` | `handle_organization_unit_deactivated` |
| `organization_unit.reactivated` | `handle_organization_unit_reactivated` |
| `organization_unit.deleted` | `handle_organization_unit_deleted` |

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

## CQRS Compliance Requirements

Every handler MUST follow these rules:

| Requirement | How to Implement |
|-------------|------------------|
| **Idempotent** | Use `ON CONFLICT (id) DO NOTHING` or `DO UPDATE` |
| **Timestamp from event** | Use `p_event.created_at`, not `NOW()` |
| **No event emission** | Handlers only update projections |
| **No cross-projection queries** | Projections are denormalized |

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

## Related Documentation

- [Event Sourcing Overview](../../architecture/data/event-sourcing-overview.md) - CQRS architecture
- [CQRS Projections](../../../.claude/skills/infrastructure-guidelines/resources/cqrs-projections.md) - Projection table design
- [Supabase Migrations](../guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) - Idempotent migration patterns
- [AsyncAPI Contracts](../../../infrastructure/supabase/contracts/README.md) - Event schema definitions
