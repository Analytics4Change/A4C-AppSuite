#!/bin/bash
#
# Google OAuth URL Generation Test
#
# This script generates a Google OAuth URL that you can test in your browser
#
# Usage:
#   ./test-oauth-url.sh
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Configuration
PROJECT_REF="${SUPABASE_PROJECT_REF:-tmrjlswbsxmbglmaclxu}"
SUPABASE_URL="https://${PROJECT_REF}.supabase.co"
REDIRECT_URI="${SUPABASE_URL}/auth/v1/callback"

# Helper functions
log_section() {
    echo ""
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${CYAN}$1${NC}"
    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

log_info() {
    echo -e "${NC}$1${NC}"
}

log_warning() {
    echo -e "${YELLOW}$1${NC}"
}

main() {
    log_section "🧪 Google OAuth URL Test"

    echo ""
    log_info "Project: ${PROJECT_REF}"
    log_info "Supabase URL: ${SUPABASE_URL}"
    log_info "Redirect URI: ${REDIRECT_URI}"

    log_section "📌 Google OAuth Authorization URL"

    # Generate the OAuth URL manually
    # This is what Supabase's signInWithOAuth would generate
    OAUTH_URL="${SUPABASE_URL}/auth/v1/authorize?provider=google"

    echo ""
    log_success "Generated OAuth URL:"
    echo ""
    echo -e "${CYAN}${OAUTH_URL}${NC}"
    echo ""

    log_section "🧪 Testing Instructions"

    echo ""
    log_warning "MANUAL TEST STEPS:"
    echo ""
    echo "1. ${BOLD}Copy the URL above${NC}"
    echo ""
    echo "2. ${BOLD}Open it in your browser${NC}"
    echo "   Quick command (macOS):"
    echo -e "   ${CYAN}open \"${OAUTH_URL}\"${NC}"
    echo ""
    echo "   Or (Linux):"
    echo -e "   ${CYAN}xdg-open \"${OAUTH_URL}\"${NC}"
    echo ""
    echo "3. ${BOLD}Complete Google OAuth flow${NC}"
    echo "   - Select your Google account"
    echo "   - Grant permissions"
    echo ""
    echo "4. ${BOLD}Verify successful redirect${NC}"
    echo "   - Should redirect to: ${REDIRECT_URI}"
    echo "   - Should complete without errors"
    echo ""
    echo "5. ${BOLD}Check Supabase Dashboard${NC}"
    echo "   - Go to: Authentication → Users"
    echo "   - Verify your user was created"
    echo -e "   - URL: ${BLUE}https://supabase.com/dashboard/project/${PROJECT_REF}/auth/users${NC}"
    echo ""

    log_section "✅ Expected Results"

    echo ""
    log_success "If configuration is correct:"
    echo ""
    echo "  ✓ Google OAuth consent screen appears"
    echo "  ✓ You can select your Google account"
    echo "  ✓ You grant permissions successfully"
    echo "  ✓ Browser redirects back to Supabase"
    echo "  ✓ Your user appears in Supabase Auth Users"
    echo ""

    log_section "❌ Troubleshooting"

    echo ""
    echo "${YELLOW}If you see errors:${NC}"
    echo ""
    echo "  ${RED}\"redirect_uri_mismatch\"${NC}"
    echo "    → Check Google Cloud Console → OAuth redirect URIs"
    echo "    → Must include: ${REDIRECT_URI}"
    echo ""
    echo "  ${RED}\"OAuth 2.0 policy\"${NC}"
    echo "    → Verify redirect URI is exactly: ${REDIRECT_URI}"
    echo "    → Check OAuth consent screen configuration"
    echo "    → Verify application type is \"Web application\""
    echo ""
    echo "  ${RED}\"unauthorized_client\"${NC}"
    echo "    → Check Supabase Dashboard → Google provider is enabled"
    echo "    → Verify Client ID and Secret are correct"
    echo ""

    log_section "🎯 Quick Start"

    echo ""
    echo "Run this command to open the OAuth URL in your browser:"
    echo ""
    echo -e "${BOLD}${GREEN}open \"${OAUTH_URL}\"${NC}"
    echo ""
}

# Run the script
main
