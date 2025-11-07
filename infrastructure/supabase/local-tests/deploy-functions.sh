#!/bin/bash
# Deploy all Edge Functions to local Supabase instance
# This script can be run multiple times to test idempotency

set -e  # Exit on error

# Auto-detect script location and calculate workdir (parent directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(dirname "$SCRIPT_DIR")"  # infrastructure/supabase/

export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock

echo "=================================================="
echo "Deploying Supabase Edge Functions"
echo "=================================================="
echo ""

# Check if Supabase is running by looking for containers
export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock
if ! podman ps --filter "name=supabase_db" --format "{{.Names}}" | grep -q "supabase_db"; then
  echo "❌ Error: Local Supabase is not running"
  echo "Run ./start-local.sh first"
  exit 1
fi

echo "✅ Connected to local Supabase"
echo ""

# Get list of Edge Functions (go up to supabase/, then into supabase/functions/)
FUNCTIONS_DIR="$(dirname "$SCRIPT_DIR")/supabase/functions"

if [ ! -d "$FUNCTIONS_DIR" ]; then
  echo "❌ Error: functions directory not found"
  exit 1
fi

# Find all Edge Functions (directories or symlinks to directories)
FUNCTIONS=()
while IFS= read -r -d '' func_path; do
  func_name=$(basename "$func_path")
  # Skip if not a directory or symlink to a directory
  if [ -d "$func_path" ]; then
    FUNCTIONS+=("$func_name")
  fi
done < <(find "$FUNCTIONS_DIR" -mindepth 1 -maxdepth 1 -print0 | sort -z)

if [ ${#FUNCTIONS[@]} -eq 0 ]; then
  echo "⚠️  No Edge Functions found in $FUNCTIONS_DIR"
  exit 0
fi

echo "Found ${#FUNCTIONS[@]} Edge Functions:"
for func in "${FUNCTIONS[@]}"; do
  echo "  - $func"
done
echo ""

# Track success/failure
TOTAL=0
SUCCESS=0
FAILED=0

echo "Starting deployment..."
echo "=================================================="
echo ""

# Deploy each function
for func in "${FUNCTIONS[@]}"; do
  TOTAL=$((TOTAL + 1))
  echo "📦 Deploying: $func"

  if supabase functions deploy "$func" --workdir "$WORKDIR" --no-verify-jwt 2>&1 | grep -q "Deployed"; then
    echo "  ✅ Success"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "  ❌ Failed"
    FAILED=$((FAILED + 1))
    # Show the error
    supabase functions deploy "$func" --workdir "$WORKDIR" --no-verify-jwt 2>&1 | tail -5 | sed 's/^/    /'
  fi

  echo ""
done

echo "=================================================="
echo "Deployment Summary"
echo "=================================================="
echo "Total functions: $TOTAL"
echo "✅ Successful: $SUCCESS"
echo "❌ Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
  echo "🎉 All Edge Functions deployed successfully!"
  echo ""
  echo "To test idempotency, run this script again:"
  echo "  ./deploy-functions.sh"
  echo ""
  echo "To verify deployment:"
  echo "  ./verify-functions.sh"
  exit 0
else
  echo "⚠️  Some deployments failed. Check errors above."
  exit 1
fi
