# Context: Missing FK Constraints

## Decision Record

**Date**: 2026-01-09
**Feature**: Add missing foreign key constraints for organization references
**Goal**: Ensure referential integrity between organization-related tables and `organizations_projection` to prevent orphaned records.

### Key Decisions

1. **Constraint Type: ON DELETE CASCADE**
   - When an organization is deleted, all related records should be automatically deleted
   - This matches the pattern used by other projection tables (invitations, roles)
   - Alternative considered: ON DELETE RESTRICT would prevent org deletion if references exist

2. **Idempotent Migration Pattern**
   - Use DO blocks with IF NOT EXISTS checks
   - Allows migration to be re-run safely during testing or rollbacks
   - Follows established A4C-AppSuite migration patterns

3. **Intentional Missing FKs for Event Store**
   - `domain_events.stream_id`, `workflow_queue_projection.stream_id`, `unprocessed_events.stream_id`
   - These are polymorphic references (stream_id + stream_type identifies any aggregate)
   - Adding FK would break non-organization events
   - Orphan detection uses conditional joins based on stream_type

4. **Constraint Naming Convention**
   - Pattern: `fk_{table_name}_{column_name}` (simplified)
   - Examples: `fk_impersonation_sessions_target_org`, `fk_cross_tenant_grants_provider_org`

## Technical Context

### Architecture

These tables are CQRS projections derived from domain events:
- **Write path**: Temporal activities emit events → domain_events table
- **Read path**: PostgreSQL triggers update projection tables
- **FK constraints**: Ensure projection consistency with parent organizations

### Affected Tables

| Table | Column | Current Status | Recommendation |
|-------|--------|----------------|----------------|
| `impersonation_sessions_projection` | `target_org_id` | Missing FK | **Add FK** (oversight) |
| `cross_tenant_access_grants_projection` | `provider_org_id` | Missing FK | **Add FK** (recommended) |
| `cross_tenant_access_grants_projection` | `consultant_org_id` | Missing FK | **Add FK** (recommended) |
| `user_notification_preferences_projection` | `organization_id` | Missing FK | **Add FK** (found during 2026-01-21 analysis) |
| `domain_events` | `stream_id` | Missing FK | Keep as-is (by design) |
| `workflow_queue_projection` | `stream_id` | Missing FK | Keep as-is (by design) |
| `unprocessed_events` | `stream_id` | Missing FK | Keep as-is (by design) |

### Why These Tables Were Missing FKs

**impersonation_sessions_projection**:
- Likely oversight during initial table creation
- Similar tables (invitations_projection, user_roles_projection) have FK constraints
- Table tracks super admin impersonation sessions into target organizations

**cross_tenant_access_grants_projection**:
- May have been intentional to allow grants referencing external/pending orgs
- However, orphaned grants after org deletion cause data inconsistency
- Both columns reference internal organizations, so FKs are appropriate

**user_notification_preferences_projection** (found 2026-01-21):
- Has `organization_id NOT NULL` but no FK constraint
- Has FK on `user_id` (ON DELETE CASCADE) and `sms_phone_id` (ON DELETE SET NULL)
- Missing FK on `organization_id` is inconsistent with similar tables
- Should CASCADE delete when organization is deleted

**Event store tables (intentional)**:
- `stream_id` is a polymorphic reference used with `stream_type`
- For `stream_type='organization'`, stream_id is an org UUID
- For `stream_type='user'`, stream_id is a user UUID
- Cannot add FK because not all stream_ids reference organizations

## File Structure

### Migration File (to be created)
- `infrastructure/supabase/supabase/migrations/YYYYMMDDHHMMSS_add_missing_org_fk_constraints.sql`

### Related Schema Files
- `infrastructure/supabase/supabase/migrations/20251229000000_baseline_v2.sql` - Contains table definitions

### Documentation Files
- `documentation/infrastructure/reference/database/tables/impersonation_sessions_projection.md`
- `documentation/infrastructure/reference/database/tables/cross_tenant_access_grants_projection.md`

