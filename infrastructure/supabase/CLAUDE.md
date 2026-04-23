---
status: current
last_updated: 2026-04-23
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Rules for `infrastructure/supabase/` — Supabase CLI migration workflow, plpgsql_check validation, event handler architecture (single trigger → router → handler), AsyncAPI type generation, and the projection-read-back guard (Pattern A — return-error envelope; see [adr-rpc-readback-pattern.md](../../documentation/architecture/decisions/adr-rpc-readback-pattern.md)).

**When to read**:
- Creating or modifying a SQL migration
- Writing a new event handler or router
- Touching `infrastructure/supabase/contracts/asyncapi.yaml`
- Debugging a `processing_error` on `domain_events`
- Configuring OAuth or JWT custom claims

**Prerequisites**: PostgreSQL fundamentals, Supabase CLI installed, basic understanding of CQRS/event sourcing

**Key topics**: `supabase`, `migrations`, `plpgsql_check`, `event-handler`, `router`, `asyncapi`, `oauth`, `rls`

**Estimated read time**: 12 minutes
<!-- TL;DR-END -->

# Supabase Guidelines

This file governs `infrastructure/supabase/`. Three concerns: migration workflow, event handler architecture, and AsyncAPI contracts.

## Supabase CLI Migrations

```bash
cd infrastructure/supabase
export SUPABASE_ACCESS_TOKEN="your-access-token"
supabase link --project-ref "your-project-ref"

# Preview pending migrations (dry-run)
supabase db push --linked --dry-run

# Apply migrations
supabase db push --linked

# Check migration status
supabase migration list --linked

# Create a new migration (for future schema changes)
supabase migration new my_new_feature

# Repair migration history (if needed)
supabase migration repair --status applied <version>
supabase migration repair --status reverted <version>
```

> **⚠️ CRITICAL: Always use `supabase migration new` — NEVER manually create migration files**
>
> The Supabase CLI generates the correct UTC timestamp. Manually creating files with
> hand-typed timestamps causes migration ordering errors that break CI/CD.
>
> ```bash
> # ✅ CORRECT: CLI generates timestamp
> supabase migration new feature_name
>
> # ❌ WRONG: Manual file creation
> touch supabase/migrations/20251223120000_feature.sql
> ```

> **⚠️ MCP Tool Warning: `mcp__supabase__apply_migration` generates its own timestamp**
>
> If you use the MCP `apply_migration` tool, it auto-generates a timestamp that won't
> match a manually-created local file. This causes CI/CD failures with:
> `"Remote migration versions not found in local migrations directory"`
>
> **Correct workflow when using MCP:**
> 1. Apply via MCP first (note the returned timestamp, e.g., `20260118023619`)
> 2. Create local file with **matching** timestamp:
>    `git mv old_name.sql supabase/migrations/20260118023619_feature.sql`
> 3. Commit to git
>
> **Or better — use CLI workflow:**
> 1. `supabase migration new feature_name` (generates timestamp)
> 2. Edit the generated file
> 3. `supabase db push --linked` (applies to remote)
> 4. Commit to git

**Note**: Docker/Podman is required for some Supabase CLI commands. Set `DOCKER_HOST=unix:///run/user/1000/podman/podman.sock` if using Podman.

## PL/pgSQL Validation (plpgsql_check)

CI/CD validates all PL/pgSQL functions before deploying migrations. Catches column name mismatches, type errors, and other issues before reaching production.

**CI/CD Validation** (automatic):
- GitHub Actions runs `supabase db lint --level error` before every deployment
- Validation failures block deployment to production
- PRs with migration changes are validated automatically

**Manual Validation** (local debugging):
```bash
cd infrastructure/supabase
supabase start
supabase db push --local
supabase db lint --level error      # Errors only
supabase db lint --level warning    # Includes warnings
supabase stop --no-backup
```

**Raw SQL Validation** (advanced):
```sql
-- Check a specific function
SELECT * FROM plpgsql_check_function('process_user_event(record)'::regprocedure);

-- Check ALL functions in public/api schemas
SELECT p.proname, plpgsql_check_function(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
  AND n.nspname IN ('public', 'api');
```

**What plpgsql_check catches**: column name mismatches, type errors in assignments, unused/uninitialized variables, dead code paths, missing RETURN statements.

