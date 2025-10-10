#!/bin/bash

# Zitadel Data Collection Script
# Run this to collect all Zitadel configuration data for inventory

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
ZITADEL_CLIENT_ID="${ZITADEL_CLIENT_ID:-a4c-service-user}"
ZITADEL_CLIENT_SECRET="${ZITADEL_CLIENT_SECRET:-Uz7M7a7sAWHDTO7N3Y1O4mlVX4fRGhoiWS2KsvE4Qn4NbHB66Ehlnt708g22zEbJ}"
ZITADEL_INSTANCE="${ZITADEL_INSTANCE:-analytics4change-zdswvg.us1.zitadel.cloud}"
ZITADEL_API_URL="https://${ZITADEL_INSTANCE}"
PROJECT_ID="339658577486583889"

# Output directory with timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_DIR="./zitadel-inventory-data-${TIMESTAMP}"
mkdir -p "${OUTPUT_DIR}"

echo -e "${GREEN}=== Zitadel Data Collection Script ===${NC}"
echo "Instance: ${ZITADEL_INSTANCE}"
echo "Project ID: ${PROJECT_ID}"
echo "Output: ${OUTPUT_DIR}"
echo ""

# Check for required tools
command -v curl >/dev/null 2>&1 || { echo -e "${RED}Error: curl is required but not installed.${NC}" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo -e "${RED}Error: jq is required but not installed.${NC}" >&2; exit 1; }

# Get access token
echo -e "${YELLOW}Authenticating with Zitadel...${NC}"
# Using Project Owner role - no need to specify granular scopes
TOKEN_RESPONSE=$(curl -s -X POST "https://${ZITADEL_INSTANCE}/oauth/v2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=${ZITADEL_CLIENT_ID}" \
  -d "client_secret=${ZITADEL_CLIENT_SECRET}" \
  -d "scope=openid profile email urn:zitadel:iam:org:project:id:zitadel:aud")

ACCESS_TOKEN=$(echo "${TOKEN_RESPONSE}" | jq -r '.access_token')
ERROR_MSG=$(echo "${TOKEN_RESPONSE}" | jq -r '.error_description // .error // ""')

if [ -z "${ACCESS_TOKEN}" ] || [ "${ACCESS_TOKEN}" == "null" ]; then
    echo -e "${RED}Failed to obtain access token${NC}"
    if [ -n "${ERROR_MSG}" ]; then
        echo -e "${RED}Error: ${ERROR_MSG}${NC}"
    fi
    echo "Response: ${TOKEN_RESPONSE}"
    exit 1
fi

echo -e "${GREEN}✓ Successfully authenticated${NC}"
echo "Access token: ${ACCESS_TOKEN:0:20}..."
echo ""

# Save token info
echo "${TOKEN_RESPONSE}" | jq '.' > "${OUTPUT_DIR}/token_response.json"

# Function to make API call and save response
api_call() {
    local endpoint=$1
    local output_file=$2
    local method=${3:-GET}
    local data=${4:-}
    local description=${5:-$endpoint}

    echo -n "Fetching ${description}... "

    if [ "${method}" == "POST" ]; then
        RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${ZITADEL_API_URL}${endpoint}" \
            -H "Authorization: Bearer ${ACCESS_TOKEN}" \
            -H "Content-Type: application/json" \
            -d "${data}")
    else
        RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${ZITADEL_API_URL}${endpoint}" \
            -H "Authorization: Bearer ${ACCESS_TOKEN}")
    fi

    HTTP_CODE=$(echo "${RESPONSE}" | tail -n1)
    BODY=$(echo "${RESPONSE}" | sed '$d')

    if [ "${HTTP_CODE}" -eq 200 ] || [ "${HTTP_CODE}" -eq 201 ]; then
        echo "${BODY}" | jq '.' > "${OUTPUT_DIR}/${output_file}"
        echo -e "${GREEN}✓${NC} (${output_file})"
        return 0
    else
        echo -e "${RED}✗${NC} (HTTP ${HTTP_CODE})"
        echo "${BODY}" | jq '.' > "${OUTPUT_DIR}/${output_file}.error" 2>/dev/null || echo "${BODY}" > "${OUTPUT_DIR}/${output_file}.error"
        return 1
    fi
}

