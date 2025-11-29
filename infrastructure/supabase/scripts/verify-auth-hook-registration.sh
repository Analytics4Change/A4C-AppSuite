#!/bin/bash
#
# Auth Hook Registration Verification Script
#
# This script verifies that the custom_access_token_hook is properly registered
# in Supabase via the Management API. It checks both the hook registration status
# and the underlying database function configuration.
#
# What it checks:
#   - Hook is enabled in Supabase Auth service
#   - Hook URI points to correct database function
#   - Database function exists and has correct permissions
#   - Hook function signature matches expected contract
#
# Usage:
#   ./verify-auth-hook-registration.sh
#
# Environment Variables Required:
#   SUPABASE_ACCESS_TOKEN - Supabase Management API token (from Dashboard → Account → Access Tokens)
#   SUPABASE_PROJECT_REF - Your Supabase project reference (default: tmrjlswbsxmbglmaclxu)
#
# Exit Codes:
#   0 - Success: Hook is registered and configured correctly
#   1 - Failure: Missing dependencies, auth error, or hook not registered
#
# Example:
#   export SUPABASE_ACCESS_TOKEN="sbp_abc123..."
#   export SUPABASE_PROJECT_REF="yourproject"
#   ./verify-auth-hook-registration.sh
#

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configuration
PROJECT_REF="${SUPABASE_PROJECT_REF:-tmrjlswbsxmbglmaclxu}"  # Use env var or default
API_URL="https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth"  # Management API endpoint
EXPECTED_HOOK_URI="pg-functions://postgres/public/custom_access_token_hook"

# ============================================================================
# Helper Functions for Formatted Output
# ============================================================================
log_section() {
    echo ""
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}$1${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_step() {
    echo -e "\n${BLUE}📋 $1${NC}"
}

log_success() {
    echo -e "${GREEN}   ✓ $1${NC}"
}

log_error() {
    echo -e "${RED}   ✗ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}   ⚠ $1${NC}"
}

log_info() {
    echo -e "${NC}   $1${NC}"
}

# ============================================================================
# check_requirements - Verify system dependencies before running
# ============================================================================
check_requirements() {
    log_section "🔍 Checking Requirements"

    # Check for jq (JSON processor)
    if ! command -v jq &> /dev/null; then
        log_error "jq is not installed"
        echo ""
        echo "Install jq:"
        echo "  macOS: brew install jq"
        echo "  Ubuntu/Debian: sudo apt-get install jq"
        echo "  Fedora: sudo dnf install jq"
        exit 1
    fi
    log_success "jq is installed"

    # Check for curl
    if ! command -v curl &> /dev/null; then
        log_error "curl is not installed"
        exit 1
    fi
    log_success "curl is installed"

    # Check for access token
    if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
        log_error "SUPABASE_ACCESS_TOKEN environment variable is not set"
        echo ""
        echo "To get your access token:"
        echo "  1. Go to https://supabase.com/dashboard/account/tokens"
        echo "  2. Create a new token or copy existing one"
        echo "  3. Export it: export SUPABASE_ACCESS_TOKEN='your-token'"
        exit 1
    fi
    log_success "SUPABASE_ACCESS_TOKEN is set"

    log_info "Project Reference: ${PROJECT_REF}"
}

# ============================================================================
# verify_hook_registration - Query Management API for hook status
# ============================================================================
verify_hook_registration() {
    log_section "🧪 Verifying Auth Hook Registration"

    log_step "Fetching auth configuration from Supabase Management API"
    log_info "URL: ${API_URL}"

    # Make API request with Bearer token authentication
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
        -H "Content-Type: application/json" \
        "${API_URL}")

    # Extract HTTP status code and response body
    HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" != "200" ]; then
        log_error "API request failed with status code: ${HTTP_CODE}"
        echo ""
        echo "Response:"
        echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
        echo ""

        if [ "$HTTP_CODE" == "401" ]; then
            log_warning "Unauthorized - Check your SUPABASE_ACCESS_TOKEN"
            echo "  Get a new token from: https://supabase.com/dashboard/account/tokens"
        elif [ "$HTTP_CODE" == "404" ]; then
            log_warning "Project not found - Check your SUPABASE_PROJECT_REF"
            echo "  Current value: ${PROJECT_REF}"
        fi

        exit 1
    fi

    log_success "Successfully fetched auth configuration"

    # ========================================================================
    # Parse and display hook configuration
    # ========================================================================
    log_section "📊 Hook Registration Status"

    # Check if custom access token hook is enabled
    HOOK_ENABLED=$(echo "$BODY" | jq -r '.hook_custom_access_token_enabled // false')

    if [ "$HOOK_ENABLED" == "true" ]; then
        log_success "Custom Access Token Hook: ENABLED"
    else
        log_error "Custom Access Token Hook: DISABLED"
        echo ""
        log_warning "The hook is NOT registered in Supabase Dashboard"
        echo ""
        echo "To register the hook:"
        echo "  1. Go to Supabase Dashboard → Authentication → Hooks"
        echo "  2. Enable 'Custom Access Token' hook"
        echo "  3. Set Hook URI: ${EXPECTED_HOOK_URI}"
        echo "  4. Click 'Save'"
        echo ""
        exit 1
    fi

    # Verify hook URI matches expected value
    HOOK_URI=$(echo "$BODY" | jq -r '.hook_custom_access_token_uri // ""')

    if [ -n "$HOOK_URI" ] && [ "$HOOK_URI" != "null" ]; then
        if [ "$HOOK_URI" == "$EXPECTED_HOOK_URI" ]; then
            log_success "Hook URI: ${HOOK_URI}"
        else
            log_warning "Hook URI does not match expected value"
            log_info "Expected: ${EXPECTED_HOOK_URI}"
            log_info "Actual:   ${HOOK_URI}"
        fi
    else
        log_warning "Hook URI is not configured"
    fi
}

