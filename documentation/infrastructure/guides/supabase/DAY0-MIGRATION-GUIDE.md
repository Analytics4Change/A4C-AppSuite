---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Guide for Day 0 migration strategy that consolidates all schema changes into a single baseline file for Supabase CLI migration tracking, including backup procedures, migration repair commands, and CI/CD integration.

**When to read**:
- Transitioning to Supabase CLI from manual SQL deployment
- Consolidating multiple migrations into a fresh baseline
- Troubleshooting migration history issues
- Understanding the v1 to v2 baseline consolidation

**Prerequisites**: Supabase CLI installed, project access

**Key topics**: `day0-migration`, `supabase-cli`, `baseline`, `migration-tracking`, `rollback`

**Estimated read time**: 12 minutes
<!-- TL;DR-END -->

# Day 0 Migration Guide

This guide documents the Day 0 migration strategy used to transition from manually-maintained SQL files to Supabase CLI migrations.

## What is a Day 0 Migration?

A **Day 0 migration** captures the complete current state of the production database as a single baseline migration file. This approach:

1. **Consolidates history**: All previous schema changes become a single starting point
2. **Simplifies maintenance**: Future changes are incremental migrations from this baseline
3. **Enables native tracking**: Supabase CLI manages migration history in `supabase_migrations.schema_migrations`

## When to Use Day 0 Migration

Use this approach when:

- Migrating from manual SQL deployment to Supabase CLI migrations
- Starting fresh migration tracking on an existing production database
- Consolidating many small migrations into a single baseline
- The existing migration history is no longer needed for rollback

**Do NOT use if:**
- You need to preserve individual migration rollback capability
- Multiple environments have divergent migration histories

## How We Did It

### 1. Backup Production Database

```bash
cd infrastructure/supabase
export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock  # If using Podman
export SUPABASE_ACCESS_TOKEN="your-access-token"
supabase link --project-ref "your-project-ref"
supabase db dump --linked > backup_$(date +%Y%m%d_%H%M%S).sql
```

### 2. Capture Current Schema as Baseline

```bash
supabase db dump --linked > supabase/migrations/20240101000000_baseline.sql
```

**Important**: The timestamp `20240101000000` must be **before** any existing migrations in the history table. Check with:

```bash
supabase migration list --linked
```

### 3. Mark Baseline as Applied

Since the baseline represents the current production state, mark it as already applied:

```bash
supabase migration repair --status applied 20240101000000 --linked
```

### 4. Clean Up Old Migration History

If the remote database has old migrations that are now superseded by the baseline, mark them as reverted:

```bash
# Get list of old migrations
supabase migration list --linked

# Mark each as reverted (replace with actual version numbers)
supabase migration repair --status reverted 20251115202250 --linked
supabase migration repair --status reverted 20251119001323 --linked
# ... repeat for all old migrations
```

### 5. Validate

```bash
# Should show only the baseline migration
supabase migration list --linked

# Dry-run should report "up to date"
supabase db push --linked --dry-run
```

## Creating Future Migrations

After Day 0, all schema changes follow the standard Supabase migration workflow:

### Create a New Migration

```bash
cd infrastructure/supabase
supabase migration new add_new_feature
# Creates: supabase/migrations/YYYYMMDDHHMMSS_add_new_feature.sql
```

### Write Idempotent SQL

Edit the generated file with idempotent patterns:

```sql
-- Tables
CREATE TABLE IF NOT EXISTS new_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_new_table_name ON new_table(name);

-- Functions
CREATE OR REPLACE FUNCTION my_function()
RETURNS void AS $$
BEGIN
  -- function body
END;
$$ LANGUAGE plpgsql;

-- Triggers (must drop first for idempotency)
DROP TRIGGER IF EXISTS my_trigger ON my_table;
CREATE TRIGGER my_trigger
  AFTER INSERT ON my_table
  FOR EACH ROW EXECUTE FUNCTION my_function();

-- RLS policies (must drop first for idempotency)
DROP POLICY IF EXISTS my_policy ON my_table;
CREATE POLICY my_policy ON my_table
  FOR ALL USING (org_id = (current_setting('request.jwt.claims', true)::json->>'org_id')::uuid);

ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
```

### Deploy Migration

```bash
# Preview
supabase db push --linked --dry-run

# Apply
supabase db push --linked

# Verify
supabase migration list --linked
```

## CI/CD Integration

The GitHub Actions workflow `.github/workflows/supabase-migrations.yml` automatically:

1. Triggers on push to `main` with changes to `infrastructure/supabase/supabase/migrations/**`
2. Links to the Supabase project
3. Runs dry-run to preview changes
4. Applies pending migrations
5. Verifies migration status

### Required Secrets