**Limitation**: cannot validate JSONB field access (e.g., `p_event.event_data->>'field'`). Validates SQL column names, not JSONB structure.

## Event Handler Architecture

Event processing uses **split handlers** (not monolithic processors):

**Routers** (13 active):
- `process_user_event()`, `process_organization_event()`, `process_rbac_event()`, `process_invitation_event()`, `process_contact_event()`, `process_address_event()`, `process_phone_event()`, `process_email_event()`, `process_access_grant_event()`, `process_impersonation_event()`, `process_organization_unit_event()`, `process_schedule_event()`
- Plus `process_junction_event()` for all `*.linked`/`*.unlinked` events
- Thin CASE dispatchers (~50 lines each)
- Dispatch to individual handlers based on `event_type`

**Handlers** (52 total):
- `handle_user_phone_added()`, `handle_organization_created()`, etc.
- One function per event type
- 20-50 lines each, single responsibility
- Validated independently by plpgsql_check

**Triggers on `domain_events`** (5):
- `process_domain_event_trigger` (BEFORE INSERT/UPDATE) — main dispatcher
- `bootstrap_workflow_trigger` (AFTER INSERT)
- `enqueue_workflow_from_bootstrap_event_trigger` (AFTER INSERT)
- `trigger_notify_bootstrap_initiated` (BEFORE INSERT)
- `update_workflow_queue_projection_trigger` (AFTER INSERT)

**Two event processing patterns** — choose based on what the handler does:
- **Projection updates** → Synchronous BEFORE INSERT trigger handler (immediate consistency)
- **Side effects (email, DNS, webhooks)** → Async AFTER INSERT trigger → pg_notify → Temporal
- **See**: [`event-processing-patterns.md`](../../documentation/infrastructure/patterns/event-processing-patterns.md) for the full decision guide

### Handler Reference Files — Read Before Writing, Copy for Day Zero

