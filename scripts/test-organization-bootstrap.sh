#!/bin/bash
#
# Organization Bootstrap UAT Test Script
#
# Usage:
#   ./test-organization-bootstrap.sh
#
# Required environment variables:
#   AUTH_TOKEN - JWT token from authenticated session (copy from browser DevTools)
#
# Optional environment variables (with defaults):
#   SUBDOMAIN      - Organization subdomain (default: poc-test-YYYYMMDD)
#   ORG_NAME       - Organization name (default: "POC Test Organization")
#   ADMIN_EMAIL    - Provider admin email for invitation (default: your email)
#   ADMIN_FIRST    - Provider admin first name (default: "Test")
#   ADMIN_LAST     - Provider admin last name (default: "Admin")
#   API_URL        - Backend API URL (default: https://api-a4c.firstovertheline.com)
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check required environment variable
if [ -z "$AUTH_TOKEN" ]; then
    echo -e "${RED}ERROR: AUTH_TOKEN environment variable is required${NC}"
    echo ""
    echo "To get your auth token:"
    echo "  1. Log into https://a4c.firstovertheline.com as a super_admin"
    echo "  2. Open browser DevTools (F12) → Application tab → Local Storage"
    echo "  3. Find 'sb-tmrjlswbsxmbglmaclxu-auth-token' and copy the access_token value"
    echo ""
    echo "Then run:"
    echo "  export AUTH_TOKEN='eyJhbGciOiJIUzI1NiIs...'"
    echo "  ./test-organization-bootstrap.sh"
    exit 1
fi

# Configuration with defaults
DATE_SUFFIX=$(date +%Y%m%d)
SUBDOMAIN="${SUBDOMAIN:-poc-test-${DATE_SUFFIX}}"
ORG_NAME="${ORG_NAME:-POC Test Organization}"
ADMIN_EMAIL="${ADMIN_EMAIL:-lars@analytics4change.com}"
ADMIN_FIRST="${ADMIN_FIRST:-Test}"
ADMIN_LAST="${ADMIN_LAST:-Admin}"
API_URL="${API_URL:-https://api-a4c.firstovertheline.com}"

echo -e "${YELLOW}=== Organization Bootstrap UAT Test ===${NC}"
echo ""
echo "Configuration:"
echo "  API URL:      $API_URL"
echo "  Subdomain:    $SUBDOMAIN"
echo "  Org Name:     $ORG_NAME"
echo "  Admin Email:  $ADMIN_EMAIL"
echo "  Admin Name:   $ADMIN_FIRST $ADMIN_LAST"
echo ""

# Build the JSON payload
read -r -d '' PAYLOAD << EOF || true
{
  "subdomain": "${SUBDOMAIN}",
  "orgData": {
    "name": "${ORG_NAME}",
    "type": "provider",
    "contacts": [
      {
        "firstName": "${ADMIN_FIRST}",
        "lastName": "${ADMIN_LAST}",
        "email": "${ADMIN_EMAIL}",
        "title": "Provider Administrator",
        "department": "Administration",
        "type": "a4c_admin",
        "label": "Primary Admin Contact"
      }
    ],
    "addresses": [
      {
        "street1": "123 Test Street",
        "street2": "Suite 100",
        "city": "Test City",
        "state": "TX",
        "zipCode": "75001",
        "type": "physical",
        "label": "Main Office"
      }
    ],
    "phones": [
      {
        "number": "555-555-1234",
        "extension": "",
        "type": "office",
        "label": "Main Office"
      }
    ]
  },
  "users": [
    {
      "email": "${ADMIN_EMAIL}",
      "firstName": "${ADMIN_FIRST}",
      "lastName": "${ADMIN_LAST}",
      "role": "provider_admin"
    }
  ]
}
EOF

echo -e "${YELLOW}Sending request to API...${NC}"
echo ""

# Make the API call
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${API_URL}/api/v1/workflows/organization-bootstrap" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -d "${PAYLOAD}")

# Extract HTTP status code (last line)
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
# Extract response body (everything except last line)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}SUCCESS!${NC}"
    echo ""
    echo "Response:"
    echo "$BODY" | jq .

    # Extract values for follow-up
    WORKFLOW_ID=$(echo "$BODY" | jq -r '.workflowId')
    ORG_ID=$(echo "$BODY" | jq -r '.organizationId')

    echo ""
    echo -e "${YELLOW}=== Next Steps ===${NC}"
    echo ""
    echo "1. Check workflow status in Temporal UI:"
    echo "   https://temporal.firstovertheline.com/namespaces/default/workflows"
    echo ""
    echo "2. Check domain events in Supabase:"
    echo "   SELECT * FROM domain_events WHERE aggregate_id = '${ORG_ID}' ORDER BY created_at;"
    echo ""
    echo "3. Check organization projection:"
    echo "   SELECT * FROM organizations_projection WHERE id = '${ORG_ID}';"
    echo ""
    echo "4. Check DNS record (after workflow completes):"
    echo "   dig ${SUBDOMAIN}.firstovertheline.com CNAME"
    echo ""
    echo "5. Check invitation email at: ${ADMIN_EMAIL}"
    echo ""
else
    echo -e "${RED}FAILED!${NC}"
    echo ""
    echo "Response:"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
    echo ""

    if [ "$HTTP_CODE" = "401" ]; then
        echo -e "${YELLOW}Hint: Your AUTH_TOKEN may be expired. Get a fresh token from the browser.${NC}"
    elif [ "$HTTP_CODE" = "403" ]; then
        echo -e "${YELLOW}Hint: Your user may not have 'organization.create_root' permission.${NC}"
        echo "      Ensure you're logged in as a super_admin."
    fi

    exit 1
fi
