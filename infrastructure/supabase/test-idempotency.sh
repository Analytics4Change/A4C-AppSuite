#!/bin/bash
# SQL Migration Idempotency Test Script
# Tests that all SQL migrations can be run multiple times without creating duplicates

set -euo pipefail

# Configuration
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
  echo ""
  echo "Example:"
  echo "  export SUPABASE_URL='https://yourproject.supabase.co'"
  echo "  export SUPABASE_SERVICE_ROLE_KEY='your-service-role-key'"
  echo "  ./test-idempotency.sh"
  exit 1
fi

export PGPASSWORD="$SUPABASE_SERVICE_ROLE_KEY"
PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://\([^.]*\).*|\1|')

# Use direct connection (requires IPv4 support)
# Note: May fail if system only supports IPv6
DB_HOST="db.${PROJECT_REF}.supabase.co"
DB_PORT="5432"
DB_USER="postgres"
DB_NAME="postgres"

# Force IPv4 by using -4 flag with curl to test first
# If you get "Network unreachable", your system needs IPv6 or
# you can use ssh tunnel: ssh -L 5432:db.${PROJECT_REF}.supabase.co:5432 your-server

echo "========================================="
echo "SQL Migration Idempotency Test"
echo "========================================="
echo "Database: $DB_HOST"
echo ""

# Function to run SQL file
run_sql() {
  local file=$1
  local quiet=${2:-false}

  if [ "$quiet" = "true" ]; then
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$file" -v ON_ERROR_STOP=1 > /dev/null 2>&1
  else
    echo "    $(basename "$file")"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$file" -v ON_ERROR_STOP=1 2>&1 | grep -E "(NOTICE|ERROR|WARNING)" || true
  fi
}

# Function to count events by type
count_events_by_type() {
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "
    SELECT
      event_type,
      COUNT(*)
    FROM domain_events
    WHERE event_type IN ('permission.defined', 'role.created', 'organization.registered', 'role.permission.granted')
    GROUP BY event_type
    ORDER BY event_type;
  "
}

# Function to count total events
count_total_events() {
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "
    SELECT COUNT(*) FROM domain_events;
  "
}

# Phase 1: Baseline count
echo "Phase 1: Baseline Event Count"
echo "------------------------------"
BASELINE=$(count_total_events)
echo "Total events: $BASELINE"
echo ""

if [ "$BASELINE" -gt 0 ]; then
  echo "Event breakdown:"
  count_events_by_type | while IFS='|' read -r event_type count; do
    printf "  %-30s %s\n" "$event_type:" "$count"
  done
  echo ""
fi

# Phase 2: Run migrations FIRST TIME
echo "Phase 2: Running Migrations (First Time)"
echo "-----------------------------------------"

MIGRATION_DIRS=("00-extensions" "01-events" "02-tables" "03-functions" "04-triggers" "05-views" "06-rls" "99-seeds")

for dir in "${MIGRATION_DIRS[@]}"; do
  SQL_DIR="sql/$dir"
  if [ ! -d "$SQL_DIR" ]; then
    echo "⚠️  Directory not found: $SQL_DIR (skipping)"
    continue
  fi

  echo "  📁 $dir"
  find "$SQL_DIR" -name "*.sql" -type f | sort | while read file; do
    run_sql "$file" false
  done
done

FIRST_RUN=$(count_total_events)
FIRST_RUN_NEW=$((FIRST_RUN - BASELINE))

echo ""
echo "Events after first run: $FIRST_RUN"
echo "New events created: $FIRST_RUN_NEW"
echo ""

if [ "$FIRST_RUN_NEW" -gt 0 ]; then
  echo "Event breakdown:"
  count_events_by_type | while IFS='|' read -r event_type count; do
    printf "  %-30s %s\n" "$event_type:" "$count"
  done
  echo ""
fi

# Phase 3: Run migrations SECOND TIME (idempotency test)
echo "Phase 3: Running Migrations (Second Time - IDEMPOTENCY TEST)"
echo "-------------------------------------------------------------"

for dir in "${MIGRATION_DIRS[@]}"; do
  SQL_DIR="sql/$dir"
  if [ ! -d "$SQL_DIR" ]; then
    continue
  fi

  echo "  📁 $dir"
  find "$SQL_DIR" -name "*.sql" -type f | sort | while read file; do
    run_sql "$file" true
  done
done

SECOND_RUN=$(count_total_events)
SECOND_RUN_NEW=$((SECOND_RUN - FIRST_RUN))

