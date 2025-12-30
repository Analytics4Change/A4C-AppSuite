---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Testing guide for verifying SQL migrations can run multiple times without errors, including test strategies for triggers, seed data, projections, and an automated test script.

**When to read**:
- Testing SQL migration idempotency before deployment
- Debugging duplicate data or constraint violations
- Setting up automated idempotency testing in CI/CD

**Prerequisites**: [SQL_IDEMPOTENCY_AUDIT.md](./SQL_IDEMPOTENCY_AUDIT.md)

**Key topics**: `idempotency-testing`, `sql-migration`, `seed-data`, `ci-cd`, `postgresql`

**Estimated read time**: 12 minutes
<!-- TL;DR-END -->

# SQL Migration Idempotency Testing Guide

## Purpose

Verify that all SQL migrations can be run multiple times without errors or duplicate data.

## Prerequisites

1. Access to Supabase project with psql connection
2. Environment variables configured:
   ```bash
   export SUPABASE_URL="https://yourproject.supabase.co"
   export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
   export PGPASSWORD="$SUPABASE_SERVICE_ROLE_KEY"
   ```
3. Project reference extracted:
   ```bash
   export PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://\([^.]*\).*|\1|')
   export DB_HOST="db.${PROJECT_REF}.supabase.co"
   ```

## Test Strategy

### Phase 1: Create Fresh Test Database (Recommended)

**Option A: Use Supabase Development Branch**
```bash
# Create a new development branch via Supabase CLI or API
# This provides a clean database for testing

# Execute all migrations once
for dir in 00-extensions 01-events 02-tables 03-functions 04-triggers 05-views 06-rls 99-seeds; do
  echo "==> Running migrations in $dir"
  find infrastructure/supabase/sql/$dir -name "*.sql" -type f | sort | while read file; do
    echo "  - $file"
    psql -h "$DB_HOST" -U postgres -d postgres -f "$file" -v ON_ERROR_STOP=1
  done
done

# Execute all migrations AGAIN (idempotency test)
for dir in 00-extensions 01-events 02-tables 03-functions 04-triggers 05-views 06-rls 99-seeds; do
  echo "==> Re-running migrations in $dir (idempotency test)"
  find infrastructure/supabase/sql/$dir -name "*.sql" -type f | sort | while read file; do
    echo "  - $file"
    psql -h "$DB_HOST" -U postgres -d postgres -f "$file" -v ON_ERROR_STOP=1
  done
done
```

**Option B: Use Local PostgreSQL with Docker**
```bash
# Start local PostgreSQL
docker run --name test-postgres -e POSTGRES_PASSWORD=test -p 5432:5432 -d postgres:15

# Set connection variables
export PGHOST=localhost
export PGPORT=5432
export PGUSER=postgres
export PGPASSWORD=test
export PGDATABASE=postgres

# Run migrations twice (same script as above, but with local connection)
```

### Phase 2: Targeted Testing (Specific Files)

#### Test Trigger Idempotency

**Files:**
- `sql/04-triggers/001-process-domain-event-trigger.sql`
- `sql/04-triggers/process_user_invited.sql`
- `sql/04-triggers/bootstrap-event-listener.sql`

**Test:**
```bash
# Run each trigger file twice
for file in sql/04-triggers/*.sql; do
  echo "==> Testing $file (run 1)"
  psql -h "$DB_HOST" -U postgres -d postgres -f "$file" -v ON_ERROR_STOP=1

  echo "==> Testing $file (run 2 - idempotency)"
  psql -h "$DB_HOST" -U postgres -d postgres -f "$file" -v ON_ERROR_STOP=1
done
```

**Expected Result:** No errors. Triggers should be dropped and recreated cleanly.

#### Test Seed Data Idempotency

**Files:**
- `sql/99-seeds/001-minimal-permissions.sql` (22 permissions)
- `sql/99-seeds/003-rbac-initial-setup.sql` (12 permissions + roles)
- `sql/99-seeds/004-organization-permissions-setup.sql` (8 permissions)

**Test:**
```bash
# Count events before first run
psql -h "$DB_HOST" -U postgres -d postgres <<'SQL'
SELECT
  event_type,
  COUNT(*) as count
FROM domain_events
WHERE event_type IN ('permission.defined', 'role.created', 'organization.registered')
GROUP BY event_type
ORDER BY event_type;
SQL

# Run seed files
for file in sql/99-seeds/001-minimal-permissions.sql \
            sql/99-seeds/003-rbac-initial-setup.sql \
            sql/99-seeds/004-organization-permissions-setup.sql; do
  echo "==> Running $file (first time)"
  psql -h "$DB_HOST" -U postgres -d postgres -f "infrastructure/supabase/$file" -v ON_ERROR_STOP=1
done

# Count events after first run
psql -h "$DB_HOST" -U postgres -d postgres <<'SQL'
SELECT
  event_type,
  COUNT(*) as count
FROM domain_events
WHERE event_type IN ('permission.defined', 'role.created', 'organization.registered')
GROUP BY event_type
ORDER BY event_type;
SQL

# Run seed files AGAIN (idempotency test)
for file in sql/99-seeds/001-minimal-permissions.sql \
            sql/99-seeds/003-rbac-initial-setup.sql \
            sql/99-seeds/004-organization-permissions-setup.sql; do
  echo "==> Running $file (second time - idempotency test)"
  psql -h "$DB_HOST" -U postgres -d postgres -f "infrastructure/supabase/$file" -v ON_ERROR_STOP=1
done

# Count events after second run (should be SAME as after first run)
psql -h "$DB_HOST" -U postgres -d postgres <<'SQL'
SELECT
  event_type,
  COUNT(*) as count
FROM domain_events
WHERE event_type IN ('permission.defined', 'role.created', 'organization.registered')
GROUP BY event_type
ORDER BY event_type;
SQL
```

