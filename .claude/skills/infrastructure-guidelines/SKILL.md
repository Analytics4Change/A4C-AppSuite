---
name: Infrastructure Guidelines
description: Guard rails for Supabase SQL migrations, RLS policies, CQRS projections, and idempotent infrastructure patterns in A4C-AppSuite.
version: 2.0.0
tags: [supabase, rls, cqrs, migration, idempotency]
---

# Infrastructure Guard Rails

Critical rules that prevent bugs in database migrations, RLS policies, and CQRS projections. For full guidance, templates, and reference, see `infrastructure/CLAUDE.md` and search `documentation/AGENT-INDEX.md` with keywords: `migration`, `rls`, `cqrs`, `projection`, `idempotency`, `supabase`, `observability`, `failed-events`, `correlation-id`.

---

## 1. Always Use `supabase migration new` CLI

**NEVER manually create migration files.** The CLI generates correct UTC timestamps. Hand-typed timestamps cause ordering errors that break CI/CD.

```bash
# ✅ CORRECT
cd infrastructure/supabase && supabase migration new feature_name

# ❌ WRONG — timestamp may conflict with deployed migrations
touch supabase/migrations/20251223120000_feature.sql
```

## 2. All SQL Must Be Idempotent

Every statement must be safe to run multiple times.

```sql
CREATE TABLE IF NOT EXISTS ...;
CREATE INDEX IF NOT EXISTS ...;
DROP POLICY IF EXISTS policy_name ON table_name;
CREATE POLICY policy_name ON table_name USING (...);
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS ...;
```

## 3. RLS on Every Table with Org Data

Every table containing organization-scoped data MUST have RLS enabled with JWT claims isolation. Prefer the baseline-sanctioned helpers (`get_current_org_id()`, `has_platform_privilege()`) over raw `request.jwt.claims` extraction — they centralize the v4 claim shape and work correctly during impersonation.

```sql
DROP POLICY IF EXISTS tenant_isolation ON my_table;
CREATE POLICY tenant_isolation ON my_table
  FOR ALL
  USING (
    has_platform_privilege()           -- platform owners bypass tenant scope
    OR org_id = get_current_org_id()
  );
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
```

Fallback — only use raw JWT extraction when no helper exists for the claim you need:

```sql
-- e.g., current_org_unit_id (no dedicated helper)
USING (ou_id = (current_setting('request.jwt.claims', true)::json->>'current_org_unit_id')::uuid);
```

## 4. Frontend Queries via `api.` Schema RPC ONLY

**NEVER use direct table queries with PostgREST embedding across projections.** This violates CQRS and causes 406 errors.

```typescript
// ✅ CORRECT
await supabase.schema('api').rpc('list_users', { p_org_id: orgId })

// ❌ WRONG — re-normalizes denormalized projections
await supabase.from('users').select('..., user_roles_projection!inner(...)')
```

`api.` schema RPCs enforce tenant isolation via `SECURITY INVOKER` and JWT claim helpers (`get_current_org_id()`, `has_platform_privilege()`) — direct table reads bypass this boundary.

**Choosing between SQL RPC and Edge Function for a write operation**: See Rule 14 below.

## 5. `domain_events` Is the Sole Audit Trail

There is NO separate audit table. All state changes are domain events. **Never create audit/log tables** — query `domain_events` instead.

## 6. Projection Handlers Must Use ON CONFLICT

CQRS projection handlers receive events that may replay. Handlers MUST be idempotent.

```sql
INSERT INTO my_projection (id, name, ...)
VALUES ((p_event.event_data->>'entity_id')::uuid, p_event.event_data->>'name', ...)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = p_event.created_at;
```

## 7. Single Event Trigger — NEVER Create Per-Event-Type Triggers

All event routing goes through ONE `process_domain_event()` BEFORE INSERT trigger on `domain_events`. It dispatches by `stream_type` to router functions, which dispatch by `event_type` to individual handlers. **NEVER create additional triggers** with WHEN clauses filtering specific event types.

