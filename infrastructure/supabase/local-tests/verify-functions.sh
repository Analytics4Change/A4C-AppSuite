#!/bin/bash
# Verify Edge Functions are deployed to local Supabase
# Checks function existence and basic health

set -e

# Auto-detect script location and calculate workdir (parent directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(dirname "$SCRIPT_DIR")"  # infrastructure/supabase/

export DOCKER_HOST=unix:///run/user/1000/podman/podman.sock

echo "=================================================="
echo "Verifying Edge Functions Deployment"
echo "=================================================="
echo ""

# Check if Supabase is running
if ! supabase status --workdir "$WORKDIR" &>/dev/null; then
  echo "❌ Error: Local Supabase is not running"
  echo "Run ./start-local.sh first"
  exit 1
fi

echo "✅ Connected to local Supabase"
echo ""

# Get API URL for functions
API_URL=$(supabase status --workdir "$WORKDIR" 2>&1 | grep "API URL" | awk '{print $3}')
ANON_KEY=$(supabase status --workdir "$WORKDIR" 2>&1 | grep "anon key" | awk '{print $3}')

if [ -z "$API_URL" ] || [ -z "$ANON_KEY" ]; then
  echo "❌ Error: Could not get Supabase connection details"
  exit 1
fi

echo "API URL: $API_URL"
echo ""

# List of expected functions
FUNCTIONS=(
  "organization-bootstrap"
  "workflow-status"
  "validate-invitation"
  "accept-invitation"
)

echo "Checking deployed functions..."
echo "--------------------------------------------------"

DEPLOYED=0
MISSING=0

for func in "${FUNCTIONS[@]}"; do
  # Check if function endpoint responds
  FUNC_URL="$API_URL/functions/v1/$func"

  # Try OPTIONS request (CORS preflight - should always succeed)
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X OPTIONS "$FUNC_URL" \
    -H "apikey: $ANON_KEY" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
    echo "  ✅ $func - deployed and responding"
    DEPLOYED=$((DEPLOYED + 1))
  else
    echo "  ❌ $func - not accessible (HTTP $HTTP_CODE)"
    MISSING=$((MISSING + 1))
  fi
done

echo ""
echo "=================================================="
echo "Verification Complete"
echo "=================================================="
echo "Deployed: $DEPLOYED/${#FUNCTIONS[@]}"
echo "Missing: $MISSING"
echo ""

if [ $MISSING -eq 0 ]; then
  echo "✅ All Edge Functions are deployed and accessible"
  exit 0
else
  echo "⚠️  Some functions are not accessible"
  echo ""
  echo "Troubleshooting:"
  echo "  1. Run ./deploy-functions.sh to deploy functions"
  echo "  2. Check function logs: supabase functions logs <function-name>"
  echo "  3. Verify local Supabase status: ./status-local.sh"
  exit 1
fi
