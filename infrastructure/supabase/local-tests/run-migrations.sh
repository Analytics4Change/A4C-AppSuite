#!/bin/bash
# Run all Supabase migrations in order
# This script can be run multiple times to test idempotency

set -e  # Exit on error

# Auto-detect script location and calculate workdir (parent directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(dirname "$SCRIPT_DIR")"  # infrastructure/supabase/

export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock

echo "=================================================="
echo "Running Supabase Migrations"
echo "=================================================="
echo ""

# Get connection details
echo "Getting connection details..."
DB_URL=$(supabase status --workdir "$WORKDIR" 2>&1 | grep "Database URL" | awk '{print $3}')

if [ -z "$DB_URL" ]; then
  echo "❌ Error: Could not get database URL. Is Supabase running?"
  echo "Run ./start-local.sh first"
  exit 1
fi

echo "✅ Connected to: $DB_URL"
echo ""

# Migration directories in dependency order (relative to supabase/)
MIGRATION_DIRS=(
  "00-extensions"
  "01-events"
  "02-tables"
  "03-functions"
  "04-triggers"
  "05-views"
  "06-rls"
  "99-seeds"
)

# Change to supabase directory to access SQL files
cd "$(dirname "$SCRIPT_DIR")"

# Track success/failure
TOTAL=0
SUCCESS=0
FAILED=0

echo "Starting migrations..."
echo "=================================================="
echo ""

# Run each directory in order
for dir in "${MIGRATION_DIRS[@]}"; do
  DIR_PATH="sql/$dir"

  if [ ! -d "$DIR_PATH" ]; then
    echo "⚠️  Skipping $dir (directory not found)"
    continue
  fi

  echo "📁 Processing: $dir"
  echo "--------------------------------------------------"

  # Find all .sql files recursively
  while IFS= read -r -d '' file; do
    TOTAL=$((TOTAL + 1))
    echo "  ▶ Running: ${file#sql/}"

    if psql "$DB_URL" -f "$file" -v ON_ERROR_STOP=1 > /dev/null 2>&1; then
      echo "    ✅ Success"
      SUCCESS=$((SUCCESS + 1))
    else
      echo "    ❌ Failed"
      FAILED=$((FAILED + 1))
      # Show the error
      psql "$DB_URL" -f "$file" 2>&1 | tail -5 | sed 's/^/      /'
    fi
  done < <(find "$DIR_PATH" -name "*.sql" -type f -print0 | sort -z)

  echo ""
done

echo "=================================================="
echo "Migration Summary"
echo "=================================================="
echo "Total files: $TOTAL"
echo "✅ Successful: $SUCCESS"
echo "❌ Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
  echo "🎉 All migrations completed successfully!"
  echo ""
  echo "To test idempotency, run this script again:"
  echo "  ./run-migrations.sh"
  exit 0
else
  echo "⚠️  Some migrations failed. Check errors above."
  exit 1
fi
