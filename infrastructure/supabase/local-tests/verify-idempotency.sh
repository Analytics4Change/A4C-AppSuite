#!/bin/bash
# Verify database state after running migrations twice
# Checks for duplicate data and other idempotency issues

set -e

# Auto-detect script location and calculate workdir (parent directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(dirname "$SCRIPT_DIR")"  # infrastructure/supabase/

export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock

echo "=================================================="
echo "Verifying Idempotency"
echo "=================================================="
echo ""

# Get connection details
DB_URL=$(supabase status --workdir "$WORKDIR" 2>&1 | grep "Database URL" | awk '{print $3}')

if [ -z "$DB_URL" ]; then
  echo "❌ Error: Could not get database URL. Is Supabase running?"
  exit 1
fi

echo "Connected to: $DB_URL"
echo ""

# Check for duplicate rows in key tables
echo "Checking for duplicate IDs..."
echo "--------------------------------------------------"

TABLES=("organizations" "users" "domain_events" "clients" "medications")

for table in "${TABLES[@]}"; do
  DUPLICATES=$(psql "$DB_URL" -t -c "
    SELECT COUNT(*)
    FROM (
      SELECT id, COUNT(*) as cnt
      FROM $table
      GROUP BY id
      HAVING COUNT(*) > 1
    ) duplicates
  " 2>/dev/null || echo "0")

  DUPLICATES=$(echo "$DUPLICATES" | tr -d '[:space:]')

  if [ "$DUPLICATES" = "0" ]; then
    echo "  ✅ $table - No duplicates"
  else
    echo "  ❌ $table - Found $DUPLICATES duplicate IDs!"
  fi
done

echo ""

# Count total rows
echo "Table Row Counts:"
echo "--------------------------------------------------"

for table in "${TABLES[@]}"; do
  COUNT=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM $table" 2>/dev/null || echo "N/A")
  COUNT=$(echo "$COUNT" | tr -d '[:space:]')
  printf "  %-20s %s rows\n" "$table:" "$COUNT"
done

echo ""

# Check triggers exist
echo "Checking Triggers..."
echo "--------------------------------------------------"
TRIGGER_COUNT=$(psql "$DB_URL" -t -c "
  SELECT COUNT(*)
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
" 2>/dev/null || echo "0")

TRIGGER_COUNT=$(echo "$TRIGGER_COUNT" | tr -d '[:space:]')
echo "  Found $TRIGGER_COUNT triggers"

echo ""

# Check functions exist
echo "Checking Functions..."
echo "--------------------------------------------------"
FUNCTION_COUNT=$(psql "$DB_URL" -t -c "
  SELECT COUNT(*)
  FROM information_schema.routines
  WHERE routine_schema = 'public'
" 2>/dev/null || echo "0")

FUNCTION_COUNT=$(echo "$FUNCTION_COUNT" | tr -d '[:space:]')
echo "  Found $FUNCTION_COUNT functions"

echo ""
echo "=================================================="
echo "Verification Complete"
echo "=================================================="
