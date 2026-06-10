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

### PG ARE regex word-boundary: use `\y`, not `\b`

On the deployed hosted Supabase PG instance, `\b` (documented as word-boundary in PG ARE per docs § 9.7.3.3) silently fails to match at end-of-input positions:

```sql
'envelope' ~ 'envelope\b'  -- → false  (BUG — should be true)
'envelope' ~ 'envelope\y'  -- → true   (CORRECT)
```

Discovered in `20260601174841_cross_tenant_grant_phase_1_jwt_shape.sql` Stage E deploy when Steps 8 + 11 assertions falsely fired on already-tagged functions. Two pre-existing M3 backfill callsites (`20260430172625:87`, `20260430172836:78`) used `\b` for an idempotent SKIP guard — the bug only masked extra rebuild work there (the rebuild was idempotent and produced the same final state), but new assertion-driven code that depends on the regex matching will fail-loud.

**Rule**: when writing PG regex anchors for word boundaries, use `\y` (PG-specific, end-of-word) instead of `\b`. Same for `\Y` (non-word-boundary) vs `\B`. Reserve `\b` for inside `[ ]` bracket expressions where it represents ASCII backspace (the documented dual meaning).

**Audit query** for future migrations:

```bash
grep -rnE "['\"][^'\"]*\\\\b[^'\"]*['\"]" infrastructure/supabase/supabase/migrations/
```

### `ANY((SELECT array_col FROM CTE))` is a scalar subquery returning rows-of-arrays

PG interprets a parenthesized subquery in `ANY((SELECT ...))` as scalar-returning. When the SELECT projects an array column, PG ends up evaluating `<scalar> = <array-of-arrays>` → `operator does not exist: uuid = uuid[]`. Discovered in `20260601174841_cross_tenant_grant_phase_1_jwt_shape.sql` Stage E deploy when Step 1's grant-derived CTE used `g.consultant_org_id = ANY((SELECT accessible_orgs FROM user_accessible_orgs))`.

```sql
-- ❌ WRONG: scalar subquery returns rows-of-arrays
AND g.consultant_org_id = ANY((SELECT accessible_orgs FROM user_accessible_orgs))

-- ✅ CORRECT: EXISTS with column reference; ANY(uao.accessible_orgs) applies array-element semantics
AND EXISTS (
  SELECT 1 FROM user_accessible_orgs uao
  WHERE g.consultant_org_id = ANY(uao.accessible_orgs)
)
```

**Rule**: `ANY(<expr>)` needs a column reference or array literal as `<expr>` for array-element semantics. If you're tempted to inline a subquery, wrap the surrounding predicate in `EXISTS (SELECT 1 FROM <cte> WHERE ... = ANY(<cte>.<array_col>))` instead.

### `EXCEPTION WHEN unique_violation` is dead code under `process_domain_event`

Handlers (and any code emitting via `api.emit_domain_event`) cannot catch `unique_violation` locally — the `process_domain_event` BEFORE INSERT trigger's `WHEN OTHERS` clause catches the violation **upstream** of any handler-internal exception block. The outer INSERT then succeeds with `processing_error` populated, producing a stale failed event in `domain_events` instead of an idempotent no-op. Re-runs leave a growing trail of failed events.

```sql
-- ❌ WRONG: handler-internal catch never fires under trigger
BEGIN
  INSERT INTO permissions_projection (...) VALUES (...);
EXCEPTION WHEN unique_violation THEN NULL;
END;

-- ✅ CORRECT: precondition guard before the conflicting INSERT
IF NOT EXISTS (
  SELECT 1 FROM permissions_projection
  WHERE applet = '...' AND action = '...'
) THEN
  INSERT INTO permissions_projection (...) VALUES (...);
END IF;
```

Discovered as a BLOCKING finding in PR #70 Step 10 architect review (2026-06-02). The pattern `EXCEPTION WHEN unique_violation THEN NULL` exists in `20260430002824:46-54` (PR #43) but the migration only ran once on a fresh seed, so no stale failed events ever materialized — re-applying that migration would now produce them. **Forward-incompatible note**: any migration that re-emits seed events MUST use the precondition-guard form.

### Migration-session `SET search_path` gotcha (extension-typed parameters)

