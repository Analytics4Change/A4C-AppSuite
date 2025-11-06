#!/bin/bash
set -euo pipefail

# Configure Google OAuth provider via Supabase Management API
# Requires: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET

echo "🔧 Configuring Google OAuth provider..."

# Validate required environment variables
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "❌ Error: SUPABASE_ACCESS_TOKEN is not set"
  exit 1
fi

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "❌ Error: SUPABASE_PROJECT_REF is not set"
  exit 1
fi

if [ -z "${GOOGLE_OAUTH_CLIENT_ID:-}" ]; then
  echo "❌ Error: GOOGLE_OAUTH_CLIENT_ID is not set"
  exit 1
fi

if [ -z "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]; then
  echo "❌ Error: GOOGLE_OAUTH_CLIENT_SECRET is not set"
  exit 1
fi

# Supabase Management API endpoint
API_URL="https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/config/auth"

# Create JSON payload
PAYLOAD=$(cat <<EOF
{
  "external_google_enabled": true,
  "external_google_client_id": "${GOOGLE_OAUTH_CLIENT_ID}",
  "external_google_secret": "${GOOGLE_OAUTH_CLIENT_SECRET}"
}
EOF
)

# Make API request
echo "📡 Sending configuration to Supabase Management API..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$API_URL" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

# Extract HTTP status code (last line)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
# Extract response body (all but last line)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" -eq 200 ] || [ "$HTTP_CODE" -eq 201 ]; then
  echo "✅ Google OAuth configured successfully!"
  echo "   Client ID: ${GOOGLE_OAUTH_CLIENT_ID}"
  echo "   Provider: Enabled"
else
  echo "❌ Failed to configure Google OAuth"
  echo "   HTTP Status: $HTTP_CODE"
  echo "   Response: $BODY"
  exit 1
fi

echo ""
echo "🎉 Configuration complete!"
echo "   Users can now sign in with 'Sign in with Google'"