**Expected Counts (after both runs):**
```
          event_type          | count
------------------------------+-------
 organization.registered      |     1
 permission.defined           |    42  (22 from 001 + 12 from 003 + 8 from 004)
 role.created                 |     3  (super_admin, provider_admin, partner_admin)
```

**Expected Result:** Event counts should be IDENTICAL after first and second run. No duplicates created.

#### Test Projection Updates

**Purpose:** Verify that event processors correctly update projections.

**Test:**
```bash
# After running seed files, check projections match events
psql -h "$DB_HOST" -U postgres -d postgres <<'SQL'
-- Count permissions in events vs projections
SELECT 'Events' as source, COUNT(*) FROM domain_events WHERE event_type = 'permission.defined'
UNION ALL
SELECT 'Projection', COUNT(*) FROM permissions_projection;

-- Count roles in events vs projections
SELECT 'Events' as source, COUNT(*) FROM domain_events WHERE event_type = 'role.created'
UNION ALL
SELECT 'Projection', COUNT(*) FROM roles_projection;

-- Count organizations in events vs projections
SELECT 'Events' as source, COUNT(*) FROM domain_events WHERE event_type = 'organization.registered'
UNION ALL
SELECT 'Projection', COUNT(*) FROM organizations_projection;
SQL
```

**Expected Result:** Event counts should match projection counts (triggers processed all events).

### Phase 3: Automated Idempotency Test Script

Create a comprehensive test script:

```bash
#!/bin/bash
# File: infrastructure/supabase/test-idempotency.sh
set -euo pipefail

# Configuration
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
  exit 1
fi

export PGPASSWORD="$SUPABASE_SERVICE_ROLE_KEY"
PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://\([^.]*\).*|\1|')
DB_HOST="db.${PROJECT_REF}.supabase.co"

echo "==> Testing SQL Migration Idempotency"
echo "Database: $DB_HOST"

# Function to run SQL file and capture output
run_sql() {
  local file=$1
  echo "  Running: $file"
  psql -h "$DB_HOST" -U postgres -d postgres -f "$file" -v ON_ERROR_STOP=1 2>&1 | grep -v "^$" || true
}

# Function to count events
count_events() {
  psql -h "$DB_HOST" -U postgres -d postgres -t -c "
    SELECT COUNT(*) FROM domain_events;
  " | xargs
}

# Phase 1: Count baseline
echo ""
echo "==> Phase 1: Baseline event count"
BASELINE=$(count_events)
echo "Baseline events: $BASELINE"

# Phase 2: Run all migrations ONCE
echo ""
echo "==> Phase 2: Running migrations (first time)"
for dir in 00-extensions 01-events 02-tables 03-functions 04-triggers 05-views 06-rls 99-seeds; do
  echo "Directory: $dir"
  find "sql/$dir" -name "*.sql" -type f | sort | while read file; do
    run_sql "$file"
  done
done

FIRST_RUN=$(count_events)
echo "Events after first run: $FIRST_RUN"
FIRST_RUN_NEW=$((FIRST_RUN - BASELINE))
echo "New events created: $FIRST_RUN_NEW"

# Phase 3: Run all migrations AGAIN (idempotency test)
echo ""
echo "==> Phase 3: Running migrations (second time - IDEMPOTENCY TEST)"
for dir in 00-extensions 01-events 02-tables 03-functions 04-triggers 05-views 06-rls 99-seeds; do
  echo "Directory: $dir"
  find "sql/$dir" -name "*.sql" -type f | sort | while read file; do
    run_sql "$file"
  done
done

SECOND_RUN=$(count_events)
echo "Events after second run: $SECOND_RUN"
SECOND_RUN_NEW=$((SECOND_RUN - FIRST_RUN))

# Phase 4: Verify idempotency
echo ""
echo "==> Phase 4: Idempotency Verification"
echo "Events after first run:  $FIRST_RUN"
echo "Events after second run: $SECOND_RUN"
echo "New events on second run: $SECOND_RUN_NEW"

if [ "$SECOND_RUN_NEW" -eq 0 ]; then
  echo "✅ PASS: No new events created on second run (idempotent)"
  exit 0
else
  echo "❌ FAIL: $SECOND_RUN_NEW new events created on second run (NOT idempotent)"
  exit 1
fi
```

**Run automated test:**
```bash
cd infrastructure/supabase
chmod +x test-idempotency.sh
./test-idempotency.sh
```