## SQL Statements

### Migration SQL (Idempotent)

```sql
-- 1. impersonation_sessions_projection.target_org_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_impersonation_sessions_target_org'
      AND table_name = 'impersonation_sessions_projection'
  ) THEN
    ALTER TABLE impersonation_sessions_projection
    ADD CONSTRAINT fk_impersonation_sessions_target_org
    FOREIGN KEY (target_org_id)
    REFERENCES organizations_projection(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- 2. cross_tenant_access_grants_projection.provider_org_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_cross_tenant_grants_provider_org'
      AND table_name = 'cross_tenant_access_grants_projection'
  ) THEN
    ALTER TABLE cross_tenant_access_grants_projection
    ADD CONSTRAINT fk_cross_tenant_grants_provider_org
    FOREIGN KEY (provider_org_id)
    REFERENCES organizations_projection(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- 3. cross_tenant_access_grants_projection.consultant_org_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_cross_tenant_grants_consultant_org'
      AND table_name = 'cross_tenant_access_grants_projection'
  ) THEN
    ALTER TABLE cross_tenant_access_grants_projection
    ADD CONSTRAINT fk_cross_tenant_grants_consultant_org
    FOREIGN KEY (consultant_org_id)
    REFERENCES organizations_projection(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- 4. user_notification_preferences_projection.organization_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_user_notification_prefs_org'
      AND table_name = 'user_notification_preferences_projection'
  ) THEN
    ALTER TABLE user_notification_preferences_projection
    ADD CONSTRAINT fk_user_notification_prefs_org
    FOREIGN KEY (organization_id)
    REFERENCES organizations_projection(id)
    ON DELETE CASCADE;
  END IF;
END $$;
```

### Verification Query

```sql
SELECT tc.table_name, tc.constraint_name, kcu.column_name,
       ccu.table_name AS foreign_table
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('impersonation_sessions_projection',
                        'cross_tenant_access_grants_projection',
                        'user_notification_preferences_projection');
```

## Orphan Detection for Non-FK Tables

For tables without FK constraints (event store pattern), use conditional joins:

```sql
-- domain_events with orphaned organization references
WITH valid_orgs AS (SELECT id FROM organizations_projection)
SELECT COUNT(*) FROM domain_events
WHERE stream_type = 'organization'
  AND stream_id NOT IN (SELECT id FROM valid_orgs);

-- domain_events with org reference in event_data
SELECT COUNT(*) FROM domain_events
WHERE stream_type = 'user'
  AND event_data->>'organization_id' IS NOT NULL
  AND event_data->>'organization_id' ~ '^[0-9a-f]{8}-...'  -- UUID regex
  AND (event_data->>'organization_id')::uuid NOT IN (SELECT id FROM valid_orgs);
```

## Related Components

- `/org-cleanup` skill - Uses these FK relationships for cascade cleanup
- `/org-cleanup-dryrun` skill - Reports missing FK constraints
- Temporal bootstrap workflow - Creates organizations and related entities
- CQRS event processors - Maintain projection tables from domain events

## Important Constraints

1. **Must run orphan cleanup first**: Existing orphaned records will block FK creation
2. **CASCADE behavior**: Deleting an org will delete ALL related sessions/grants
3. **Staging only for now**: Production uses soft deletes (deleted_at timestamp)
4. **Event store immutability**: domain_events should never be FK-constrained

## Why This Approach?

**Why CASCADE instead of RESTRICT?**
- Organizations are the root aggregate - if deleted, child records are meaningless
- RESTRICT would require manual cleanup before org deletion
- Matches pattern used by other projection tables in the codebase

**Why not add FK to domain_events?**
- stream_id is polymorphic (can be org_id, user_id, client_id, etc.)
- Adding FK would break all non-organization events
- Instead, orphan detection uses conditional queries based on stream_type

**Why idempotent DO blocks?**
- Migrations may run multiple times during testing
- CI/CD pipelines may re-run migrations on rollback/redeploy
- Standard pattern in A4C-AppSuite for all DDL changes
