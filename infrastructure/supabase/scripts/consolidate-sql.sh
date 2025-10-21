#!/bin/bash
# Consolidate all SQL files into a single deployment script
# Files are ordered by directory prefix (00-, 01-, 02-, etc.) and then by filename

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_DIR="$SCRIPT_DIR/../sql"
OUTPUT_FILE="$SCRIPT_DIR/../DEPLOY_TO_SUPABASE_STUDIO.sql"

echo "Consolidating SQL files..."
echo "SQL Directory: $SQL_DIR"
echo "Output File: $OUTPUT_FILE"
echo ""

# Create output file with header
cat > "$OUTPUT_FILE" <<'EOF'
-- ============================================================================
-- CONSOLIDATED DEPLOYMENT SCRIPT FOR SUPABASE
-- ============================================================================
--
-- This file contains all SQL migration scripts consolidated into a single file
-- for deployment via Supabase Studio SQL Editor.
--
-- IMPORTANT: This script must be run in a transaction to ensure atomicity.
--
-- Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
--
-- Deployment Order:
-- 1. Extensions (00-extensions/)
-- 2. Event Sourcing Infrastructure (01-events/)
-- 3. Tables and Projections (02-tables/)
-- 4. Functions (03-functions/)
-- 5. Triggers (04-triggers/)
-- 6. Views (05-views/)
-- 7. Row Level Security (06-rls/)
-- 8. Seed Data (99-seeds/)
--
-- ============================================================================

BEGIN;

EOF

# Function to process SQL files in a directory
process_directory() {
  local dir=$1
  local dir_name=$(basename "$dir")

  echo "Processing directory: $dir_name" >&2

  # Add directory header to output
  cat >> "$OUTPUT_FILE" <<EOF

-- ============================================================================
-- $dir_name
-- ============================================================================

EOF

  # Find all .sql files in the directory, sort them, and append to output
  find "$dir" -maxdepth 1 -name "*.sql" -type f | sort | while read -r file; do
    local filename=$(basename "$file")
    echo "  Adding: $filename" >&2

    cat >> "$OUTPUT_FILE" <<EOF

-- ----------------------------------------------------------------------------
-- File: $dir_name/$filename
-- ----------------------------------------------------------------------------

EOF
    cat "$file" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"
  done

  # If directory has subdirectories, recurse into them
  find "$dir" -mindepth 1 -maxdepth 1 -type d | sort | while read -r subdir; do
    process_directory "$subdir"
  done
}

# Process directories in order
for dir in $(find "$SQL_DIR" -mindepth 1 -maxdepth 1 -type d | grep -E "^$SQL_DIR/[0-9]+" | sort); do
  process_directory "$dir"
done

# Add transaction commit
cat >> "$OUTPUT_FILE" <<'EOF'

-- ============================================================================
-- END OF DEPLOYMENT SCRIPT
-- ============================================================================

COMMIT;

-- Verify deployment
SELECT 'Deployment completed successfully!' AS status;
EOF

echo ""
echo "Consolidation complete!"
echo "Output written to: $OUTPUT_FILE"
echo ""
echo "Total lines: $(wc -l < "$OUTPUT_FILE")"