**Expected Output:**
```
==> Testing SQL Migration Idempotency
Database: db.yourproject.supabase.co

==> Phase 1: Baseline event count
Baseline events: 0

==> Phase 2: Running migrations (first time)
Directory: 00-extensions
  Running: sql/00-extensions/uuid-ossp.sql
Directory: 01-events
  Running: sql/01-events/domain_events.sql
...
Events after first run: 42
New events created: 42

==> Phase 3: Running migrations (second time - IDEMPOTENCY TEST)
Directory: 00-extensions
  Running: sql/00-extensions/uuid-ossp.sql
...
Events after second run: 42
New events on second run: 0

==> Phase 4: Idempotency Verification
Events after first run:  42
Events after second run: 42
New events on second run: 0
✅ PASS: No new events created on second run (idempotent)
```

## Common Issues and Fixes

### Issue: "relation already exists"

**Cause:** Missing `IF NOT EXISTS` in CREATE TABLE/INDEX
**Fix:** Add `CREATE TABLE IF NOT EXISTS` or `CREATE INDEX IF NOT EXISTS`

### Issue: "function already exists"

**Cause:** Missing `OR REPLACE` in CREATE FUNCTION
**Fix:** Add `CREATE OR REPLACE FUNCTION`

### Issue: "trigger already exists"

**Cause:** Missing `DROP TRIGGER IF EXISTS` before CREATE TRIGGER
**Fix:** Add `DROP TRIGGER IF EXISTS trigger_name ON table_name;` before CREATE TRIGGER

### Issue: Duplicate events in domain_events

**Cause:** INSERT without existence check in seed data
**Fix:** Wrap INSERT in conditional DO block (already fixed in our seed files)

### Issue: Projection counts don't match events

**Cause:** Trigger not firing or ON CONFLICT DO NOTHING preventing updates
**Fix:** Check trigger is registered and projection unique constraints are correct

## Manual Verification Queries

After running migrations twice, verify idempotency with these queries:

```sql
-- Check for duplicate permissions
SELECT
  event_data->>'applet' as applet,
  event_data->>'action' as action,
  COUNT(*) as count
FROM domain_events
WHERE event_type = 'permission.defined'
GROUP BY event_data->>'applet', event_data->>'action'
HAVING COUNT(*) > 1;
-- Expected: 0 rows (no duplicates)

-- Check for duplicate roles
SELECT
  event_data->>'name' as role_name,
  COUNT(*) as count
FROM domain_events
WHERE event_type = 'role.created'
GROUP BY event_data->>'name'
HAVING COUNT(*) > 1;
-- Expected: 0 rows (no duplicates)

-- Check for duplicate organizations
SELECT
  event_data->>'name' as org_name,
  COUNT(*) as count
FROM domain_events
WHERE event_type = 'organization.registered'
GROUP BY event_data->>'name'
HAVING COUNT(*) > 1;
-- Expected: 0 rows (no duplicates)

-- Verify projection integrity
SELECT
  'permissions' as table_name,
  (SELECT COUNT(*) FROM domain_events WHERE event_type = 'permission.defined') as events,
  (SELECT COUNT(*) FROM permissions_projection) as projections
UNION ALL
SELECT
  'roles',
  (SELECT COUNT(*) FROM domain_events WHERE event_type = 'role.created'),
  (SELECT COUNT(*) FROM roles_projection)
UNION ALL
SELECT
  'organizations',
  (SELECT COUNT(*) FROM domain_events WHERE event_type = 'organization.registered'),
  (SELECT COUNT(*) FROM organizations_projection);
-- Expected: events = projections for each table
```

## CI/CD Integration

Once manual testing passes, the automated Supabase migrations workflow (`.github/workflows/supabase-migrations.yml`) will:

1. Validate SQL syntax
2. Check for idempotency patterns
3. Create `_migrations_applied` tracking table
4. Execute migrations with checksum validation
5. Skip already-applied migrations
6. Record execution metadata

**Test the workflow:**
```bash
# Create a test migration
echo "SELECT 1;" > infrastructure/supabase/sql/99-seeds/test-migration.sql

# Commit and push
git add infrastructure/supabase/sql/99-seeds/test-migration.sql
git commit -m "test: Add test migration"
git push origin main

# Monitor workflow in GitHub Actions
# Check logs for:
# - Migration detected
# - Checksum calculated
# - Migration executed
# - Recorded in _migrations_applied table

# Verify in database
psql -h "$DB_HOST" -U postgres -d postgres -c "
  SELECT * FROM _migrations_applied
  WHERE migration_name LIKE '%test-migration%';
"
```

## Cleanup

After testing on development branch:

```bash
# Delete development branch (if using Supabase branch)
# Supabase CLI or API

# Or drop local Docker container
docker stop test-postgres
docker rm test-postgres
```

## Next Steps

1. ✅ Run Phase 2 targeted testing on seed files
2. Create automated test script (test-idempotency.sh)
3. Test on Supabase development branch
4. Verify all checks pass
5. Document any remaining issues
6. Proceed with KUBECONFIG update (next prerequisite)
