#!/usr/bin/env bash

##############################################################################
# SQL Migration Idempotency Audit Script
#
# Checks all SQL migration files for idempotency issues
#
# Usage:
#   ./audit-idempotency.sh
#
# Output:
#   - Report of idempotency issues found
#   - Suggested fixes
#   - Files that need manual review
##############################################################################

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
TOTAL_FILES=0
FILES_WITH_ISSUES=0
FILES_OK=0
ISSUES_FOUND=0

# Output file
REPORT_FILE="/tmp/sql-idempotency-audit.md"

##############################################################################
# Helper Functions
##############################################################################

print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_issue() {
    echo -e "${RED}❌ ISSUE:${NC} $1"
    ((ISSUES_FOUND++))
}

print_ok() {
    echo -e "${GREEN}✅ OK:${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠️  WARNING:${NC} $1"
}

##############################################################################
# Audit Functions
##############################################################################

audit_file() {
    local file="$1"
    local basename=$(basename "$file")
    local dirname=$(dirname "$file" | sed "s|.*/supabase/sql/||")
    local has_issues=false

    echo "" >> "$REPORT_FILE"
    echo "### $dirname/$basename" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"

    # Read file content
    local content=$(cat "$file")

    # Check 1: CREATE TABLE without IF NOT EXISTS
    if echo "$content" | grep -i "CREATE TABLE" | grep -qiv "IF NOT EXISTS"; then
        print_issue "$dirname/$basename: CREATE TABLE without IF NOT EXISTS"
        echo "- ❌ **CREATE TABLE** without **IF NOT EXISTS**" >> "$REPORT_FILE"
        echo "  \`\`\`sql" >> "$REPORT_FILE"
        echo "$content" | grep -i "CREATE TABLE" | grep -iv "IF NOT EXISTS" | head -1 >> "$REPORT_FILE"
        echo "  \`\`\`" >> "$REPORT_FILE"
        echo "  **Fix:** Add \`IF NOT EXISTS\`" >> "$REPORT_FILE"
        echo "" >> "$REPORT_FILE"
        has_issues=true
    fi

    # Check 2: CREATE INDEX without IF NOT EXISTS
    if echo "$content" | grep -i "CREATE.*INDEX" | grep -qiv "IF NOT EXISTS"; then
        print_issue "$dirname/$basename: CREATE INDEX without IF NOT EXISTS"
        echo "- ❌ **CREATE INDEX** without **IF NOT EXISTS**" >> "$REPORT_FILE"
        echo "  \`\`\`sql" >> "$REPORT_FILE"
        echo "$content" | grep -i "CREATE.*INDEX" | grep -iv "IF NOT EXISTS" | head -1 >> "$REPORT_FILE"
        echo "  \`\`\`" >> "$REPORT_FILE"
        echo "  **Fix:** Add \`IF NOT EXISTS\`" >> "$REPORT_FILE"
        echo "" >> "$REPORT_FILE"
        has_issues=true
    fi

    # Check 3: CREATE FUNCTION without OR REPLACE
    if echo "$content" | grep -i "CREATE FUNCTION" | grep -qiv "OR REPLACE"; then
        print_issue "$dirname/$basename: CREATE FUNCTION without OR REPLACE"
        echo "- ❌ **CREATE FUNCTION** without **OR REPLACE**" >> "$REPORT_FILE"
        echo "  \`\`\`sql" >> "$REPORT_FILE"
        echo "$content" | grep -i "CREATE FUNCTION" | grep -iv "OR REPLACE" | head -1 >> "$REPORT_FILE"
        echo "  \`\`\`" >> "$REPORT_FILE"
        echo "  **Fix:** Use \`CREATE OR REPLACE FUNCTION\`" >> "$REPORT_FILE"
        echo "" >> "$REPORT_FILE"
        has_issues=true
    fi

    # Check 4: CREATE TRIGGER without DROP IF EXISTS
    if echo "$content" | grep -qi "CREATE TRIGGER"; then
        if ! echo "$content" | grep -qi "DROP TRIGGER IF EXISTS"; then
            print_warning "$dirname/$basename: CREATE TRIGGER without DROP IF EXISTS"
            echo "- ⚠️  **CREATE TRIGGER** without **DROP TRIGGER IF EXISTS**" >> "$REPORT_FILE"
            echo "  \`\`\`sql" >> "$REPORT_FILE"
            echo "$content" | grep -i "CREATE TRIGGER" | head -1 >> "$REPORT_FILE"
            echo "  \`\`\`" >> "$REPORT_FILE"
            echo "  **Fix:** Add \`DROP TRIGGER IF EXISTS <trigger_name> ON <table>;\` before CREATE TRIGGER" >> "$REPORT_FILE"
            echo "" >> "$REPORT_FILE"
            has_issues=true
        fi
    fi

    # Check 5: CREATE TYPE without DROP IF EXISTS
    if echo "$content" | grep -qi "CREATE TYPE"; then
        if ! echo "$content" | grep -qi "DROP TYPE IF EXISTS"; then
            print_warning "$dirname/$basename: CREATE TYPE without DROP TYPE IF EXISTS"
            echo "- ⚠️  **CREATE TYPE** without **DROP TYPE IF EXISTS**" >> "$REPORT_FILE"
            echo "  \`\`\`sql" >> "$REPORT_FILE"
            echo "$content" | grep -i "CREATE TYPE" | head -1 >> "$REPORT_FILE"
            echo "  \`\`\`" >> "$REPORT_FILE"
            echo "  **Fix:** Add \`DROP TYPE IF EXISTS <type_name> CASCADE;\` before CREATE TYPE" >> "$REPORT_FILE"
            echo "" >> "$REPORT_FILE"
            has_issues=true
        fi
    fi

    # Check 6: ALTER TABLE statements (need manual review)
    if echo "$content" | grep -qi "ALTER TABLE"; then
        print_warning "$dirname/$basename: Contains ALTER TABLE (needs manual review)"
        echo "- ⚠️  **ALTER TABLE** detected - **MANUAL REVIEW REQUIRED**" >> "$REPORT_FILE"
        echo "  \`\`\`sql" >> "$REPORT_FILE"
        echo "$content" | grep -i "ALTER TABLE" | head -3 >> "$REPORT_FILE"
        echo "  \`\`\`" >> "$REPORT_FILE"
        echo "  **Action:** Ensure ALTER operations are idempotent (check column/constraint exists before adding)" >> "$REPORT_FILE"
        echo "" >> "$REPORT_FILE"
        has_issues=true
    fi

    # Check 7: INSERT statements without ON CONFLICT (in seed files)
    if [[ "$dirname" == *"seeds"* ]]; then
        if echo "$content" | grep -qi "INSERT INTO"; then
            if ! echo "$content" | grep -qi "ON CONFLICT"; then
                print_warning "$dirname/$basename: INSERT without ON CONFLICT in seed file"
                echo "- ⚠️  **INSERT** without **ON CONFLICT** in seed file" >> "$REPORT_FILE"
                echo "  \`\`\`sql" >> "$REPORT_FILE"
                echo "$content" | grep -i "INSERT INTO" | head -1 >> "$REPORT_FILE"
                echo "  \`\`\`" >> "$REPORT_FILE"
                echo "  **Fix:** Add \`ON CONFLICT DO NOTHING\` or \`ON CONFLICT (...) DO UPDATE\`" >> "$REPORT_FILE"
                echo "" >> "$REPORT_FILE"
                has_issues=true
            fi
        fi
    fi

    # Check 8: EXTENSION without IF NOT EXISTS
    if echo "$content" | grep -i "CREATE EXTENSION" | grep -qiv "IF NOT EXISTS"; then
        print_issue "$dirname/$basename: CREATE EXTENSION without IF NOT EXISTS"
        echo "- ❌ **CREATE EXTENSION** without **IF NOT EXISTS**" >> "$REPORT_FILE"
        echo "  \`\`\`sql" >> "$REPORT_FILE"
        echo "$content" | grep -i "CREATE EXTENSION" | grep -iv "IF NOT EXISTS" | head -1 >> "$REPORT_FILE"
        echo "  \`\`\`" >> "$REPORT_FILE"
        echo "  **Fix:** Add \`IF NOT EXISTS\`" >> "$REPORT_FILE"
        echo "" >> "$REPORT_FILE"
        has_issues=true
    fi

    # Update counters
    if [ "$has_issues" = true ]; then
        ((FILES_WITH_ISSUES++))
    else
        print_ok "$dirname/$basename"
        echo "- ✅ **No idempotency issues detected**" >> "$REPORT_FILE"
        echo "" >> "$REPORT_FILE"
        ((FILES_OK++))
    fi
}

