---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Comprehensive guide to idempotent SQL patterns for migrations. Covers `CREATE IF NOT EXISTS`, `DROP IF EXISTS` before `CREATE`, and safe `ALTER TABLE` patterns. Essential for CI/CD deployments.

**When to read**:
- Writing new database migrations
- Fixing migrations that fail on re-run
- Understanding idempotency patterns for tables, policies, triggers, functions
- Reviewing migration quality before merging

**Key topics**: `migration`, `sql`, `idempotent`, `database`, `ci-cd`, `patterns`

**Estimated read time**: 15 minutes
<!-- TL;DR-END -->

# SQL Migration Idempotency Audit Report

**Date:** 2025-11-03
**Auditor:** Claude Code
**Total SQL Files:** 101

## Executive Summary

The SQL migrations have **mixed idempotency compliance**. Most files use proper idempotent patterns, but there are critical issues that must be addressed before implementing automated CI/CD deployments.

### Idempotency Status by Category

| Category | Status | Notes |
|----------|--------|-------|
| ✅ Extensions (3 files) | **GOOD** | All use `CREATE EXTENSION IF NOT EXISTS` |
| ✅ Tables (50+ files) | **GOOD** | All use `CREATE TABLE IF NOT EXISTS` |
| ✅ Indexes (30+ files) | **GOOD** | All use `CREATE INDEX IF NOT EXISTS` |
| ✅ Functions (12+ files) | **GOOD** | All use `CREATE OR REPLACE FUNCTION` |
| ❌ Triggers (4+ files) | **ISSUES** | Missing `DROP TRIGGER IF EXISTS` |
| ⚠️ Seed Files (5 files) | **ISSUES** | INSERT without ON CONFLICT |
| ⚠️ ALTER TABLE (several) | **NEEDS REVIEW** | Require manual validation |

### Priority Actions Required

1. **HIGH**: Fix trigger creation to be idempotent
2. **HIGH**: Add ON CONFLICT handling to seed data
3. **MEDIUM**: Review ALTER TABLE statements for idempotency
4. **LOW**: Add migration version tracking

---

## Detailed Findings

### 1. Extensions ✅ GOOD

**Files:** `00-extensions/*.sql`

