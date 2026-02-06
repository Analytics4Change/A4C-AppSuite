---
name: Infrastructure Guidelines
description: Guard rails for Supabase SQL migrations, RLS policies, CQRS projections, and idempotent infrastructure patterns in A4C-AppSuite.
version: 2.0.0
tags: [infrastructure, supabase, rls, cqrs, migrations, idempotency]
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

Every table containing organization-scoped data MUST have RLS enabled with JWT claims isolation.

```sql
DROP POLICY IF EXISTS tenant_isolation ON my_table;
CREATE POLICY tenant_isolation ON my_table
  FOR ALL
  USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid);
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
```

## 4. Frontend Queries via `api.` Schema RPC ONLY

**NEVER use direct table queries with PostgREST embedding across projections.** This violates CQRS and causes 406 errors.

```typescript
// ✅ CORRECT
await supabase.schema('api').rpc('list_users', { p_org_id: orgId })

// ❌ WRONG — re-normalizes denormalized projections
await supabase.from('users').select('..., user_roles_projection!inner(...)')
```

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

## 8. Event Metadata Must Include Audit Fields

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

## 9. Failed Event Monitoring

Check `processing_error` column on `domain_events` for failed projections. Use the admin API or RPC to retry:

- Dashboard: `/admin/events` shows failed events
- Retry: `SELECT api.retry_failed_event('<event_id>'::uuid)`
- Stats: `SELECT * FROM api.get_event_processing_stats()`

---

## File Locations

| What | Where |
|------|-------|
| Migrations | `infrastructure/supabase/supabase/migrations/*.sql` |
| Edge Functions | `infrastructure/supabase/supabase/functions/` |
| K8s manifests | `infrastructure/k8s/temporal/` |
| AsyncAPI contracts | `infrastructure/supabase/contracts/` |
| Supabase config | `infrastructure/supabase/supabase/config.toml` |

## Deep Reference

- `infrastructure/CLAUDE.md` — Full development guidance, commands, deployment
- `documentation/AGENT-INDEX.md` — Search by keyword for architecture docs
- `documentation/infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md` — Migration patterns
- `documentation/infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md` — CQRS spec
- `documentation/infrastructure/guides/event-observability.md` — Tracing, failed events, correlation