# Collect data with error handling
echo -e "${YELLOW}Collecting Zitadel configuration data...${NC}"

# Core resources
api_call "/management/v1/orgs/me" "organization.json" "GET" "" "Organization details" || true
api_call "/management/v1/projects/${PROJECT_ID}" "project.json" "GET" "" "Project configuration" || true

# Applications
api_call "/management/v1/projects/${PROJECT_ID}/apps/_search" "applications.json" "POST" '{"limit": 100}' "Applications" || true

# Roles
api_call "/management/v1/projects/${PROJECT_ID}/roles/_search" "roles.json" "POST" '{"limit": 100}' "Project roles" || true

# Users
api_call "/management/v1/users/_search" "users.json" "POST" '{"limit": 100, "queries": []}' "Users" || true

# User grants
api_call "/management/v1/users/grants/_search" "user_grants.json" "POST" '{"limit": 100}' "User grants" || true

# Specific user grant for lars.tice@gmail.com
api_call "/management/v1/users/339658157368929074/grants/_search" "lars_user_grants.json" "POST" '{}' "Lars user grants" || true

# Policies
api_call "/management/v1/policies/login" "login_policy.json" "GET" "" "Login policy" || true
api_call "/management/v1/policies/password/complexity" "password_policy.json" "GET" "" "Password policy" || true
api_call "/management/v1/policies/privacy" "privacy_policy.json" "GET" "" "Privacy policy" || true
api_call "/management/v1/policies/label" "label_policy.json" "GET" "" "Label policy" || true

# Actions and flows
api_call "/management/v1/actions/_search" "actions.json" "POST" '{"limit": 100}' "Actions" || true
api_call "/management/v1/flows" "flows.json" "GET" "" "Flows" || true

# Identity providers
api_call "/management/v1/idps/_search" "identity_providers.json" "POST" '{"limit": 100}' "Identity providers" || true

# Instance features
api_call "/management/v1/instance/features" "instance_features.json" "GET" "" "Instance features" || true

# Metadata
api_call "/management/v1/orgs/metadata/_search" "org_metadata.json" "POST" '{"limit": 100}' "Organization metadata" || true

echo ""
echo -e "${YELLOW}Generating summary report...${NC}"

# Create summary report
cat > "${OUTPUT_DIR}/SUMMARY.md" << EOF
# Zitadel Data Collection Summary
**Generated**: $(date)
**Instance**: ${ZITADEL_INSTANCE}
**Project ID**: ${PROJECT_ID}

## Files Collected

| File | Description | Status |
|------|-------------|--------|
EOF