```sql
-- ✅ CORRECT: Add CASE line to router
WHEN 'user.foo.created' THEN PERFORM handle_user_foo_created(p_event);

-- ❌ WRONG: Create per-event-type trigger
CREATE TRIGGER my_trigger AFTER INSERT ON domain_events
  WHEN (NEW.event_type = 'user.foo.created') ...
```

Also: handlers receive `domain_events` rows. Use `p_event.stream_id`, NOT `p_event.aggregate_id` (that column does not exist).

### 7.1 Handler Reference Files — Always Read Before Writing

Before modifying ANY handler, router, or trigger function, **read the canonical reference file** at `infrastructure/supabase/handlers/<domain>/<function>.sql`. Copy the existing implementation into your migration and modify the copy — never rewrite from memory.

Handler reference files are organized by domain — one subdir per aggregate, each holding the `.sql` definition of one function per file. Subdirectory purposes:

- `trigger/` — trigger function references (e.g., `process_domain_event.sql`)
- `routers/` — router functions, one per `stream_type` (e.g., `process_user_event.sql`)
- one subdir per domain (`user/`, `organization/`, `client/`, `schedule/`, etc.) — handler files named `handle_<entity>_<action>.sql`

**Self-audit** — get current state from the filesystem, not from a hardcoded list here:

```bash
ls infrastructure/supabase/handlers/                           # all domains
find infrastructure/supabase/handlers -name "*.sql" | wc -l    # total reference files
find infrastructure/supabase/handlers -maxdepth 2 -name "process_*.sql"  # routers + triggers
```