##############################################################################
# Main Execution
##############################################################################

main() {
    print_header "🔍 SQL Migration Idempotency Audit"

    # Initialize report
    echo "# SQL Migration Idempotency Audit Report" > "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    echo "**Generated:** $(date)" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    echo "## Summary" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"

    # Find and audit all SQL files
    echo "Scanning SQL files..."
    echo ""

    while IFS= read -r file; do
        ((TOTAL_FILES++))
        audit_file "$file"
    done < <(find /home/lars/dev/A4C-AppSuite/infrastructure/supabase/sql -type f -name "*.sql" | sort)

    # Write summary to report
    sed -i "5a- **Total files:** $TOTAL_FILES" "$REPORT_FILE"
    sed -i "6a- **Files with issues:** $FILES_WITH_ISSUES" "$REPORT_FILE"
    sed -i "7a- **Files OK:** $FILES_OK" "$REPORT_FILE"
    sed -i "8a- **Total issues:** $ISSUES_FOUND" "$REPORT_FILE"
    sed -i "9a\n## Detailed Findings" "$REPORT_FILE"

    # Print summary
    echo ""
    print_header "📊 Audit Summary"
    echo "Total files scanned: $TOTAL_FILES"
    echo -e "Files with issues: ${RED}$FILES_WITH_ISSUES${NC}"
    echo -e "Files OK: ${GREEN}$FILES_OK${NC}"
    echo -e "Total issues found: ${RED}$ISSUES_FOUND${NC}"
    echo ""
    echo "Full report written to: $REPORT_FILE"
    echo ""

    if [ $FILES_WITH_ISSUES -gt 0 ]; then
        echo -e "${YELLOW}⚠️  Action required:${NC}"
        echo "1. Review the detailed report: $REPORT_FILE"
        echo "2. Fix idempotency issues in affected files"
        echo "3. Re-run this audit to verify fixes"
        echo ""
        echo "Common fixes:"
        echo "  - CREATE TABLE → CREATE TABLE IF NOT EXISTS"
        echo "  - CREATE INDEX → CREATE INDEX IF NOT EXISTS"
        echo "  - CREATE FUNCTION → CREATE OR REPLACE FUNCTION"
        echo "  - CREATE TRIGGER → Add DROP TRIGGER IF EXISTS first"
        echo "  - INSERT (seeds) → Add ON CONFLICT DO NOTHING"
        echo ""
        return 1
    else
        echo -e "${GREEN}✅ All files are idempotent!${NC}"
        echo ""
        return 0
    fi
}

main "$@"
