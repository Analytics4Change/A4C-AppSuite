#!/bin/bash
#
# Fix User Role Script
# Adds OAuth-authenticated user to public.users and assigns super_admin role
#
# Usage:
#   ./fix-user-role.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔧 A4C AppSuite - Fix User Role${NC}"
echo ""

# Check if required environment variables are set
if [ -z "$SUPABASE_URL" ]; then
  echo -e "${YELLOW}⚠  SUPABASE_URL not set${NC}"
  echo "Please export SUPABASE_URL, for example:"
  echo "  export SUPABASE_URL=https://tmrjlswbsxmbglmaclxu.supabase.co"
  echo ""
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo -e "${YELLOW}⚠  SUPABASE_SERVICE_ROLE_KEY not set${NC}"
  echo "Please export SUPABASE_SERVICE_ROLE_KEY from Supabase Dashboard > Settings > API"
  echo ""
fi

# Extract project ref from URL
if [ -n "$SUPABASE_URL" ]; then
  PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://\([^.]*\).*|\1|')
  DB_HOST="db.${PROJECT_REF}.supabase.co"

  echo -e "${BLUE}📋 Connection Details:${NC}"
  echo "  Supabase URL: $SUPABASE_URL"
  echo "  Database Host: $DB_HOST"
  echo "  User: postgres"
  echo ""
fi

# Check for psql
if ! command -v psql &> /dev/null; then
  echo -e "${RED}✗ psql command not found${NC}"
  echo "Please install PostgreSQL client tools:"
  echo "  Ubuntu/Debian: sudo apt-get install postgresql-client"
  echo "  macOS: brew install postgresql"
  echo ""
  echo "Alternatively, copy the SQL from fix-user-role.sql and run it in Supabase SQL Editor:"
  echo "  https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new"
  exit 1
fi

# Prompt for confirmation
echo -e "${YELLOW}This script will:${NC}"
echo "  1. Query auth.users for lars.tice@gmail.com UUID"
echo "  2. Create user record in public.users if not exists"
echo "  3. Assign super_admin role to the user"
echo "  4. Show JWT claims preview"
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}Aborted.${NC}"
  exit 0
fi

# Set password for psql connection
export PGPASSWORD="$SUPABASE_SERVICE_ROLE_KEY"

# Run the SQL script
echo -e "${BLUE}🔧 Running SQL script...${NC}"
echo ""

if psql -h "$DB_HOST" -U postgres -d postgres -f "$(dirname "$0")/fix-user-role.sql"; then
  echo ""
  echo -e "${GREEN}✓ Script executed successfully!${NC}"
  echo ""
  echo -e "${BLUE}📋 Next Steps:${NC}"
  echo "  1. Log out of https://a4c.firstovertheline.com"
  echo "  2. Log back in via Google OAuth"
  echo "  3. Your new JWT will include super_admin role"
  echo "  4. Verify role appears correctly in the UI"
else
  echo ""
  echo -e "${RED}✗ Script execution failed${NC}"
  echo ""
  echo -e "${YELLOW}Troubleshooting:${NC}"
  echo "  - Check SUPABASE_SERVICE_ROLE_KEY is correct"
  echo "  - Verify network connectivity to Supabase"
  echo "  - Check Supabase project status in dashboard"
  echo "  - Try running the SQL manually in Supabase SQL Editor"
  exit 1
fi