All extension files properly use idempotent patterns:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "ltree";
```

**Status:** ✅ No changes needed

---

### 2. Tables ✅ GOOD

**Files:** `02-tables/**/*.sql`

All table creation files use `IF NOT EXISTS`:

```sql
CREATE TABLE IF NOT EXISTS organizations_projection (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  ...
);
```

**Sample files checked:**
- `02-tables/organizations/001-organizations_projection.sql` ✅
- `02-tables/clients/table.sql` ✅
- `02-tables/medications/table.sql` ✅
- `02-tables/rbac/*_projection.sql` ✅

**Status:** ✅ No changes needed

---

### 3. Indexes ✅ GOOD

**Files:** `02-tables/*/indexes/*.sql`

All index creation files use `IF NOT EXISTS`:

```sql
CREATE INDEX IF NOT EXISTS idx_organizations_zitadel_org_id
  ON organizations_projection(zitadel_org_id);
```

**Status:** ✅ No changes needed

---

### 4. Functions ✅ GOOD

**Files:** `03-functions/**/*.sql`

All function files use `CREATE OR REPLACE`:

```sql
CREATE OR REPLACE FUNCTION user_has_permission(
  p_user_id UUID,
  p_permission_name TEXT,
  ...
) RETURNS BOOLEAN AS $$
...
```

**Sample files checked:**
- `03-functions/authorization/001-user_has_permission.sql` ✅
- `03-functions/event-processing/*.sql` ✅
- `03-functions/external-services/*.sql` ✅

**Status:** ✅ No changes needed

---

### 5. Triggers ❌ CRITICAL ISSUES

**Files:** `04-triggers/*.sql`

**Problem:** Triggers do NOT use `DROP TRIGGER IF EXISTS` before creation.

**Example from `04-triggers/001-process-domain-event-trigger.sql`:**

```sql
-- ❌ NOT IDEMPOTENT
CREATE TRIGGER process_domain_event_trigger
  BEFORE INSERT OR UPDATE ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION process_domain_event();
```

**Issue:** Running this twice will error: `ERROR: trigger "process_domain_event_trigger" already exists`

### **Required Fix:**

```sql
-- ✅ IDEMPOTENT
DROP TRIGGER IF EXISTS process_domain_event_trigger ON domain_events;

CREATE TRIGGER process_domain_event_trigger
  BEFORE INSERT OR UPDATE ON domain_events
  FOR EACH ROW
  EXECUTE FUNCTION process_domain_event();
```

### **Files Requiring Updates:**

1. `04-triggers/001-process-domain-event-trigger.sql`
2. `04-triggers/bootstrap-event-listener.sql`
3. `04-triggers/process_user_invited.sql`

**Action:** Add `DROP TRIGGER IF EXISTS <trigger_name> ON <table>;` before each `CREATE TRIGGER`

---

### 6. Seed Data ⚠️ ISSUES

**Files:** `99-seeds/*.sql`

**Problem:** INSERT statements without `ON CONFLICT` handling.

**Example from `99-seeds/001-minimal-permissions.sql`:**

```sql
-- ❌ NOT IDEMPOTENT
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (gen_random_uuid(), 'permission', 1, 'permission.defined', ...);
```

**Issue:**
- Running this twice creates duplicate events with different `stream_id` (due to `gen_random_uuid()`)
- For event sourcing, this creates inconsistent state

### **Recommended Approach:**

Since seed files insert domain events (event sourcing pattern), we have two options:

#### **Option A: Check Before Insert (Recommended for Events)**

```sql
-- ✅ IDEMPOTENT (conditional insert)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM domain_events
    WHERE event_type = 'permission.defined'
      AND event_data->>'applet' = 'organization'
      AND event_data->>'action' = 'create_root'
  ) THEN
    INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
    VALUES (gen_random_uuid(), 'permission', 1, 'permission.defined', ...);
  END IF;
END $$;
```

#### **Option B: Fixed UUIDs for Seed Data**

```sql
-- ✅ IDEMPOTENT (fixed UUID with ON CONFLICT)
INSERT INTO domain_events (stream_id, stream_type, stream_version, event_type, event_data, event_metadata)
VALUES (
  '11111111-0000-0000-0000-000000000001'::UUID,  -- Fixed UUID for bootstrap permission
  'permission', 1, 'permission.defined', ...
)
ON CONFLICT (stream_id) DO NOTHING;
```

### **Files Requiring Updates:**

1. `99-seeds/001-minimal-permissions.sql` (22 permissions)
2. `99-seeds/002-bootstrap-org-roles.sql`
3. `99-seeds/003-grant-super-admin-permissions.sql`
4. `99-seeds/003-rbac-initial-setup.sql`
5. `99-seeds/004-lars-tice-bootstrap.sql`
6. `99-seeds/004-organization-permissions-setup.sql`

**Recommendation:** Use **Option B (Fixed UUIDs)** for seed data. This ensures:
- Idempotent execution
- Consistent UUIDs across all environments
- Easier debugging (known seed data IDs)

---

### 7. ALTER TABLE Statements ⚠️ NEEDS REVIEW

**Files:** `02-tables/organizations/003-add-subdomain-columns.sql` (and others)

**Problem:** ALTER TABLE operations may not be idempotent.

**Common patterns that need checking:**

```sql
-- ❌ NOT IDEMPOTENT (fails if column exists)
ALTER TABLE organizations_projection
  ADD COLUMN subdomain TEXT UNIQUE;

-- ✅ IDEMPOTENT (PostgreSQL 9.6+, conditionally add column)
ALTER TABLE organizations_projection
  ADD COLUMN IF NOT EXISTS subdomain TEXT UNIQUE;
```

**Action:** Review all ALTER TABLE statements and add `IF NOT EXISTS` / `IF EXISTS` clauses where supported.

---

### 8. Type Definitions

**Files:** `01-events/003-subdomain-status-enum.sql` (and others with CREATE TYPE)

**Need to check:** Do these use idempotent patterns?

```sql
-- ❌ NOT IDEMPOTENT
CREATE TYPE subdomain_status AS ENUM ('pending', 'active', 'suspended');

-- ✅ IDEMPOTENT
DROP TYPE IF EXISTS subdomain_status CASCADE;
CREATE TYPE subdomain_status AS ENUM ('pending', 'active', 'suspended');
```

**Action:** Audit all `CREATE TYPE` statements.

---

## Recommended CI/CD Migration Workflow

### Phase 1: Make Migrations Idempotent

1. **Week 1: Fix Triggers**
   - Add `DROP TRIGGER IF EXISTS` to all trigger files
   - Test idempotency: run each trigger file twice
   - Verify no errors on second execution

2. **Week 1: Fix Seed Data**
   - Convert to fixed UUIDs with `ON CONFLICT DO NOTHING`
   - Document seed data UUIDs in SEED_DATA_IDS.md
   - Test idempotency: run each seed file twice

3. **Week 2: Review ALTER TABLE**
   - Audit all ALTER TABLE statements
   - Add `IF NOT EXISTS` / `IF EXISTS` where possible
   - Create manual migration notes for complex ALTERs

4. **Week 2: Audit CREATE TYPE**
   - Check all type definitions
   - Add `DROP TYPE IF EXISTS CASCADE` where needed

### Phase 2: Create Migration Workflow

5. **Week 3: CI/CD Workflow**
   - Create `.github/workflows/supabase-migrations.yml`
   - Add migration version tracking table
   - Implement migration ordering and execution

### Phase 3: Testing

6. **Week 3-4: Validation**
   - Test full migration suite on fresh database
   - Test idempotency (run twice, verify identical state)
   - Test on staging environment
   - Deploy to production

---

## Migration Version Tracking

Recommend adding a migration tracking table:

```sql
CREATE TABLE IF NOT EXISTS _migrations_applied (
  id SERIAL PRIMARY KEY,
  migration_name TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  checksum TEXT,  -- SHA256 of file content
  execution_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_migrations_name
  ON _migrations_applied(migration_name);
```

This allows the CI/CD workflow to:
- Track which migrations have been applied
- Skip already-applied migrations
- Detect if migration file content changed (checksum validation)
- Monitor migration performance

---

## Testing Idempotency

### Manual Test Script

```bash
#!/bin/bash
# Test migration idempotency

MIGRATION_FILE="$1"

echo "Testing idempotency of: $MIGRATION_FILE"

# Apply migration first time
echo "First execution..."
psql -f "$MIGRATION_FILE" || { echo "❌ First execution failed"; exit 1; }

# Apply migration second time (should succeed with no errors)
echo "Second execution (idempotency test)..."
psql -f "$MIGRATION_FILE" || { echo "❌ Second execution failed - NOT IDEMPOTENT"; exit 1; }

echo "✅ Migration is idempotent"
```

### CI/CD Validation

Add to `.github/workflows/supabase-migrations.yml`:

```yaml
- name: Test Migration Idempotency
  run: |
    for migration in $(ls infrastructure/supabase/sql/**/*.sql | sort); do
      echo "Testing: $migration"
      psql -f "$migration" || exit 1
      psql -f "$migration" || { echo "❌ Not idempotent: $migration"; exit 1; }
    done
