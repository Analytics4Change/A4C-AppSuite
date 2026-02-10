---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: System table tracking applied database migrations. Records migration name, path, execution time, and checksum for deployment verification. Managed by CI/CD pipeline, not application code.

**When to read**:
- Debugging migration failures
- Verifying deployment state
- Understanding migration tracking system
- Troubleshooting schema drift

**Prerequisites**: None

**Key topics**: `migrations`, `schema-management`, `ci-cd`, `deployment`, `system-table`

**Estimated read time**: 5 minutes
<!-- TL;DR-END -->

# _migrations_applied

## Overview

System table that tracks which database migrations have been applied to the current environment. This table is managed by the GitHub Actions CI/CD pipeline during deployments, not by application code. It provides a complete audit trail of schema changes with timing and checksum information for verification.

## Table Schema

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | integer | NO | auto-increment | Primary key |
| migration_name | text | NO | - | Short name of the migration |
| migration_path | text | NO | - | Full file path of migration |
| applied_at | timestamptz | YES | now() | When migration was applied |
| checksum | text | YES | - | SHA256 checksum of migration file |
| execution_time_ms | integer | YES | - | How long migration took to execute |
| applied_by | text | YES | 'github-actions' | Who/what applied the migration |

### Column Details

#### id

- **Type**: `integer` (auto-increment via sequence)
- **Purpose**: Simple primary key for ordering
- **Sequence**: `_migrations_applied_id_seq`

#### migration_name

- **Type**: `text`
- **Purpose**: Human-readable migration identifier
- **Examples**:
  - `baseline_v2`
  - `add_organization_units`
  - `update_rls_policies`

#### migration_path

- **Type**: `text`
- **Purpose**: Full path to migration file in repository
- **Examples**:
  - `supabase/migrations/20251229000000_baseline_v2.sql`
  - `infrastructure/supabase/sql/02-tables/...`

#### checksum

- **Type**: `text`
- **Purpose**: SHA256 hash of migration file contents
- **Usage**: Detect if migration file was modified after application
- **Format**: 64-character hex string

#### execution_time_ms

- **Type**: `integer`
- **Purpose**: Performance tracking for migrations
- **Usage**: Identify slow migrations for optimization

#### applied_by

- **Type**: `text`
- **Purpose**: Audit trail for who/what applied the migration
- **Default**: `'github-actions'`
- **Values**:
  - `github-actions` - CI/CD pipeline
  - `manual` - Manual deployment
  - `supabase-cli` - Local development

## Constraints

### Primary Key

```sql
PRIMARY KEY (id)
```

### Sequence

```sql
CREATE SEQUENCE _migrations_applied_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1;
```

## Usage Examples

### Check Migration Status

```sql
SELECT
  migration_name,
  applied_at,
  execution_time_ms
FROM _migrations_applied
ORDER BY id DESC
LIMIT 10;
```

### Verify Specific Migration Applied

```sql
SELECT EXISTS (
  SELECT 1
  FROM _migrations_applied
  WHERE migration_name = 'baseline_v2'
);
```

### Find Slow Migrations

```sql
SELECT
  migration_name,
  execution_time_ms / 1000.0 AS seconds
FROM _migrations_applied
WHERE execution_time_ms > 5000
ORDER BY execution_time_ms DESC;
```

### Check for Checksum Mismatches

```sql
-- Compare with expected checksums from repository
SELECT migration_name, checksum
FROM _migrations_applied
WHERE checksum IS NOT NULL
ORDER BY id;
```

### Deployment History

```sql
SELECT
  DATE(applied_at) AS deploy_date,
  COUNT(*) AS migrations_applied,
  SUM(execution_time_ms) / 1000.0 AS total_seconds
FROM _migrations_applied
GROUP BY DATE(applied_at)
ORDER BY deploy_date DESC;
```

## CI/CD Integration

### GitHub Actions Pattern

The deployment workflow:
1. Reads list of migrations from repository
2. Checks which are already in `_migrations_applied`
3. Applies new migrations in order
4. Records each application with timing and checksum

### Recording a Migration

```sql
INSERT INTO _migrations_applied (
  migration_name,
  migration_path,
  checksum,
  execution_time_ms,
  applied_by
) VALUES (
  'add_feature_x',
  'supabase/migrations/20251230120000_add_feature_x.sql',
  'sha256-checksum-here',
  1234,
  'github-actions'
);
```

## Troubleshooting

### Migration Not Recorded

If a migration ran but wasn't recorded:
1. Check for transaction rollback in migration
2. Verify CI/CD logs for errors
3. Manually insert record if migration confirmed applied

### Checksum Mismatch

If checksums don't match repository:
1. Migration file was modified after deployment
2. Could indicate unauthorized changes
3. Review git history and redeploy if needed

## Related Documentation

- [Day 0 Migration Guide](../../../guides/supabase/DAY0-MIGRATION-GUIDE.md) - Migration patterns
- [Deployment Instructions](../../../guides/supabase/DEPLOYMENT_INSTRUCTIONS.md) - CI/CD setup
