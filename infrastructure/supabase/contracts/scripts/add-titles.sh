#!/bin/bash
# Add title property to all schemas that don't have one
# Uses sed for line-based editing to preserve YAML formatting

set -e

# Process a single YAML file
process_file() {
    local file="$1"
    echo "Processing: $file"

    # Find schemas that have 'type: object' but no 'title:' following the schema name
    # This is a multi-step process:
    # 1. Find lines that look like schema definitions (4 spaces + SchemaName:)
    # 2. Check if they have type: object
    # 3. Add title: SchemaName if missing

    # Use a temp file for safe editing
    local tmpfile=$(mktemp)

    # AWK script to add titles
    awk '
    /^    [A-Z][a-zA-Z0-9]*:$/ {
        # Found a potential schema definition line (4 spaces, PascalCase, colon)
        schema_name = $1
        gsub(/:$/, "", schema_name)
        print

        # Read next line to check if this is a schema (type: object) or message (name:)
        if ((getline next_line) > 0) {
            if (next_line ~ /^      type: object/) {
                # This is a schema - insert title before type: object
                print "      title: " schema_name
                print next_line
            } else {
                # Not a schema (probably a message) - just print as-is
                print next_line
            }
        }
        next
    }
    { print }
    ' "$file" > "$tmpfile"

    mv "$tmpfile" "$file"
}

# Process all domain files
for file in asyncapi/domains/*.yaml; do
    process_file "$file"
done

# Process components/schemas.yaml
process_file "asyncapi/components/schemas.yaml"

echo "Done! Run npm run generate:types to verify."