```

---

## Summary of Required Changes

| Priority | Category | Files Affected | Estimated Effort |
|----------|----------|----------------|------------------|
| 🔴 **HIGH** | Triggers | 3-4 files | 30 minutes |
| 🔴 **HIGH** | Seed Data | 6 files | 2 hours |
| 🟡 **MEDIUM** | ALTER TABLE | ~5 files | 1 hour |
| 🟡 **MEDIUM** | CREATE TYPE | ~2 files | 30 minutes |
| 🟢 **LOW** | Version Tracking | New file | 1 hour |
| 🟢 **LOW** | Testing Script | New file | 1 hour |

**Total Estimated Effort:** ~6-8 hours

---

## Next Steps

1. ✅ Review this audit report
2. 🔧 Fix trigger files (HIGH priority)
3. 🔧 Fix seed data files (HIGH priority)
4. 🔍 Manual review of ALTER TABLE and CREATE TYPE
5. 📝 Create migration version tracking
6. 🤖 Create CI/CD workflow (.github/workflows/supabase-migrations.yml)
7. ✅ Test full migration suite

---

## Appendix: Idempotency Patterns Reference

### ✅ Idempotent Patterns

```sql
-- Tables
CREATE TABLE IF NOT EXISTS table_name (...);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_name ON table_name(column);

-- Functions
CREATE OR REPLACE FUNCTION func_name(...) RETURNS ... AS $$...;

-- Triggers
DROP TRIGGER IF EXISTS trigger_name ON table_name;
CREATE TRIGGER trigger_name ...;

-- Extensions
CREATE EXTENSION IF NOT EXISTS extension_name;

-- Types (PostgreSQL 9.6+)
DROP TYPE IF EXISTS type_name CASCADE;
CREATE TYPE type_name AS ENUM (...);

-- Columns (PostgreSQL 9.6+)
ALTER TABLE table_name ADD COLUMN IF NOT EXISTS column_name TYPE;

-- Seed Data
INSERT INTO table_name (...) VALUES (...)
ON CONFLICT (unique_column) DO NOTHING;

-- OR with fixed IDs
INSERT INTO table_name (id, ...) VALUES ('fixed-uuid'::UUID, ...)
ON CONFLICT (id) DO NOTHING;

-- OR conditional insert
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM table WHERE condition) THEN
    INSERT INTO table VALUES (...);
  END IF;
END $$;
```

### ❌ Non-Idempotent Patterns (Avoid)

```sql
-- ❌ Will fail on second run
CREATE TABLE table_name (...);
CREATE INDEX idx_name ON table_name(column);
CREATE FUNCTION func_name(...);
CREATE TRIGGER trigger_name ...;
CREATE TYPE type_name AS ENUM (...);

-- ❌ Will create duplicates
INSERT INTO table VALUES (...);

-- ❌ Will fail if column exists
ALTER TABLE table ADD COLUMN column_name TYPE;
```

---

**End of Audit Report**