| Secret | Description |
|--------|-------------|
| `SUPABASE_ACCESS_TOKEN` | Supabase Management API token (from Dashboard → Account → Access Tokens) |
| `SUPABASE_PROJECT_REF` | Project reference ID (e.g., `tmrjlswbsxmbglmaclxu`) |

## Troubleshooting

### "Remote migration versions not found"

This error occurs when the remote has migrations that don't exist locally.

**Solution**: Mark those migrations as reverted:
```bash
supabase migration repair --status reverted <version> --linked
```

### Migration Already Applied

If you need to re-run a migration that's marked as applied:

```bash
# Mark as reverted
supabase migration repair --status reverted <version> --linked

# Re-apply
supabase db push --linked
```

### Docker/Podman Not Found

Supabase CLI requires Docker for some operations.

**Solution** (for Podman users):
```bash
export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock
```

### Dry-Run Shows Unexpected Changes

If dry-run shows changes that shouldn't exist:

1. Verify local baseline matches production: `supabase db dump --linked > current.sql && diff current.sql supabase/migrations/20240101000000_baseline.sql`
2. Check for manual dashboard changes not captured in migrations
3. Update baseline if necessary (not recommended for production)

## Rollback Procedures

### Revert a Single Migration

```bash
# Mark migration as reverted (does not undo schema changes!)
supabase migration repair --status reverted <version> --linked

# Create a reverse migration to undo changes
supabase migration new revert_feature
# Write SQL to DROP/ALTER the changes made

# Apply the reverse migration
supabase db push --linked
```

### Full Rollback to Baseline

1. Restore from backup:
   ```bash
   psql -h db.PROJECT_REF.supabase.co -U postgres -d postgres < backup_YYYYMMDD_HHMMSS.sql
   ```

2. Reset migration history:
   ```bash
   # Mark all post-baseline migrations as reverted
   supabase migration list --linked
   # For each migration after baseline:
   supabase migration repair --status reverted <version> --linked
   ```

## Reference Files

| File | Purpose |
|------|---------|
| `infrastructure/supabase/supabase/migrations/20251229000000_baseline_v2.sql` | Day 0 v2 baseline (current) |
| `infrastructure/supabase/supabase/migrations.archived/2025-december-cleanup/` | Archived migrations from v1 baseline through Dec 2025 |
| `infrastructure/supabase/sql.archived/` | Original granular SQL files (reference only) |
| `infrastructure/supabase/backup_*.sql` | Pre-migration backups |
| `.github/workflows/supabase-migrations.yml` | CI/CD migration workflow |

## Decision Records

### Day 0 v2 Baseline (2025-12-29)

**Date**: 2025-12-29
**Decision**: Create Day 0 v2 baseline consolidating 25 migrations

**Context**:
- Original Day 0 baseline (2024-12-22) followed by 24 incremental migrations
- RBAC Scoping Architecture Cleanup (Phases 1-12) complete
- OU cascade features, role management improvements, permission cleanup all finalized
- Documentation audits revealed permission count discrepancies (docs said 31, actual 33)

**Migrations Consolidated** (25 total):
- `20240101000000_baseline.sql` (original Day 0)
- `20251223*.sql` - OU cascade features (6 migrations)
- `20251224*.sql` - Role management fixes (3 migrations)
- `20251225*.sql` - API security fixes (2 migrations)
- `20251228*.sql` - Permission enhancements (3 migrations)
- `20251229*.sql` - RBAC cleanup phases 1-12 (11 migrations)

**Outcome**:
- Created `20251229000000_baseline_v2.sql` from production dump (10,320 lines)
- Archived all 25 old migrations to `migrations.archived/2025-december-cleanup/`
- Marked old migrations as reverted, new baseline as applied
- Fixed documentation: 33 permissions (10 global + 23 org)

**Verification**:
- `supabase migration list --linked` shows only baseline_v2
- `supabase db push --linked --dry-run` reports "Remote database is up to date"
- Audit queries confirm: 33 permissions, 0 orphaned records

---

### Day 0 v1 Baseline (2024-12-22)

**Date**: 2024-12-22
**Decision**: Migrate to Supabase CLI migrations with Day 0 baseline

**Context**:
- Previous approach used manually-maintained `CONSOLIDATED_SCHEMA.sql` deployed via psql
- This created drift risk and lacked native migration tracking
- Production had 37 migrations in history from previous approach

**Outcome**:
- Created `20240101000000_baseline.sql` from production dump (9,617 lines)
- Marked baseline as applied, old migrations as reverted
- Future changes will be incremental Supabase CLI migrations
- Archived original SQL files to `sql.archived/` for reference

**Status**: Superseded by Day 0 v2 baseline (2025-12-29)

---

## Benefits of Day 0 Approach

- Native migration tracking via Supabase CLI
- Dry-run capability before production deployment
- GitHub Actions integration for automated deployments
- Rollback capability via `migration repair`
- Clean starting point for new developers (single file vs 25+)