echo ""
echo "Events after second run: $SECOND_RUN"
echo "New events created: $SECOND_RUN_NEW"
echo ""

# Phase 4: Verify idempotency
echo "Phase 4: Idempotency Verification"
echo "----------------------------------"
echo "Events after first run:   $FIRST_RUN"
echo "Events after second run:  $SECOND_RUN"
echo "New events on second run: $SECOND_RUN_NEW"
echo ""

# Check for duplicate permissions
echo "Checking for duplicate permissions..."
DUPLICATE_PERMS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "
  SELECT COUNT(*)
  FROM (
    SELECT
      event_data->>'applet' as applet,
      event_data->>'action' as action,
      COUNT(*) as count
    FROM domain_events
    WHERE event_type = 'permission.defined'
    GROUP BY event_data->>'applet', event_data->>'action'
    HAVING COUNT(*) > 1
  ) dups;
")

if [ "$DUPLICATE_PERMS" -gt 0 ]; then
  echo "❌ Found $DUPLICATE_PERMS duplicate permissions"
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    SELECT
      event_data->>'applet' as applet,
      event_data->>'action' as action,
      COUNT(*) as count
    FROM domain_events
    WHERE event_type = 'permission.defined'
    GROUP BY event_data->>'applet', event_data->>'action'
    HAVING COUNT(*) > 1;
  "
else
  echo "✅ No duplicate permissions"
fi

# Check for duplicate roles
echo "Checking for duplicate roles..."
DUPLICATE_ROLES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "
  SELECT COUNT(*)
  FROM (
    SELECT
      event_data->>'name' as role_name,
      COUNT(*) as count
    FROM domain_events
    WHERE event_type = 'role.created'
    GROUP BY event_data->>'name'
    HAVING COUNT(*) > 1
  ) dups;
")

if [ "$DUPLICATE_ROLES" -gt 0 ]; then
  echo "❌ Found $DUPLICATE_ROLES duplicate roles"
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    SELECT
      event_data->>'name' as role_name,
      COUNT(*) as count
    FROM domain_events
    WHERE event_type = 'role.created'
    GROUP BY event_data->>'name'
    HAVING COUNT(*) > 1;
  "
else
  echo "✅ No duplicate roles"
fi

# Check for duplicate organizations
echo "Checking for duplicate organizations..."
DUPLICATE_ORGS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -c "
  SELECT COUNT(*)
  FROM (
    SELECT
      event_data->>'name' as org_name,
      COUNT(*) as count
    FROM domain_events
    WHERE event_type = 'organization.registered'
    GROUP BY event_data->>'name'
    HAVING COUNT(*) > 1
  ) dups;
")

if [ "$DUPLICATE_ORGS" -gt 0 ]; then
  echo "❌ Found $DUPLICATE_ORGS duplicate organizations"
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    SELECT
      event_data->>'name' as org_name,
      COUNT(*) as count
    FROM domain_events
    WHERE event_type = 'organization.registered'
    GROUP BY event_data->>'name'
    HAVING COUNT(*) > 1;
  "
else
  echo "✅ No duplicate organizations"
fi

echo ""
echo "========================================="
echo "FINAL RESULT"
echo "========================================="

# Overall pass/fail
if [ "$SECOND_RUN_NEW" -eq 0 ] && [ "$DUPLICATE_PERMS" -eq 0 ] && [ "$DUPLICATE_ROLES" -eq 0 ] && [ "$DUPLICATE_ORGS" -eq 0 ]; then
  echo "✅ PASS: Migrations are fully idempotent"
  echo ""
  echo "Summary:"
  echo "  - No new events created on second run"
  echo "  - No duplicate permissions found"
  echo "  - No duplicate roles found"
  echo "  - No duplicate organizations found"
  echo ""
  exit 0
else
  echo "❌ FAIL: Migrations are NOT idempotent"
  echo ""
  echo "Issues:"
  [ "$SECOND_RUN_NEW" -gt 0 ] && echo "  - $SECOND_RUN_NEW new events created on second run"
  [ "$DUPLICATE_PERMS" -gt 0 ] && echo "  - $DUPLICATE_PERMS duplicate permissions found"
  [ "$DUPLICATE_ROLES" -gt 0 ] && echo "  - $DUPLICATE_ROLES duplicate roles found"
  [ "$DUPLICATE_ORGS" -gt 0 ] && echo "  - $DUPLICATE_ORGS duplicate organizations found"
  echo ""
  echo "See TEST_SQL_IDEMPOTENCY.md for troubleshooting guidance"
  echo ""
  exit 1
fi