Function-attribute `SET search_path TO 'public', 'extensions', ...` applies INSIDE the function body but **NOT during `CREATE OR REPLACE FUNCTION` parameter-type parsing**. Any migration that uses extension-typed parameters in a signature (`ltree`, `vector`, `pg_trgm`, etc.) will fail with `type "<type>" does not exist (SQLSTATE 42704)` unless the migration session's search_path includes `extensions`. Add a session-level `SET search_path = public, extensions, pg_temp;` at the top of the migration file before any such `CREATE OR REPLACE FUNCTION` statements. (Discovered in PR #67 when migration with `p_scope_path ltree` parameter failed first push.)

### BEFORE `CREATE OR REPLACE FUNCTION` of a pre-existing function, fetch the deployed body

Any migration that `CREATE OR REPLACE`s a pre-existing function (e.g., dispatcher, router, hook) MUST verify the new body preserves every load-bearing semantic of the deployed body. Rewriting from architectural memory silently drops invariants. Discovered as Chunk 2 codified pitfall during PR #71 (Phase 2 write-side) — first draft of the dispatcher `process_domain_event` `CREATE OR REPLACE` (to add the `var_partnership` branch) dropped:

- `processed_at` idempotency guard at top
- PII three-layer model (PR #43): MESSAGE_TEXT → `processing_error`, PG_EXCEPTION_DETAIL → `processing_error_detail` (gated read)
- `RAISE WARNING` in `EXCEPTION WHEN OTHERS` for operator debug visibility
- `clock_timestamp()` (NOT `now()` — `now()` is transaction-start; `clock_timestamp()` is the wall-clock reading)
- ERRCODE `P9002` for unknown stream_type (distinct from router-internal `P9001`)

**Rule**: ALWAYS fetch the deployed body via Mgmt API SQL endpoint before drafting a `CREATE OR REPLACE`. Diff against the draft. Preserve every load-bearing line not deliberately being changed.

```bash
# Fetch deployed body for diff
curl -sS -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"SELECT pg_get_functiondef('public.process_domain_event()'::regprocedure);\"}"
```

Or via plain psql with `SUPABASE_DB_URL`:

```bash
psql "$SUPABASE_DB_URL" -c "SELECT pg_get_functiondef('public.process_domain_event()'::regprocedure);"
```

The same applies to any handler `handle_*` you're modifying — the canonical reference file at `handlers/<domain>/<handler>.sql` is the source-of-truth post-migration but the **deployed** body is the source-of-truth pre-migration. Always diff both ways.

### Permission retirement: direct DELETE only under all five preconditions; event family otherwise

There is no `permission.deleted` event family in `process_rbac_event` (only `permission.defined` + `permission.updated`). Future need to retire a permission row from `permissions_projection` has two valid paths:

**Direct `DELETE FROM permissions_projection`** — acceptable ONLY when ALL FIVE of these hold:
- **(a)** The permission has never been granted to any role template (`role_permission_templates` empty for it).
- **(b)** Zero implications reference it (neither `permission_id` nor `implies_permission_id` in `permission_implications`).
- **(c)** Zero `role_permissions_projection` rows depend on it (no current grants on role instances).
- **(d)** All `has_permission(...)` / `has_effective_permission(...)` gate references have been refactored in the same migration to not reference the permission (i.e., the gate is moved to `has_platform_privilege()` or another retained permission).
- **(e)** The migration commit message + inline migration comment document the audit trail and explicitly enumerate (a)-(d).

Use this pattern for "registry-tier YAGNI cleanup" — permissions that were defined-but-never-wired. The migration commit IS the audit trail. Pattern is analogous to dropping an unused enum value or column.

**`permission.deleted` event family** — required when ANY of (a)-(d) fails. Adding this means:
1. New event_type `permission.deleted` in AsyncAPI contracts.
2. New handler `handle_permission_deleted(p_event)` that:
   - DELETEs the permission row from `permissions_projection`
   - DELETEs all dependent `role_permissions_projection` rows (cascade cleanup)
   - DELETEs all dependent `permission_implications` rows (cascade cleanup)
   - Audit trail lives in `domain_events` with `event_data = {permission_id, applet, action, reason}` per Rule 10.
3. New `WHEN 'permission.deleted'` CASE branch in `process_rbac_event` router.
4. Optionally: a soft-delete column (`deleted_at`) on `permissions_projection` so dependent grants degrade gracefully rather than disappear.

The five preconditions above are **load-bearing invariants**, not preferences. A direct DELETE that violates any of them silently strands dependent data — and unlike a row in a regular projection table, permission-registry orphaning corrupts the authz graph (a `role_permissions_projection` row pointing at a deleted permission renders `compute_effective_permissions` unable to derive the permission name; grants become invisible). Document the preconditions inline in the migration body so future readers can audit; the assertion harness should fail-loud if any of (a)-(d) becomes false mid-migration.

Originating context: PR #73 Section B (2026-06-09) retired `platform.view_event_details` via direct DELETE. All five preconditions held; migration body L213-226 enumerates them inline. Codified per PR #73 architect N1 fold-in.

### Handler-vs-schema column-name drift: parametric existence assertion at handler-deploy

When a handler `INSERT`s or `UPDATE`s columns on a projection table, those column names are not validated at function-creation time — PL/pgSQL late-binds column references. A handler that writes to a column that doesn't exist on the projection will deploy successfully and only fail at event-process time, where it surfaces as a `processing_error` on `domain_events` (a Pattern A v2 envelope returns `PROCESSING_FAILED` to the caller, but the failure happens AFTER the audit row is durable).

**Forensic example**: 3 of 5 arms of `process_access_grant_event` wrote to columns that did not exist on `cross_tenant_access_grants_projection` from baseline_v4 ship date (2026-02-12) until detection by Phase 2 UAT probe L8 (2026-06-09). Latent for ~4 months because the only path that emitted `access_grant.revoked` at scale was Phase 2's cascade-revoke.

**Defense-in-depth**: any migration that ships or refreshes a handler with new column writes MUST add a fail-loud assertion block at the bottom that enumerates the columns the handler writes and verifies their existence on the target projection:

```sql
DO $$
DECLARE
  v_handler_writes_columns text[] := ARRAY['col_a', 'col_b', '...'];
  v_col text;
  v_missing text[] := '{}';
BEGIN
  FOREACH v_col IN ARRAY v_handler_writes_columns LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='<proj>' AND column_name=v_col
    ) THEN v_missing := array_append(v_missing, v_col); END IF;
  END LOOP;
  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Handler writes to non-existent columns: %', v_missing USING ERRCODE='P9099';
  END IF;
END $$;
```

This complements (does NOT replace) the existing `plpgsql_check` CI step, which validates handler bodies at deploy-time. `plpgsql_check` catches *static* column references; `EXECUTE`-driven or dynamic-SQL handlers and column references inside `safe_jsonb_extract_*` wrappers are NOT caught by it. The parametric assertion is the catch-all.

Originating context: PR #74 (2026-06-09) hotfix aligned `cross_tenant_access_grants_projection` to the deployed `process_access_grant_event` handler. Migration body Section 2.1 contains the canonical 5-arm enumeration pattern. Codified per PR #74 architect S1 fold-in.

### `list_users*` family pattern — three-step skeleton

The four `api.list_users*` RPCs share a normalized three-step skeleton (established across PR #66 and PR #67):

1. **Permission gate**: `IF NOT public.has_effective_permission('<perm>', <scope_path>) THEN RAISE EXCEPTION 'Missing permission: <perm>' USING ERRCODE = 'insufficient_privilege'; END IF;` (or, for the org-param shape, the early-return tenancy guard — see `list_users` exception below).
2. **`v_org_id` derivation** (signature-dependent):
   - org-param signature (`list_users`): `v_org_id := p_org_id` directly (with tenancy guard)
   - scope-path signature (`list_users_for_role_management`, `list_users_for_bulk_assignment`): `SELECT o.id INTO v_org_id FROM organizations_projection o WHERE o.path = subpath(p_scope_path, 0, 1) AND o.deleted_at IS NULL;`
   - template-id signature (`list_users_for_schedule_management`): `v_org_id := public.get_current_org_id();` then validate template belongs to that org
3. **Membership-predicate query**: `WHERE u.accessible_organizations @> ARRAY[v_org_id]::uuid[]` — the canonical membership oracle, GIN-indexed via `idx_users_accessible_orgs_gin`. NEVER use `current_organization_id = v_org_id` (that's the user's active-session pointer, not a membership oracle) and NEVER use `scalar = ANY(accessible_organizations)` (GIN `array_ops` doesn't index that form — the `@>` containment form is required).

**Variant**: `api.list_users` (PR #66) uses an early-return tenancy guard (`IF NOT (has_platform_privilege() OR p_org_id = get_current_org_id()) THEN RETURN; END IF;`) in place of the scope-bound permission gate, because its signature takes an explicit `p_org_id` parameter without a permission name. This guard is correct for the org-internal admin use case but is potentially incompatible with future cross-tenant grants — flagged for future audit when partner-grant work activates.

**Two-step → one-step normalization (PR #67)**: legacy bodies that derived `v_user_scope := public.get_permission_scope(perm)` and then manually checked `v_user_scope @> p_scope_path` should be collapsed to a single `has_effective_permission(perm, p_scope_path)` call. This is strictly more correct under multi-scope JWT entries (cross-tenant grant scenario): `get_permission_scope` does `LIMIT 1`; `has_effective_permission` does `EXISTS`. Today they're observationally equivalent because `compute_effective_permissions` ends in `DISTINCT ON (permission_name)`, but that invariant is one cross-tenant-grant feature away from breaking.

**Four-site distribution audit** (baseline_v4 grep for the two-step `'Requested scope is outside your permission scope'` error): `api.bulk_assign_role` (L362, mutation), `api.list_users_for_bulk_assignment` (L4705, visibility — normalized in PR #67), `api.list_users_for_role_management` (L4793, visibility — normalized in PR #67), `api.sync_role_assignments` (L5571, mutation). The two mutation siblings remain on the legacy pattern; a future card may extend normalization to them.

**Pattern origin**: PR #66 introduced the `accessible_organizations @>` membership convention; PR #67 extended it to the three sister RPCs + normalized the permission-check helper. See `memory/pr-66-close-out.md` and (when written post-merge) `memory/pr-67-close-out.md` for the full close-out narratives.

### `accessible_organizations` is the canonical membership oracle (UNION-canonical post-Phase-1)

`public.users.accessible_organizations` is the canonical membership predicate for ALL access-derived decisions (per the PR #66/#67 `@>` convention). **Post-Phase-1 (cross-tenant-access-grant-rollout)**, this array represents the UNION of two source projections:

1. `user_organizations_projection.org_id` rows for the user — direct membership.
2. `provider_org_id`s from active in-window `cross_tenant_access_grants_projection` rows addressing the user (user-specific via `consultant_user_id` OR org-wide via `consultant_org_id` matching one of the user's accessible_organizations entries).

**Two triggers maintain the invariant**:
- `sync_accessible_organizations` (on `user_organizations_projection` INSERT/UPDATE/DELETE) — the pre-Phase-1 trigger; body rewritten in Phase 1 to delegate.
- `sync_accessible_organizations_from_grants` (on `cross_tenant_access_grants_projection` INSERT/UPDATE/DELETE) — added in Phase 1.

**Both delegate to the shared helper** `public.recompute_user_accessible_organizations(p_user_id uuid)` which performs the canonical UNION recomputation with deterministic `ORDER BY org_id` for idempotency at the array-equality level.

**Critical rules**:
- **Never write `users.accessible_organizations` directly** — route through the helper so the UNION invariant is preserved.
- **Never use `users.current_organization_id` as a membership oracle.** It is the active-session pointer (set by `switch_organization` at clock-in for direct-care staff, or initial signup default). It is NOT a membership predicate. A user switched to a different org would be silently excluded by any logic keyed on `current_organization_id`. The canonical predicate for "is U a member of org X?" is `u.accessible_organizations @> ARRAY[X]::uuid[]` — GIN-indexed via `idx_users_accessible_orgs_gin`.
- **For org-wide grant addressing in `cross_tenant_access_grants_projection`** (rows with `consultant_user_id IS NULL`), the eligible-user predicate is `u.accessible_organizations @> ARRAY[g.consultant_org_id]::uuid[]`. Used in `compute_effective_permissions`, `sync_accessible_organizations_from_grants`, and the Phase 1 backfill DO-block. Anti-pattern: `u.current_organization_id = g.consultant_org_id` (was caught + remediated in Phase 1 architect review M1 fold-in 2026-06-01).

**Anti-pattern audit query** when reviewing any Phase 2+ migration that touches grant addressing or membership:
```bash
grep -rnE "current_organization_id\s*=\s*(consultant_org_id|p_org_id|v_org_id)" \
  infrastructure/supabase/supabase/migrations/
```
Every match needs review; replace with the `accessible_organizations @>` form.

### Underscore-prefix convention for `public._*` private helpers (Phase 2)

Helper functions in `public` schema that are intended for internal use by `api.*` RPCs (validation guards, scope-derivation helpers, etc.) MUST be named with a leading underscore (`public._validate_...`, `public._check_...`, etc.) AND carry a mandatory grant-tightening ritual:

```sql
CREATE OR REPLACE FUNCTION public._validate_authorization_var_contract(...) RETURNS ...;

REVOKE ALL ON FUNCTION public._validate_authorization_var_contract(...) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._validate_authorization_var_contract(...) TO service_role;
```

**Why**: PostgreSQL `CREATE FUNCTION` defaults to `GRANT EXECUTE TO PUBLIC`. Without the REVOKE+GRANT ritual, every authenticated user (and `anon`) can invoke a helper that may bypass intended `api.*` gates. The underscore-prefix marker (a) signals "internal — call from `api.*` only" to future readers, and (b) makes the audit grep trivial (`grep -nE 'public\._[a-z]+\(' migrations/*.sql`).

**Scope of the convention**: Phase 2 introduced two `public._*` helpers — `_validate_authorization_var_contract` and `_validate_authorization_emergency_access` — per ADR Decision C.1 dispatcher pattern. The `safe_jsonb_extract_*` family predates the convention and remains unprefixed (broad use across handlers); going forward, new internal helpers carry the underscore prefix. Codegens that filter the RPC registry exclude `public._*` from the M3 shape-comment audit (see `gen-rpc-registry.cjs` SQL filter) — these are NOT `api.*` RPCs and have no shape contract.

**Audit query** for future migrations adding `public._*` helpers:
```bash
# Every match should be paired with REVOKE+GRANT lines in the same migration
grep -nE "CREATE OR REPLACE FUNCTION public\._[a-z_]+" \
  infrastructure/supabase/supabase/migrations/
```

Originating context: Phase 2 cross-tenant-grant write-side (2026-06-04) sub-decision A; locked at Stage B pre-flight after grep confirmed zero existing `public._*` matches.

### Event-type naming addendum: 2-level form for cross-cutting event families

The existing "Event type naming convention" rule (dots separate hierarchy levels; underscores for compound names within a level) applies to per-aggregate events of the shape `<aggregate>.<action>` (e.g., `user.synced_from_auth`) or `<aggregate>.<sub_aggregate>.<action>` (e.g., `user.phone.added`).

**Addendum (Phase 2, audit.* family precedent)**: Cross-cutting event families that are NOT bound to a single aggregate (e.g., `audit.high_risk_action_logged`) use the **2-level form** `<family>.<compound_event_name>` matching the `organization.direct_care_settings_updated` precedent. The `<compound_event_name>` may contain underscores for multi-word names but NOT additional dots.

**Examples**:

| ✅ Correct                                  | ❌ Wrong                                    | Stream type             |
|---------------------------------------------|---------------------------------------------|-------------------------|
| `audit.high_risk_action_logged`             | `audit.high.risk.action.logged`             | `platform_admin`        |
| `organization.direct_care_settings_updated` | `organization.direct_care_settings.updated` | `organization`          |

The stream_type for cross-cutting events is `platform_admin` (the dispatcher's absorbed administrative type — no projection update needed; the audit row lives entirely in `domain_events`). Stream id is a fresh `gen_random_uuid()` per audit row, not threaded through any aggregate stream.

Originating context: Phase 2 cross-tenant-grant write-side (2026-06-08) Chunk 5 F1 architect fold-in. `audit.high_risk_action_logged` is the first emitter of the `audit.*` family; the 2-level form becomes the precedent for all future cross-grant / cross-tenant audit events.

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

> **⚠️ Choosing between `has_permission()` and `has_effective_permission()`**
>
> `compute_effective_permissions` (baseline_v4:6932-6985) expands permission
> implications **with scope inheritance**. Concrete chain: a user explicitly
> granted `organization.update_ou` at scope `acme.pediatrics` also gets
> derived `{p: 'organization.view_ou', s: 'acme.pediatrics'}` in their JWT
> `effective_permissions` claim.
>
> Use **`public.has_effective_permission(perm, resource_path)`** when:
> 1. The resource being acted on has organizational location (an ltree path) —
>    e.g., OUs (`organization_units_projection.path`), role assignments
>    (`user_roles_projection.scope_path`), the org itself
>    (`organizations_projection.path`), AND
> 2. The permission can be derived via implication at narrow scopes.
>    Without scope-aware checks, list/visibility queries over-include —
>    `has_permission('organization.view_ou')` returns TRUE for **every** OU
>    in the tenant once any update_ou grant fires the implication.
>
> Canonical examples: `bulk_assign_role` (baseline_v4:5498) checks against
> the role's `scope_path`. OU mutators (5940/6023) check against the OU's
> own path.
>
> Use **`public.has_permission(perm)`** when:
> - The resource has no organizational location finer than tenant
>   (users-as-identities in A4C's current model — see
>   `documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md`
>   Rollout 2026-04-27 § course correction).
> - Pair with the existing JWT-org_id tenancy guard
>   (`v_org_id := NULLIF(v_claims ->> 'org_id', '')::uuid` + a target-tenancy
>   check that returns the same envelope as not-found across tenants).
>
> **Future trigger**: if user-identity acquires OU-bounded location (see
> `dev/active/sub-tenant-admin-design/`), user-targeted RPCs should switch
> to scoped checks at that point — not earlier.

> **⚠️ RPC functions that read back from projections MUST use Pattern A v2 (BOTH checks)**
>
> When an RPC emits a domain event and then reads the projection to build its
> response, it MUST perform TWO checks:
>
> 1. **`IF NOT FOUND` on the projection read-back** — catches the case where the
>    row is genuinely missing (e.g., RLS-denied projection write that left no row).
> 2. **`processing_error` check on the captured event_id** — catches the common
>    case where a handler raised mid-update on an existing (pre-existing) row.
>    Without this check, an UPDATE-only handler that fails silently leaves the
>    pre-existing stale row visible, and the RPC returns `{success: true}` with
>    that stale data — defeating the read-back's purpose.
>
> Required form:
> ```sql
> v_event_id := api.emit_domain_event(...);  -- capture (RETURNS uuid already)
> SELECT * INTO v_row FROM <projection> WHERE id = <key>;
> IF NOT FOUND THEN
>     SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id;
>     RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || COALESCE(v_processing_error, 'unknown'));
> END IF;
> SELECT processing_error INTO v_processing_error FROM domain_events WHERE id = v_event_id;
> IF v_processing_error IS NOT NULL THEN
>     RETURN jsonb_build_object('success', false, 'error', 'Event processing failed: ' || v_processing_error);
> END IF;
> RETURN jsonb_build_object('success', true, ...);
> ```
>
> **NEVER `RAISE EXCEPTION` here** — that rolls back the audit row that the trigger
> just persisted with `processing_error`, destroying the diagnostic evidence
> (admin dashboard at `/admin/events` would see zero failed events;
> `api.retry_failed_event()` would have nothing to retry).

**See**:
- [adr-rpc-readback-pattern.md](../../documentation/architecture/decisions/adr-rpc-readback-pattern.md) for the full contract decision (response shape, audit-trail-preservation rationale, telemetry convention, and the inventory of 18 RPCs that follow this pattern).
- [event-handler-pattern.md](../../documentation/infrastructure/patterns/event-handler-pattern.md) for the complete implementation guide.

> **⚠️ Edge Functions MUST NOT use PostgREST for cross-schema reads — use an `api.*` SQL RPC instead**
>
> The deployed Supabase project's PostgREST exposes ONLY the `api` schema. Any
> wire-tier `.from(<non-api-table>)` call — with OR without `.schema('public')`
> chaining — fails at the gateway:
>
>     Could not find the table 'api.users' in the schema cache       (naked .from on db.schema='api')
>     The schema must be one of the following: api                    (.schema('public').from(...) chain)
>
> Required form: route every Edge Function read on a non-`api` table through an
> `api.*` SQL RPC. RPC bodies have full SQL access to all schemas regardless of
> PostgREST's exposed-schemas config; PostgREST only needs to find the RPC entry
> point in `api`.
>
> ```typescript
> // ❌ WRONG (failed at runtime in PR #60): bare .from('users')
> // ❌ ALSO WRONG (failed at runtime in PR #61): .schema('public').from('users')
> // ✅ CORRECT: SQL RPC; the body reads public.users natively in SQL
> const { data, error } = await client.rpc('check_user_invitation_existence', {
>   p_user_id: userId,
> });
> ```
>
> **Carve-out**: `db: { schema: 'api' }` clients are still the correct
> construction for Edge Functions that exclusively call `.rpc()` — Rule 19
> only governs `.from()` calls. Two legitimate patterns:
>
> ```typescript
> // ✅ FINE: db:{schema:'api'} for pure-RPC ergonomics
> const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
>   auth: { autoRefreshToken: false, persistSession: false },
>   db: { schema: 'api' },
> });
> await supabaseAdmin.rpc('emit_domain_event', { /* ... */ });  // RPC: fine
> await supabaseAdmin.from('users').select('id');               // ❌ Rule 19 violation
>
> // ✅ ALSO FINE: per-call .schema('api').rpc() on a client without db.schema
> const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
>   global: { headers: { Authorization: authHeader } },
> });
> await supabaseUser.schema('api').rpc('deactivate_user', { /* ... */ });  // RPC: fine
> ```
>
> The invariant: the wire request must terminate on an `api.*` entry point.
> The client construction style is incidental.
>
> The pattern mirrors `api.delete_user` (PR #40), `api.deactivate_user`
> (2026-05-12), and the broader Pattern A v2 inventory in
> `adr-rpc-readback-pattern.md`.
>
> History (invalidates the prior PR #61 hotfix rule that pinned
> `.schema('public')`):
> - **PR #60** (2026-05-12): introduced wire-tier `_shared/rpc-readback.ts`
>   helper using naked `.from(public-table)`. UAT failed: schema-cache miss.
> - **PR #61** (2026-05-12): hotfix added `.schema('public')` pinning.
>   UAT failed AGAIN with the gateway-level "must be one of: api" rejection.
>   The local `config.toml` listing `["public","graphql_public","api"]` does
>   not reflect the deployed runtime PostgREST allowlist.
> - **SQL-RPC pivot** (2026-05-12, current rule): wire-tier helper deleted;
>   `manage-user.deactivate` calls `api.deactivate_user`,
>   `accept-invitation.checkExistingUserPath` calls
>   `api.check_user_invitation_existence`. Schema-pinning is no longer the
>   sanctioned approach — the architectural fix is to keep wire-tier reads off
>   non-`api` tables entirely.
>
> **Pre-deploy ritual**: any new wire-tier SDK pattern must be smoke-tested
> against real Supabase + paste the log artifact into the card BEFORE opening
> a PR. Local Deno tests with mock clients cannot model PostgREST's
> exposed-schemas allowlist.
>
> **Audit query** when reviewing any Edge Function change:
>
> ```bash
> grep -rnE "\.from\('([^']+)'\)" infrastructure/supabase/supabase/functions/ \
>   | grep -vE "__tests__|\.test\.ts"
> ```
>
> Every match needs review; if the table is not in `api`, replace with an
> `api.*` RPC.
>
> **See**: `.claude/skills/infrastructure-guidelines/SKILL.md` Rule 19;
> `documentation/architecture/decisions/adr-rpc-readback-pattern.md`;
> `documentation/architecture/decisions/adr-edge-function-vs-sql-rpc.md`.

> **⚠️ Cross-provider invitations are rejected at the Edge Function boundary**
>
> `accept-invitation` and `invite-user` call `api.check_invitation_acceptance_eligibility`
> to reject direct provider→provider invitations (the invitee is already a
> member of a different `type='provider'` org). Per
> `documentation/architecture/data/provider-partners-architecture.md`,
> cross-tenant access between providers requires a grant via a
> `type='provider_partner'` org, not native multi-tenant role assignment.
> Canonical statement of the rule lives in the EF docblocks; the RPC is
> sourced at `infrastructure/supabase/supabase/migrations/20260513203931_reject_cross_provider_invitations.sql`.

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

## Supabase-Generated TS Types

**Source of Truth**: Generated TypeScript types from the Postgres schema are the SINGLE source of truth for RPC signatures, table columns, and enum members consumed from TypeScript.

There are TWO consumer files that MUST stay byte-identical:
- `frontend/src/types/database.types.ts`
- `workflows/src/types/database.types.ts`

If only one is updated, the other consumer's typecheck will break (or — worse — silently keep compiling because many call sites use `apiRpc<T>(name, Record<string, unknown>)` which bypasses these types, leaving a lie-by-omission in the type surface).

```bash
cd infrastructure/supabase
# Prerequisites: SUPABASE_ACCESS_TOKEN set, supabase link --project-ref <ref> done

# 1. Apply the migration FIRST — regen captures the live schema shape
supabase db push --linked

# 2. Regenerate BOTH consumer copies
supabase gen types typescript --linked > ../../frontend/src/types/database.types.ts
supabase gen types typescript --linked > ../../workflows/src/types/database.types.ts

# 3. Confirm consumers still compile
cd ../../frontend && npm run typecheck
cd ../workflows && npm run typecheck
```

**When to regen** — see `.claude/skills/infrastructure-guidelines/SKILL.md` Rule 15 for the decision table. Summary: yes for any change to RPC signatures, table columns, views, or enums; no for logic-only changes inside already-exposed functions.

**Key rules**:
- **ALWAYS** regen after a migration that changes the Postgres surface (RPC sig, column, enum, table/view add-or-rename)
- **NEVER** regen before `supabase db push --linked` succeeds — you'll capture the pre-migration shape
- **ALWAYS** update both `frontend/` and `workflows/` copies in the same commit
- **NEVER** hand-edit these files — the header is machine-generated and drift will surface on the next regen

**Baseline-overload audit** (prevents stale-overload auth-model drift): before `CREATE OR REPLACE FUNCTION api.<name>(...)` in a new migration, grep baseline_v4 for existing overloads of that name:

```bash
grep -n "FUNCTION \"api\"\.\"<name>\"" supabase/migrations/20260212010625_baseline_v4.sql
```

If a different-arity overload exists, decide explicitly in the migration header: DROP the old (default — tighter auth and single wire-level signature) or coexist (document why). Regen after DROP-based migrations cleans the consumer types for free; coexistence shows as an overload union in the generated file — verify it was intentional before committing.

**Distinct from AsyncAPI type-gen**: the AsyncAPI pipeline (above section) generates event-payload types from `contracts/asyncapi.yaml` into `@/types/generated/generated-events.ts`. That's a different surface (domain events on the wire) and uses a different command. The two pipelines are complementary — run each only when its source changed.

## RPC Shape Registry (M3)

Every `api.*` RPC declares its return shape via `COMMENT ON FUNCTION ... '@a4c-rpc-shape: envelope|read'`. The frontend codegen at `frontend/scripts/gen-rpc-registry.cjs` reads `pg_description.description` and emits string-literal unions consumed by typed helpers (`apiRpc<T>` / `apiRpcEnvelope<T>`) — wrong-helper-for-shape becomes a compile error.

Every new `api.*` RPC migration MUST include a `COMMENT ON FUNCTION` carrying the shape tag. Choosing:
- `envelope` — Pattern A v2 `{success: true|false, error?, ...}` shape (writes).
- `read` — raw data (table/array/scalar/jsonb without a top-level `success` discriminator) (reads).

```sql
CREATE OR REPLACE FUNCTION api.update_user(...) RETURNS jsonb ... ;

COMMENT ON FUNCTION api.update_user(uuid, text, text) IS
$comment$Update user profile (first_name, last_name) via domain event

@a4c-rpc-shape: envelope$comment$;
```

> **⚠️ DROP + CREATE re-tag rule**
>
> `COMMENT ON FUNCTION` is keyed to the function OID. `CREATE OR REPLACE FUNCTION` (same signature) preserves the comment; `DROP FUNCTION` + `CREATE FUNCTION` (signature change) does NOT — the new OID has no comment. Any DROP+CREATE migration MUST re-issue `COMMENT ON FUNCTION ... '@a4c-rpc-shape: ...'` in the same migration.

> **⚠️ Codegen parser pitfall — `pg_description.description` can contain newlines**
>
> When a codegen script reads `pg_description.description` via `psql -A -t` and parses rows JS-side, the default record separator is `\n`. Baseline_v4 functions have multi-line `COMMENT ON FUNCTION` bodies (`Validation:`, `Used by:`, `Tenancy model:` etc.) — each continuation line becomes a phantom row and gets reported as untagged. Discovered as the "1329 untagged functions" CI failure on PR #70 first push.
>
> **Two safe patterns**:
> 1. **SQL-side extraction** (used by `gen-rpc-registry.cjs`): `CASE WHEN d.description ~ '@a4c-rpc-shape:\s*envelope' THEN 'envelope' ... ELSE '' END AS shape` — returns only single-line tag values.
> 2. **psql row-separator override** (used by `gen-rpc-reachability-matrix.cjs:99`): `psql -A -t -R '<<<A4C_ROW>>>' -F'<<<A4C_FIELD>>>'` — split JS-side on the row sentinel instead of `\n`. Necessary when the codegen needs the full multi-line description for multi-tag parsing.

CI workflow `.github/workflows/rpc-registry-sync.yml` spins up a local Supabase container, applies migrations, runs `npm run gen:rpc-registry`, and fails if (a) the registry diverges from the migration state or (b) any RPC lacks a shape tag. Run the codegen locally after applying a migration that adds, drops, or retags an `api.*` function:

```bash
cd frontend
npm run gen:rpc-registry  # uses local container at 127.0.0.1:54322
git diff src/services/api/rpc-registry.generated.ts
```

**See**: `documentation/architecture/decisions/adr-rpc-readback-pattern.md` §"Type-level enforcement (M3)"; `infrastructure-guidelines/SKILL.md` Rule 17; `frontend/src/services/CLAUDE.md` §3.

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