After creating a migration that changes a handler, **update the reference file** to match. See [event-handler-pattern.md](../../../../documentation/infrastructure/patterns/event-handler-pattern.md) for router/handler structure conventions and [Day 0 Migration Guide](../../../../documentation/infrastructure/guides/supabase/DAY0-MIGRATION-GUIDE.md#handler-reference-files) for baseline-consolidation rules.

### 7.2 Choosing the Event Processing Pattern

Two patterns exist. Choose based on what the handler needs to do:

| Need | Pattern | Mechanism |
|------|---------|-----------|
| Update projection table | **Synchronous** | BEFORE INSERT trigger → router → handler |
| Send email, call API, start workflow | **Async** | AFTER INSERT trigger → pg_notify → Temporal |
| Both projection + side effect | **Hybrid** | BEFORE handler for projection + AFTER trigger for async |

```sql
-- ✅ CORRECT: Projection update via synchronous handler
WHEN 'user.phone.added' THEN PERFORM handle_user_phone_added(p_event);

-- ✅ CORRECT: Async workflow via AFTER trigger + pg_notify
-- (for email, DNS, webhooks — NOT for projection updates)
CREATE TRIGGER notify_workflow_trigger AFTER INSERT ON domain_events
  FOR EACH ROW WHEN (NEW.event_type = 'organization.bootstrap.initiated')
  EXECUTE FUNCTION notify_workflow_worker();

-- ❌ WRONG: External I/O in a synchronous trigger handler
-- (blocks the transaction, no retry on failure)
```

**Full guide**: `documentation/infrastructure/patterns/event-processing-patterns.md`

## 8. Router ELSE Must RAISE EXCEPTION, Not WARNING

Routers must raise an EXCEPTION for unmatched event types, not a WARNING. Warnings are invisible — exceptions are caught by `process_domain_event()` and recorded in `processing_error`, visible in the admin dashboard.

```sql
-- ✅ CORRECT: Exception caught and recorded
ELSE
  RAISE EXCEPTION 'Unhandled event type "%" in process_user_event', p_event.event_type
    USING ERRCODE = 'P9001';

-- ❌ WRONG: Warning is invisible, event marked as "processed"
ELSE
  RAISE WARNING 'Unknown user event type: %', p_event.event_type;
```

If an event type intentionally has no handler, add an explicit no-op CASE:
```sql
WHEN 'some.audit_only.event' THEN NULL;  -- No projection needed
```

See [event-handler-pattern.md](../../../../documentation/infrastructure/patterns/event-handler-pattern.md) for the full router/handler split architecture and the projection read-back guard pattern.

## 9. API Functions Must NEVER Write Projections Directly

All projection updates go through event handlers. API functions emit events; handlers update projections.

Baseline signature: `api.emit_domain_event(p_stream_id uuid, p_stream_type text, p_event_type text, p_event_data jsonb, p_event_metadata jsonb default '{}'::jsonb)`. Prefer **named-argument calls** for clarity with 5 params; always include `p_event_metadata` with `user_id`, `organization_id`, and `reason` so Rule 10's audit-field invariant is satisfied by construction.

```sql
-- ✅ CORRECT: Named args with full metadata
PERFORM api.emit_domain_event(
  p_stream_id      := p_id,
  p_stream_type    := 'invitation',
  p_event_type     := 'invitation.revoked',
  p_event_data     := jsonb_build_object('reason', p_reason),
  p_event_metadata := jsonb_build_object(
    'user_id',         auth.uid(),
    'organization_id', get_current_org_id(),
    'reason',          p_reason
  )
);

-- ✅ CORRECT: Positional args (same function, must match signature order)
PERFORM api.emit_domain_event(
  p_id,
  'invitation',
  'invitation.revoked',
  jsonb_build_object('reason', p_reason),
  jsonb_build_object('user_id', auth.uid(), 'organization_id', get_current_org_id(), 'reason', p_reason)
);

-- ❌ WRONG: Direct projection write (no audit trail, breaks replay)
UPDATE invitations_projection SET status = 'revoked' WHERE id = p_id;

-- ❌ WRONG: Dual write (event + direct write in same function)
UPDATE organizations_projection SET direct_care_settings = v_settings;
PERFORM api.emit_domain_event(...);  -- handler also does the UPDATE
```

## 10. Event Metadata Must Include Audit Fields

Every domain event MUST include `user_id` and `reason` in metadata for audit compliance.

```sql
-- Verify audit fields in events
SELECT event_type,
  event_metadata->>'user_id' as actor,
  event_metadata->>'reason' as reason
FROM domain_events
WHERE stream_id = '<resource_id>'
ORDER BY created_at DESC;
```

## 11. Failed Event Monitoring

Check `processing_error` column on `domain_events` for failed projections. Use the admin API or RPC to retry:

- Dashboard: `/admin/events` shows failed events
- Retry: `SELECT api.retry_failed_event('<event_id>'::uuid)`
- Stats: `SELECT * FROM api.get_event_processing_stats()`

## 12. Event Routing Audit — Verify Three Layers for Every New Event Type

When adding a new event type, verify ALL THREE layers or the event is silently lost / processed incorrectly:

1. **Emitter sets correct `stream_type`** — the aggregate type the event belongs to (e.g., `user.role.assigned` must emit with `stream_type = 'user'`, NOT `'rbac'` or `'role'`).
2. **Dispatcher routes correctly** — `process_domain_event()` switches on `stream_type`; verify your `stream_type` hits the intended router.
3. **Router has a CASE branch** — the stream-type router must have a `WHEN 'event.type'` branch; otherwise it falls through to `ELSE RAISE EXCEPTION` (Rule 8).

**Real incident (2026-02-20)**: `user.role.assigned` events emitted with `stream_type: 'user'` but `process_user_event()` had no CASE branch. Events fell through to `ELSE RAISE EXCEPTION`; two users bootstrapped without permissions. The `rbac` router had a dead branch that was unreachable. Fix migration: `20260220185837_fix_event_routing.sql`.

- **Dispatcher junction caveat**: `process_domain_event()` intercepts `%.linked` / `%.unlinked` event-type patterns and routes them to `process_junction_event()`. If your new event type matches that wildcard but must route elsewhere (e.g., `contact.user.linked` routes by `stream_type='contact'`, not via junction), add it to the dispatcher's exclusion list.

Self-audit query — surface silent processing errors after deploy:

```sql
SELECT event_type, stream_type, processing_error, created_at
FROM domain_events
WHERE processing_error IS NOT NULL
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

## 13. Projection Read-back Guard on Every API Write RPC

Every `api.*` write RPC must read the projection row back after emitting the event and verify expected state. Without the guard, the RPC reports success while the projection silently failed (handler threw, event queued with `processing_error`).

**Template** (pattern established in migrations `20260221173821` and `20260223163610`):

```sql
CREATE OR REPLACE FUNCTION api.deactivate_entity(
  p_entity_id uuid,
  p_reason    text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_result           RECORD;
  v_processing_error text;
BEGIN
  -- 1. Emit event
  PERFORM api.emit_domain_event(
    p_stream_id      := p_entity_id,
    p_stream_type    := 'entity',
    p_event_type     := 'entity.deactivated',
    p_event_data     := jsonb_build_object('reason', p_reason),
    p_event_metadata := jsonb_build_object(
      'user_id',         auth.uid(),
      'organization_id', get_current_org_id(),
      'reason',          p_reason
    )
  );

  -- 2. Read back the projection — expected-state check
  SELECT * INTO v_result
  FROM entities_projection
  WHERE id = p_entity_id AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    -- 3. Surface the handler's processing_error if any
    SELECT processing_error INTO v_processing_error
    FROM domain_events
    WHERE stream_id  = p_entity_id
      AND event_type = 'entity.deactivated'
    ORDER BY created_at DESC LIMIT 1;

    RETURN jsonb_build_object(
      'success', false,
      'error',   COALESCE(v_processing_error, 'Projection update failed')
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'entity', row_to_json(v_result));
END;
$$;
```

**Real incident (2026-02-23)**: `api.delete_organization_unit()` lacked the read-back guard (5th of 5 org-unit RPCs; other 4 had been fixed in `20260221173821`). Frontend silently received `{success: false}` because the handler's column-name mismatch was invisible to the caller. Fix migration: `20260223163610_fix_delete_org_unit_projection_guard.sql`.

## 14. Edge Function vs SQL RPC Selection

**Before creating a new Edge Function, consult [adr-edge-function-vs-sql-rpc.md](../../../documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md).** SQL RPC is the default for write operations; Edge Function requires meeting one of six load-bearing criteria (LB1–LB6):

- **LB1** — Mints auth tokens or creates `auth.users` rows (Supabase Auth admin API)
- **LB2** — Calls external APIs (Cloudflare, Resend, Backend API, Temporal)
- **LB3** — Forwards to workflow orchestration layer
- **LB4** — Unauthenticated entry point with bespoke token validation
- **LB5** — Cross-tier read orchestration (Temporal status, external queues)
- **LB6** — Emits to a stream whose caller's JWT cannot be RLS-authorized (pre-user events)

An operation meeting **zero** of LB1–LB6 is `candidate-for-extraction` → write as SQL RPC.

**Opportunistic-migration nudge**: When touching an Edge Function operation classified `candidate-for-extraction` in the ADR's inventory, prefer extracting that operation to an SQL RPC in the same PR.

```typescript
// ✅ CORRECT (new Edge Function) — ADR citation in top-of-file comment
/**
 * ADR: documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md
 * Load-bearing criterion: LB2 (Resend API)
 */
```

CI check `.github/workflows/supabase-edge-functions-lint.yml` enforces ADR citation on NEW Edge Function files (`git diff --diff-filter=A`). Does NOT block modifications to existing files.

**Explicit non-criterion**: Service-role reads of non-`api.` tables are NOT load-bearing. A `SECURITY DEFINER` SQL RPC can read any table. Don't keep an op in an Edge Function just because it reads outside the `api.` schema — extract it.

**Edge Functions are the orchestration tier**: Rule 4 (frontend → `api.` RPC only) is a browser-facing contract. Edge Functions run server-side with service-role credentials; they may read any table when needed. This is a CQRS-rule exemption, not a violation.

## 15. Regenerate `database.types.ts` When Postgres Surface Changes

TypeScript consumers read Postgres shape from two generated files that MUST stay byte-identical:
- `frontend/src/types/database.types.ts`
- `workflows/src/types/database.types.ts`

Regenerate after any migration that changes what `supabase gen types typescript` would emit. Skip for logic-only changes inside already-exposed functions.

| Migration change | Regen? |
|---|---|
| Add / drop / rename an `api.*` or `public.*` RPC | **Yes** |
| Change an RPC's parameter list or return type (incl. dropping an overload) | **Yes** |
| Add / drop / rename a column on a table the frontend/workflows reads | **Yes** |
| Add / rename a table, view, or enum in `public` / `api` | **Yes** |
| Change an enum's member list | **Yes** |
| Modify a PL/pgSQL handler/router/trigger body (no signature change) | No |
| Add / modify RLS policies | No |
| Migration only touches `handle_*` / `process_*_event` internals | No |

**Timing**: regen AFTER `supabase db push --linked` succeeds — never before (would capture pre-migration shape).

```bash
# Run from infrastructure/supabase/ with SUPABASE_ACCESS_TOKEN set and `supabase link` done
supabase gen types typescript --linked > ../../frontend/src/types/database.types.ts
supabase gen types typescript --linked > ../../workflows/src/types/database.types.ts
```

**Self-check**: if `git diff` shows changes in only one of the two files, stop — you forgot the other copy. Drift between the two breaks the `workflows/` or `frontend/` typecheck as soon as someone consumes a changed signature.

**Overload trap**: if a regen shows two entries for the same function name (an overload union), verify the migration intended to keep both signatures. Stale overloads in baseline consolidations are a known source of auth-model drift — see `infrastructure/supabase/CLAUDE.md` "Supabase-Generated TS Types" for the baseline-overload audit pattern.

**Full procedure** (commands, commit-message style, troubleshooting): `infrastructure/supabase/CLAUDE.md` → "Supabase-Generated TS Types".

---

## File Locations

| What | Where |
|------|-------|
| Migrations | `infrastructure/supabase/supabase/migrations/*.sql` |
| Edge Functions | `infrastructure/supabase/supabase/functions/` |
| K8s manifests | `infrastructure/k8s/temporal/` |
| AsyncAPI contracts | `infrastructure/supabase/contracts/` |
| Supabase config | `infrastructure/supabase/supabase/config.toml` |

## Edge Function Deployment

Edge Functions share Supabase runtime, `_shared/types.ts` JWT definitions, and AsyncAPI contracts with migrations/RLS. Treat them as platform code subject to the same guard rails.

### CLI fallback for large payloads

The MCP `deploy_edge_function` tool returns `InternalServerErrorException` on large payloads or complex `_shared/` imports. Use the Supabase CLI instead — it resolves `_shared/` automatically:

```bash
cd infrastructure/supabase
supabase functions deploy <function-name>
```

### Import JWT types from `_shared/types.ts`

JWT payload types (`EffectivePermission`, `JWTPayload`, `hasPermission()`) MUST be imported from the shared module. Do NOT declare local `JWTPayload` interfaces — they drift when the v4 claim shape changes.

```typescript
// ✅ CORRECT
import { JWTPayload, hasPermission } from '../_shared/types.ts';

// ❌ WRONG — local interface misses claim updates
interface JWTPayload { permissions?: string[]; /* v3 field, removed in v4 */ }
```

### JWT-claim change audit checklist

When JWT claim shape changes (e.g., v3 → v4), audit ALL consumers together, not just frontend:

- [ ] Frontend auth providers (`frontend/src/services/auth/`)
- [ ] Edge Functions (`infrastructure/supabase/supabase/functions/*`)
- [ ] Backend API middleware (`workflows/src/api/middleware/`)
- [ ] RLS policies (migrations)

**Precedent**: Phase 5B (2026-01-26) audited frontend only, missed Edge Functions and RLS. Three separate remediations required (2026-02-18 Edge Functions + RLS, 2026-02-19 backend API) to close the gap.

## Deep Reference

- `infrastructure/CLAUDE.md` — Full development guidance, commands, deployment
- `documentation/AGENT-INDEX.md` — Search by keyword for architecture docs
- `documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md` — Migration patterns
- `documentation/infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` — CQRS spec
- `documentation/infrastructure/guides/event-observability.md` — Tracing, failed events, correlation
- `documentation/infrastructure/patterns/event-handler-pattern.md` — Router/handler split architecture, projection read-back guard
- `documentation/infrastructure/patterns/event-processing-patterns.md` — Sync-vs-async pattern selection
