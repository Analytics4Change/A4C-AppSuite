#!/bin/bash
#
# Google OAuth Configuration Verification Script
#
# This script verifies the Google OAuth configuration via Supabase Management API.
# It's useful for debugging OAuth issues and confirming that Google OAuth is properly
# configured before attempting browser-based testing.
#
# What it checks:
#   - Google OAuth provider is enabled in Supabase
#   - OAuth Client ID is configured (displayed masked for security)
#   - Expected redirect URI for your project
#   - Additional auth settings (site URL, email/phone auth status)
#
# Usage:
#   ./verify-oauth-config.sh
#
# Environment Variables Required:
#   SUPABASE_ACCESS_TOKEN - Supabase Management API token (from Dashboard → Account → Access Tokens)
#   SUPABASE_PROJECT_REF - Your Supabase project reference (default: tmrjlswbsxmbglmaclxu)
#
# Exit Codes:
#   0 - Success: OAuth is configured correctly
#   1 - Failure: Missing dependencies, auth error, or OAuth not configured
#
# Example:
#   export SUPABASE_ACCESS_TOKEN="sbp_abc123..."
#   export SUPABASE_PROJECT_REF="yourproject"
#   ./verify-oauth-config.sh
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

# ============================================================================
# Helper Functions for Formatted Output
# ============================================================================
# These functions provide consistent, colored terminal output for better UX
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
# Checks:
#   1. jq is installed (required for JSON parsing)
#   2. curl is installed (required for API requests)
#   3. SUPABASE_ACCESS_TOKEN environment variable is set
#
# Returns: Exits with code 1 if any requirement is missing
check_requirements() {
    log_section "🔍 Checking Requirements"

    # Check for jq (JSON processor)
    # jq is required to parse the JSON response from Supabase Management API
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
# verify_oauth_config - Query and validate OAuth configuration
# ============================================================================
# This function:
#   1. Makes an authenticated request to Supabase Management API
#   2. Retrieves the auth configuration for the project
#   3. Validates that Google OAuth is enabled and properly configured
#   4. Displays the configuration details for verification
#
# API Endpoint: GET /v1/projects/{ref}/config/auth
# Documentation: https://supabase.com/docs/reference/api/introduction
#
# Returns: Exits with code 1 if OAuth is not configured correctly
verify_oauth_config() {
    log_section "🧪 Verifying Google OAuth Configuration"

    log_step "Fetching auth configuration from Supabase Management API"
    log_info "URL: ${API_URL}"

    # Make API request with Bearer token authentication
    # The -w flag adds HTTP status code to output (needed for error checking)
    # The -s flag silences progress output
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
        -H "Content-Type: application/json" \
        "${API_URL}")

    # Extract HTTP status code (last line) and response body (everything else)
    # This technique allows us to capture both the response and status code
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
    # Parse and display OAuth configuration details
    # ========================================================================
    log_section "📊 Configuration Status"

    # Check if Google OAuth is enabled
    # jq syntax: .external_google_enabled retrieves the field
    #            // false provides a default if field is missing/null
    #            -r outputs raw strings (no quotes)
    GOOGLE_ENABLED=$(echo "$BODY" | jq -r '.external_google_enabled // false')

    if [ "$GOOGLE_ENABLED" == "true" ]; then
        log_success "Google OAuth is ENABLED"
    else
        log_error "Google OAuth is DISABLED"
        echo ""
        log_warning "To enable Google OAuth:"
        echo "  1. Go to Supabase Dashboard → Authentication → Providers"
        echo "  2. Enable Google provider"
        echo "  3. Add your Google OAuth Client ID and Secret"
        echo "  OR"
        echo "  Run: ./configure-google-oauth.sh"
        exit 1
    fi

    # Check for Client ID (masked for security)
    # We mask the Client ID in output to avoid exposing sensitive credentials
    # even though the Client ID is technically public in OAuth flows
    CLIENT_ID=$(echo "$BODY" | jq -r '.external_google_client_id // ""')

    if [ -n "$CLIENT_ID" ] && [ "$CLIENT_ID" != "null" ]; then
        # Mask the client ID: show first 10 and last 10 characters only
        # Example: 12345678901234567890 → 1234567890...1234567890
        MASKED_ID="${CLIENT_ID:0:10}...${CLIENT_ID: -10}"
        log_success "Client ID is configured: ${MASKED_ID}"
    else
        log_warning "Client ID is not configured"
    fi

    # Check redirect URI
    # Supabase OAuth uses a standard redirect URI format:
    # https://{project-ref}.supabase.co/auth/v1/callback
    # This MUST be configured exactly in Google Cloud Console OAuth credentials
    REDIRECT_URI="https://${PROJECT_REF}.supabase.co/auth/v1/callback"
    log_info "Expected redirect URI: ${REDIRECT_URI}"

    # Check other auth settings
    log_step "Additional Auth Settings"

    SITE_URL=$(echo "$BODY" | jq -r '.site_url // ""')
    if [ -n "$SITE_URL" ] && [ "$SITE_URL" != "null" ]; then
        log_info "Site URL: ${SITE_URL}"
    fi

    EXTERNAL_EMAIL_ENABLED=$(echo "$BODY" | jq -r '.external_email_enabled // false')
    EXTERNAL_PHONE_ENABLED=$(echo "$BODY" | jq -r '.external_phone_enabled // false')

    log_info "Email auth: ${EXTERNAL_EMAIL_ENABLED}"
    log_info "Phone auth: ${EXTERNAL_PHONE_ENABLED}"

    # Success summary
    log_section "✅ Verification Complete"

    echo ""
    log_success "Google OAuth configuration verified successfully!"
    echo ""
    log_info "Next Steps:"
    echo ""
    echo "  1. Run the OAuth URL generation test:"
    echo "     ${CYAN}cd infrastructure/supabase/scripts${NC}"
    echo "     ${CYAN}node test-google-oauth.js${NC}"
    echo ""
    echo "  2. Test the OAuth flow in your browser"
    echo ""
    echo "  3. Verify user creation in Supabase Dashboard:"
    echo "     ${BLUE}https://supabase.com/dashboard/project/${PROJECT_REF}/auth/users${NC}"
    echo ""
}

# Main execution
main() {
    check_requirements
    verify_oauth_config
}

# Run the script
main