> **⚠️ CRITICAL: Always read the reference file before modifying any handler or router.**
>
> During Day Zero baseline resets, copy unchanged functions **verbatim** from these
> files instead of rewriting. See [Day 0 Migration Guide](../../documentation/infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md#handler-reference-files).

Canonical SQL for every handler, router, and trigger lives at `infrastructure/supabase/handlers/`:

```
handlers/
├── trigger/           # 5 trigger function files
├── routers/           # 12 active router files
├── user/              # 20 handler files
├── organization/      # 11 handler files
├── organization_unit/ # 5 handler files
├── rbac/              # 10 handler files
├── bootstrap/         # 3 handler files
└── invitation/        # 1 handler file
```

**Before modifying a handler**: Read `handlers/<domain>/<handler>.sql`, copy it, modify the copy.
**After creating a migration**: Update the reference file to match the new version.
**Adding a new handler**: Create handler + router CASE line in migration, then create reference file.

**Adding a new event handler**:
1. Read the existing router reference file: `handlers/routers/process_<domain>_event.sql`
2. Create handler: `handle_<aggregate>_<action>(p_event record)`
3. Add CASE line to appropriate router: `WHEN 'event.type' THEN PERFORM handle_...();`
4. Deploy via `supabase migration new <name>` then `supabase db push --linked`
5. Create reference files: `handlers/<domain>/<handler>.sql` and update `handlers/routers/<router>.sql`
6. CI validates with plpgsql_check automatically

### Critical Rules

> **⚠️ CRITICAL: NEVER create per-event-type triggers on `domain_events`**
>
> All event routing goes through a **single** `process_domain_event()` BEFORE INSERT
> trigger. This trigger dispatches by `stream_type` to the appropriate router function,
> which then dispatches by `event_type` to individual handlers. **Do NOT create
> additional triggers** with WHEN clauses filtering specific event types — duplicate
> triggers cause events to be processed multiple times.
>
> ```
> ✅ CORRECT: Add CASE line to router function
>    process_domain_event() → process_user_event(NEW) → handle_user_foo(NEW)
>
> ❌ WRONG: Create trigger with WHEN clause
>    CREATE TRIGGER my_trigger AFTER INSERT ON domain_events
>    WHEN (NEW.event_type = 'user.foo.created') ...
> ```

> **⚠️ Event type naming convention**
>
> Event types use dots to separate hierarchy levels and underscores for compound names
> within a level. Example: `user.phone.added`, `organization.direct_care_settings_updated`.
> Never use dots within a compound name (e.g., ~~`organization.direct_care_settings.updated`~~).
> See [event-handler-pattern.md](../../documentation/infrastructure/patterns/event-handler-pattern.md#event-type-naming-convention).

> **⚠️ Event record field: Use `stream_id`, NOT `aggregate_id`**
>
> The `domain_events` table column is `stream_id`. Handlers receive the record from
> `process_domain_event()` which passes `NEW` (the `domain_events` row). Always use
> `p_event.stream_id` in handler functions — `p_event.aggregate_id` does not exist
> and will cause a runtime error.

> **⚠️ Router ELSE: Must `RAISE EXCEPTION`, not `RAISE WARNING`**
>
> Router ELSE clauses must use `RAISE EXCEPTION` (not `RAISE WARNING`) for unhandled
> event types. Exceptions are caught by `process_domain_event()` and recorded in
> `processing_error` (visible in admin dashboard). Warnings are invisible and mark
> the event as successfully processed.

> **⚠️ API functions must NEVER write projections directly**
>
> All projection updates go through event handlers. API functions emit events via
> `api.emit_domain_event()`; handlers update projections. Direct writes bypass the
> audit trail and break event replay.

> **⚠️ RPC functions that read back from projections MUST check for NOT FOUND**
>
> When an RPC emits a domain event and then reads the projection to build its
> response, it MUST check `IF NOT FOUND` after the SELECT INTO. If the event handler
> fails, the exception is caught by `process_domain_event()` (recorded in
> `processing_error`), but the RPC continues execution. Without a NOT FOUND check,
> the RPC returns `{success: true}` with null fields — a silent failure.
>
> On NOT FOUND, fetch the actual `processing_error` from `domain_events` and
> `RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'))`.
> **NEVER `RAISE EXCEPTION` here** — that rolls back the audit row that the trigger
> just persisted with `processing_error`, destroying the diagnostic evidence
> (admin dashboard at `/admin/events` would see zero failed events;
> `api.retry_failed_event()` would have nothing to retry).

**See**:
- [adr-rpc-readback-pattern.md](../../documentation/architecture/decisions/adr-rpc-readback-pattern.md) for the full contract decision (response shape, audit-trail-preservation rationale, telemetry convention, and the inventory of 18 RPCs that follow this pattern).
- [event-handler-pattern.md](../../documentation/infrastructure/patterns/event-handler-pattern.md) for the complete implementation guide.

## CQRS Query Rule

> **⚠️ CRITICAL: All frontend queries MUST use `api.` schema RPC functions.**

Projection tables are denormalized read models — never queried directly with PostgREST embedding across tables.

| ✅ Correct | ❌ Wrong |
|-----------|----------|
| `api.list_users(p_org_id)` | `.from('users').select(..., user_roles_projection!inner(...))` |
| `api.get_roles(p_org_id)` | `.from('roles_projection').select(..., permissions!inner(...))` |
| `api.get_organizations()` | `.from('organizations_projection').select(...)` |

**Why**: Projections are denormalized at event-processing time — joins should NOT happen at query time. PostgREST embedding re-normalizes data, defeating CQRS benefits. Violating this pattern causes 406 errors and breaks multi-tenant isolation.

**When creating new query functionality**:
1. Create RPC function in `api` schema (e.g., `api.list_users()`)
2. Grant EXECUTE to `authenticated` role
3. Frontend calls via `.schema('api').rpc('function_name', params)`
4. Never use `.from('table').select()` with `!inner` joins across projections

## Event Metadata Requirements

All domain events emitted via `api.emit_domain_event()` must include audit context in metadata:

| Field | When Required | Description |
|-------|---------------|-------------|
| `user_id` | Always (who initiated) | UUID of user who triggered the action |
| `reason` | When action has business context | Human-readable justification |
| `ip_address` | Edge Functions only | From request headers |
| `user_agent` | Edge Functions only | From request headers |
| `request_id` | When available from API | Correlation with API logs |

This metadata enables audit queries directly against `domain_events` without a separate audit table:

```sql
SELECT event_type, event_metadata->>'user_id' as actor,
       event_metadata->>'reason' as reason, created_at
FROM domain_events WHERE stream_id = '<resource_id>'
ORDER BY created_at DESC;
```

## Correlation ID Pattern (Business-Scoped)

`correlation_id` ties together the ENTIRE business transaction lifecycle, not just a single request.

**Edge Function Implementation**:
- **Creating entity**: Generate and STORE `correlation_id` with the entity
- **Updating entity**: LOOKUP and REUSE the stored `correlation_id`
- **Never generate** new `correlation_id` for subsequent lifecycle events

**Example — Invitation Lifecycle**:
```typescript
// validate-invitation: Returns stored correlation_id
const invitation = await supabase.rpc('get_invitation_by_token', { p_token });

// accept-invitation: Reuses stored correlation_id
if (invitation.correlation_id) {
  tracingContext.correlationId = invitation.correlation_id;
}
// All events (user.created, invitation.accepted) use same correlation_id
```

**See**: [event-metadata-schema.md](../../documentation/workflows/reference/event-metadata-schema.md#correlation-strategy-business-scoped)

## OAuth Testing

```bash
cd infrastructure/supabase/scripts
export SUPABASE_ACCESS_TOKEN="your-access-token"

# 1. Verify OAuth configuration via API
./verify-oauth-config.sh

# 2. Generate OAuth URL for browser testing
./test-oauth-url.sh

# 3. Test using Supabase JavaScript SDK
node test-google-oauth.js

# 4. Verify JWT custom claims (run in Supabase SQL Editor)
# Copy contents of verify-jwt-hook-complete.sql and execute
```

**Comprehensive OAuth Testing Guide**: [OAUTH-TESTING.md](../../documentation/infrastructure/guides/supabase/OAUTH-TESTING.md)

**Quick troubleshooting**:
- **`redirect_uri_mismatch`**: Check Google Cloud Console redirect URI matches Supabase callback URL exactly
- **User shows "viewer" role**: Run `verify-jwt-hook-complete.sql` to diagnose JWT hook configuration
- **JWT missing custom claims**: Verify hook registered in Dashboard (Authentication → Hooks)

## AsyncAPI Type Generation

**Source of Truth**: Generated TypeScript types from AsyncAPI schemas are the SINGLE source of truth for domain events.

```bash
# Generate TypeScript types from AsyncAPI schemas
cd infrastructure/supabase/contracts
npm run generate:types

# Copy to frontend (required after any AsyncAPI changes)
cp types/generated-events.ts ../../../frontend/src/types/generated/
```

**Key rules**:
- **NEVER** hand-write event type definitions
- **ALWAYS** regenerate types after modifying AsyncAPI schemas
- Every schema MUST have a `title` property (prevents AnonymousSchema generation)
- Frontend imports from `@/types/events` (not directly from generated)

**Pipeline**: `replace-inline-enums.js` → `asyncapi bundle` → `generate-types.js` → `dedupe-enums.js`

**Full documentation**: `.claude/skills/infrastructure-guidelines/resources/asyncapi-contracts.md`

## Directory Structure

```
infrastructure/supabase/
├── supabase/             # Supabase CLI project directory
│   ├── migrations/       # SQL migrations (Supabase CLI managed)
│   │   └── 20260212010625_baseline_v4.sql  # Day 0 v4 baseline (current)
│   ├── functions/        # Edge Functions (Deno)
│   └── config.toml       # Supabase CLI configuration
├── handlers/             # Canonical SQL reference files for handlers/routers/triggers
├── sql.archived/         # Archived granular SQL files (reference only)
├── contracts/            # AsyncAPI event schemas
│   └── asyncapi.yaml     # Event contract definitions
└── scripts/              # Deployment scripts (OAuth setup, etc.)
```

## Related Documentation

- [Infrastructure CLAUDE.md](../CLAUDE.md) — Component overview, navigation (parent)
- [Kubernetes CLAUDE.md](../k8s/CLAUDE.md) — kubectl commands, deployment
- [Day 0 Migration Guide](../../documentation/infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md) — Baseline consolidation
- [SQL Idempotency Audit](../../documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) — Migration patterns
- [Event Handler Pattern](../../documentation/infrastructure/patterns/event-handler-pattern.md) — Complete handler implementation guide
- [Event Processing Patterns](../../documentation/infrastructure/patterns/event-processing-patterns.md) — Sync trigger vs async pg_notify decision guide
- [Deployment Runbook](../../documentation/infrastructure/operations/deployment/deployment-runbook.md) — Manual deployment + rollback
- [JWT Custom Claims Setup](../../documentation/infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md)
