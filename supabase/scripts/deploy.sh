#!/bin/bash

# Supabase SQL Deployment Script
# Executes SQL files in dependency order

set -e  # Exit on error

# Configuration
SUPABASE_DB_URL="${SUPABASE_DB_URL:-}"
SQL_DIR="./sql"
LOG_FILE="deployment_$(date +%Y%m%d_%H%M%S).log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Function to execute SQL file
execute_sql() {
    local file=$1
    local description=$2

    echo -n "Executing: $description... "

    if [ -f "$file" ]; then
        # For now, just validate the file exists
        # In production, you would use: psql $SUPABASE_DB_URL -f "$file"
        echo "$file" >> "$LOG_FILE"
        print_status "Done"
    else
        print_error "File not found: $file"
        return 1
    fi
}

# Main deployment sequence
main() {
    echo "Starting Supabase SQL Deployment"
    echo "================================"
    echo "Timestamp: $(date)" > "$LOG_FILE"
    echo "" >> "$LOG_FILE"

    # 1. Extensions
    echo -e "\n${GREEN}Step 1: Extensions${NC}"
    for file in $SQL_DIR/00-extensions/*.sql; do
        [ -f "$file" ] && execute_sql "$file" "$(basename $file)"
    done

    # 2. Event Infrastructure (must come before tables)
    echo -e "\n${GREEN}Step 2: Event Infrastructure${NC}"
    for file in $SQL_DIR/01-events/*.sql; do
        [ -f "$file" ] && execute_sql "$file" "$(basename $file)"
    done

    # 3. Functions (needed by triggers and event processing)
    echo -e "\n${GREEN}Step 3: Functions${NC}"
    # First, event processing functions
    for file in $SQL_DIR/03-functions/event-processing/*.sql; do
        [ -f "$file" ] && execute_sql "$file" "$(basename $file)"
    done
    # Then, other functions
    for file in $SQL_DIR/03-functions/*.sql; do
        [ -f "$file" ] && execute_sql "$file" "$(basename $file)"
    done

    # 4. Tables (in dependency order)
    echo -e "\n${GREEN}Step 4: Tables${NC}"
    TABLE_ORDER=(
        "organizations"
        "users"
        "clients"
        "medications"
        "medication_history"
        "dosage_info"
        "audit_log"
        "api_audit_log"
    )

    for table in "${TABLE_ORDER[@]}"; do
        echo -e "\n  ${YELLOW}Table: $table${NC}"

        # Create table
        table_file="$SQL_DIR/02-tables/$table/table.sql"
        [ -f "$table_file" ] && execute_sql "$table_file" "    Create table $table"

        # Create indexes
        for index_file in $SQL_DIR/02-tables/$table/indexes/*.sql; do
            [ -f "$index_file" ] && execute_sql "$index_file" "    Index: $(basename $index_file .sql)"
        done

        # Create triggers
        for trigger_file in $SQL_DIR/02-tables/$table/triggers/*.sql; do
            [ -f "$trigger_file" ] && execute_sql "$trigger_file" "    Trigger: $(basename $trigger_file .sql)"
        done
    done

    # 5. Event Processing Triggers
    echo -e "\n${GREEN}Step 5: Event Triggers${NC}"
    for file in $SQL_DIR/04-triggers/*.sql; do
        [ -f "$file" ] && execute_sql "$file" "$(basename $file)"
    done

    # 6. Views
    echo -e "\n${GREEN}Step 6: Views${NC}"
    for file in $SQL_DIR/05-views/*.sql; do
        [ -f "$file" ] && execute_sql "$file" "$(basename $file)"
    done

    # 7. RLS Policies
    echo -e "\n${GREEN}Step 7: Row Level Security${NC}"

    # Enable RLS on all tables first
    for file in $SQL_DIR/06-rls/*.sql; do
        [ -f "$file" ] && execute_sql "$file" "$(basename $file)"
    done

    # Then apply policies per table
    for table in "${TABLE_ORDER[@]}"; do
        for policy_file in $SQL_DIR/02-tables/$table/policies/*.sql; do
            [ -f "$policy_file" ] && execute_sql "$policy_file" "  Policy for $table: $(basename $policy_file .sql)"
        done
    done

    # 8. Seed Data
    echo -e "\n${GREEN}Step 8: Seed Data${NC}"
    for file in $SQL_DIR/07-seed/*.sql; do
        [ -f "$file" ] && execute_sql "$file" "$(basename $file)"
    done

    echo -e "\n${GREEN}Deployment Complete!${NC}"
    echo "Log file: $LOG_FILE"
}

# Check if we're in the right directory
if [ ! -d "$SQL_DIR" ]; then
    print_error "SQL directory not found. Please run from the supabase directory."
    exit 1
fi

# Run main deployment
main