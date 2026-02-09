# Context: Handler Code Generation

## Decision Record

**Date**: 2026-01-20
**Feature**: Schema-driven event handler code generation
**Goal**: Eliminate column name drift by generating handler SQL from configuration that validates against database schema.

### Key Decisions

1. **Separate YAML config over AsyncAPI x-projection**: Keeps AsyncAPI files focused on event contracts; projection mapping is implementation detail. Lower risk - doesn't modify files that TypeScript generation depends on. User requested comparison of both approaches.

2. **Shadow mode rollout**: Generate to separate directory, diff against current handlers. Fix discrepancies before replacing. Lowest risk adoption path.

3. **Explicit complex handler marking**: Handlers with ltree, jsonb_set, validation queries marked `generated: false` with documented reason. These stay hand-written (~24% of handlers).

4. **Supabase MCP for schema validation**: Use `mcp__supabase__execute_sql` to query information_schema. Validates column names exist before generating SQL.

5. **Follow existing generate-types.js patterns**: Similar script structure, npm script integration, output to separate directory.

## Technical Context

### Architecture
```
YAML Config (event→projection mapping)
         ↓
generate-handlers.ts (reads config + queries schema)
         ↓
Generated SQL (individual handler functions)
         ↓
Diff against current handlers (CI validation)
         ↓
Deploy via migration (when ready)
```

### Tech Stack
- TypeScript for generator script
- YAML for handler configuration
- Supabase MCP for database introspection
- plpgsql_check for SQL validation (existing CI)

### Dependencies
- Existing: `infrastructure/supabase/contracts/scripts/generate-types.js` (pattern to follow)
- Existing: Split handler architecture (37 handlers + 4 routers) in `20260119212104_split_event_handlers.sql`
- Existing: plpgsql_check CI validation in `.github/workflows/supabase-migrations.yml`

## File Structure

### New Files to Create
- `infrastructure/supabase/config/handlers/user-events.yml` - User domain handler config
- `infrastructure/supabase/config/handlers/organization-events.yml` - Org domain config
- `infrastructure/supabase/config/handlers/rbac-events.yml` - RBAC domain config
- `infrastructure/supabase/config/handlers/organization-unit-events.yml` - OU domain config
- `infrastructure/supabase/scripts/generate-handlers.ts` - Generator script
- `infrastructure/supabase/generated/handlers/*.sql` - Output directory

### Existing Files Referenced
- `infrastructure/supabase/supabase/migrations/20260119212104_split_event_handlers.sql` - Current handlers (1326 lines)
- `infrastructure/supabase/contracts/scripts/generate-types.js` - Pattern to follow
- `.github/workflows/supabase-migrations.yml` - Add diff validation step

## Handler Complexity Categories

From exploration of current handlers (37 total):

| Category | Count | % | Generatable? |
|----------|-------|---|--------------|
| SIMPLE | 15 | 41% | ✅ Yes - direct INSERT/UPDATE |
| CONDITIONAL | 8 | 22% | ✅ Yes - IF/ELSE on org_id |
| MULTI-TABLE | 5 | 14% | ⚠️ Maybe |
| COMPLEX | 9 | 24% | ❌ No - hand-write |

**Complex handlers (must be hand-written)**:
- `handle_user_role_assigned` - ltree scope_path lookup, multi-table
- `handle_organization_created` - safe_jsonb_extract, array operations
- `handle_organization_updated` - CASE statements, jsonb merging
- `handle_organization_unit_created` - Parent path validation
- `handle_organization_unit_updated` - NOT FOUND warning
- `handle_organization_unit_deleted` - DELETE guard
- `handle_bootstrap_completed` - jsonb_set nesting
- `handle_bootstrap_failed` - jsonb_set with error field
- `handle_bootstrap_cancelled` - jsonb_set with boolean

## YAML Configuration Schema Example

```yaml
# user-events.yml
domain: user
router: process_user_event

handlers:
  # SIMPLE: Direct INSERT
  - event_type: user.synced_from_auth
    table: users
    operation: INSERT
    key_field: stream_id
    fieldMappings:
      stream_id: id
      email: email
      first_name: first_name
      last_name: last_name
    idempotency: ON CONFLICT (id) DO NOTHING

  # CONDITIONAL: IF/ELSE on org_id
  - event_type: user.phone.added
    condition:
      field: org_id
      ifNull:
        table: user_phones
      ifNotNull:
        table: user_org_phone_overrides
    fieldMappings:
      phone_id: id
      user_id: user_id
      label: label
      type: type
      number: number
      country_code:
        column: country_code
        default: "'+1'"
    idempotency: ON CONFLICT (id) DO NOTHING

  # COMPLEX: Hand-written (not generated)
  - event_type: user.role.assigned
    generated: false
    reason: "ltree scope_path lookup, multi-table update"
```

## Why Separate YAML Over AsyncAPI x-projection?

**Pros of Separate YAML**:
- Lower risk - doesn't modify AsyncAPI files that TypeScript generation depends on
- Cleaner separation - contracts (AsyncAPI) vs implementation (YAML)
- Natural `generated: false` marking
- Incremental adoption - add events as ready

**Cons**:
- Dual source of truth (event_type in both files)
- Schema drift risk (mitigated by CI validation)

**Alternative considered**: Extend AsyncAPI with `x-projection` custom extensions. Valid per AsyncAPI spec (`^x-[\w\d\.\x2d_]+$` pattern), but mixes contract with implementation and risks breaking existing tooling.