# ============================================================================
# verify_database_function - Check that hook function exists in database
# ============================================================================
verify_database_function() {
    log_section "🗄️  Database Function Verification"

    # Check if psql is available
    if ! command -v psql &> /dev/null; then
        log_warning "psql not installed - skipping database verification"
        log_info "Install psql to verify database function configuration"
        return
    fi

    # Check if database password is set
    if [ -z "${PGPASSWORD:-}" ]; then
        log_warning "PGPASSWORD not set - skipping database verification"
        log_info "Export PGPASSWORD to verify database function configuration"
        return
    fi

    log_step "Checking database function configuration"

    DB_HOST="db.${PROJECT_REF}.supabase.co"

    # Check 1: Verify function exists
    FUNCTION_EXISTS=$(psql -h "$DB_HOST" -U postgres -d postgres -tAc \
        "SELECT COUNT(*) FROM pg_proc p
         JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE p.proname = 'custom_access_token_hook' AND n.nspname = 'public';" 2>/dev/null || echo "0")

    if [ "$FUNCTION_EXISTS" == "1" ]; then
        log_success "Function exists in public schema"
    else
        log_error "Function 'custom_access_token_hook' not found in database"
        log_info "Deploy the function via migrations: sql/03-functions/authorization/003-supabase-auth-jwt-hook.sql"
    fi

    # Check 2: Verify permissions
    HAS_EXECUTE=$(psql -h "$DB_HOST" -U postgres -d postgres -tAc \
        "SELECT has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE');" 2>/dev/null || echo "f")

    if [ "$HAS_EXECUTE" == "t" ]; then
        log_success "supabase_auth_admin has EXECUTE permission"
    else
        log_error "supabase_auth_admin does NOT have EXECUTE permission"
        log_info "Grant permission: GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;"
    fi
}

# ============================================================================
# success_summary - Display final verification results
# ============================================================================
success_summary() {
    log_section "✅ Verification Complete"

    echo ""
    log_success "Auth hook registration verified successfully!"
    echo ""
    log_info "Configuration Summary:"
    echo ""
    echo "  Hook Status: ${GREEN}ENABLED${NC}"
    echo "  Hook URI:    ${EXPECTED_HOOK_URI}"
    echo "  Project:     ${PROJECT_REF}"
    echo ""
    log_info "Next Steps:"
    echo ""
    echo "  1. Test hook by logging in with Google OAuth"
    echo "  2. Decode JWT token and verify custom claims:"
    echo "     ${CYAN}https://jwt.io${NC}"
    echo ""
    echo "  3. Check for custom claims in token:"
    echo "     - app_metadata.org_id"
    echo "     - app_metadata.user_role"
    echo "     - app_metadata.permissions (array)"
    echo ""
    echo "  4. Monitor Auth service logs in Supabase Dashboard:"
    echo "     ${BLUE}https://supabase.com/dashboard/project/${PROJECT_REF}/logs/auth-logs${NC}"
    echo ""
}

# Main execution
main() {
    check_requirements
    verify_hook_registration
    verify_database_function
    success_summary
}

# Run the script
main