for file in "${OUTPUT_DIR}"/*.json; do
    if [ -f "$file" ]; then
        basename=$(basename "$file")
        if [[ ! "$basename" =~ \.error$ ]]; then
            size=$(du -h "$file" | cut -f1)
            if [ -f "${file}.error" ]; then
                echo "| ${basename} | Error - see ${basename}.error | ❌ |" >> "${OUTPUT_DIR}/SUMMARY.md"
            else
                echo "| ${basename} | ${size} | ✅ |" >> "${OUTPUT_DIR}/SUMMARY.md"
            fi
        fi
    fi
done

# Extract key information if available
echo "" >> "${OUTPUT_DIR}/SUMMARY.md"
echo "## Key Information Extracted" >> "${OUTPUT_DIR}/SUMMARY.md"

if [ -f "${OUTPUT_DIR}/organization.json" ] && [ ! -f "${OUTPUT_DIR}/organization.json.error" ]; then
    ORG_ID=$(jq -r '.org.id // "N/A"' "${OUTPUT_DIR}/organization.json")
    ORG_NAME=$(jq -r '.org.name // "N/A"' "${OUTPUT_DIR}/organization.json")
    echo "- **Organization ID**: ${ORG_ID}" >> "${OUTPUT_DIR}/SUMMARY.md"
    echo "- **Organization Name**: ${ORG_NAME}" >> "${OUTPUT_DIR}/SUMMARY.md"
fi

if [ -f "${OUTPUT_DIR}/project.json" ] && [ ! -f "${OUTPUT_DIR}/project.json.error" ]; then
    PROJECT_NAME=$(jq -r '.project.name // "N/A"' "${OUTPUT_DIR}/project.json")
    echo "- **Project Name**: ${PROJECT_NAME}" >> "${OUTPUT_DIR}/SUMMARY.md"
fi

if [ -f "${OUTPUT_DIR}/applications.json" ] && [ ! -f "${OUTPUT_DIR}/applications.json.error" ]; then
    APP_COUNT=$(jq '.result | length' "${OUTPUT_DIR}/applications.json")
    echo "- **Applications Count**: ${APP_COUNT}" >> "${OUTPUT_DIR}/SUMMARY.md"
fi

if [ -f "${OUTPUT_DIR}/roles.json" ] && [ ! -f "${OUTPUT_DIR}/roles.json.error" ]; then
    ROLE_COUNT=$(jq '.result | length' "${OUTPUT_DIR}/roles.json")
    echo "- **Roles Count**: ${ROLE_COUNT}" >> "${OUTPUT_DIR}/SUMMARY.md"
    echo "" >> "${OUTPUT_DIR}/SUMMARY.md"
    echo "### Roles List:" >> "${OUTPUT_DIR}/SUMMARY.md"
    jq -r '.result[]? | "- \(.key): \(.display_name)"' "${OUTPUT_DIR}/roles.json" >> "${OUTPUT_DIR}/SUMMARY.md" 2>/dev/null || echo "Error parsing roles" >> "${OUTPUT_DIR}/SUMMARY.md"
fi

if [ -f "${OUTPUT_DIR}/users.json" ] && [ ! -f "${OUTPUT_DIR}/users.json.error" ]; then
    USER_COUNT=$(jq '.result | length' "${OUTPUT_DIR}/users.json")
    echo "" >> "${OUTPUT_DIR}/SUMMARY.md"
    echo "- **Users Count**: ${USER_COUNT}" >> "${OUTPUT_DIR}/SUMMARY.md"
fi

echo "" >> "${OUTPUT_DIR}/SUMMARY.md"
echo "## Next Steps" >> "${OUTPUT_DIR}/SUMMARY.md"
echo "1. Review the collected JSON files for completeness" >> "${OUTPUT_DIR}/SUMMARY.md"
echo "2. Check any .error files for failed API calls" >> "${OUTPUT_DIR}/SUMMARY.md"
echo "3. Update ZITADEL-INVENTORY.md with the collected data" >> "${OUTPUT_DIR}/SUMMARY.md"
echo "4. Verify sensitive information before committing" >> "${OUTPUT_DIR}/SUMMARY.md"

# Display summary
echo ""
echo -e "${GREEN}=== Data Collection Complete ===${NC}"
echo "Files saved in: ${OUTPUT_DIR}"
echo ""

# Display quick summary
if [ -f "${OUTPUT_DIR}/SUMMARY.md" ]; then
    echo "Quick Summary:"
    grep -A 20 "## Key Information" "${OUTPUT_DIR}/SUMMARY.md" | head -20
fi

echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Review files in: ${OUTPUT_DIR}"
echo "2. Check SUMMARY.md for overview"
echo "3. Update ZITADEL-INVENTORY.md with collected data"
echo "4. Run manual verification in Zitadel console if needed"

# Check for errors
if ls "${OUTPUT_DIR}"/*.error 1> /dev/null 2>&1; then
    echo ""
    echo -e "${RED}⚠️  Some API calls failed. Check .error files for details.${NC}"
    echo "This might indicate missing permissions for the service user."
fi