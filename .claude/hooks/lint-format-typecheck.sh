#!/usr/bin/env bash
# PostToolUse hook: format, lint, and typecheck TypeScript files
# Runs after Edit, MultiEdit, or Write operations
# Exit 0 = success (silent), Exit 2 = error (stderr shown to Claude)

# Read JSON from stdin
input=$(cat)

# Extract file path from tool input
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# Exit silently if no file path
if [[ -z "$file_path" ]]; then
  exit 0
fi

# Only process .ts and .tsx files
if [[ ! "$file_path" =~ \.(tsx?)$ ]]; then
  exit 0
fi

# Skip declaration files
if [[ "$file_path" =~ \.d\.ts$ ]]; then
  exit 0
fi

# Skip generated files
if [[ "$file_path" =~ /generated/ ]]; then
  exit 0
fi

# Determine project root
project_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Determine which component this file belongs to
relative_path="${file_path#$project_dir/}"
component=$(echo "$relative_path" | cut -d'/' -f1)

# Set component directory and available tools
component_dir="$project_dir/$component"
has_prettier=false
has_eslint=false
has_tsc_files=false

case "$component" in
  frontend)
    [[ -x "$component_dir/node_modules/.bin/prettier" ]] && has_prettier=true
    [[ -x "$component_dir/node_modules/.bin/eslint" ]] && has_eslint=true
    [[ -x "$component_dir/node_modules/.bin/tsc-files" ]] && has_tsc_files=true
    ;;
  workflows)
    has_prettier=false
    [[ -x "$component_dir/node_modules/.bin/eslint" ]] && has_eslint=true
    [[ -x "$component_dir/node_modules/.bin/tsc-files" ]] && has_tsc_files=true
    ;;
  *)
    exit 0
    ;;
esac

# Verify component directory exists
if [[ ! -d "$component_dir" ]]; then
  exit 0
fi

# Collect errors across all steps
errors=""
had_failure=false

# Step 1: Format (Prettier --write)
if [[ "$has_prettier" == "true" ]]; then
  prettier_output=$( cd "$component_dir" && npx prettier --write "$file_path" 2>&1 ) || {
    errors+="[FORMATTING ERROR]"$'\n'"$prettier_output"$'\n\n'
    had_failure=true
  }
fi

# Step 2: Lint (ESLint --fix)
if [[ "$has_eslint" == "true" ]]; then
  eslint_output=$( cd "$component_dir" && npx eslint --fix "$file_path" 2>&1 ) || {
    errors+="[LINT ERROR]"$'\n'"$eslint_output"$'\n\n'
    had_failure=true
  }
fi

# Step 3: TypeCheck (tsc-files --noEmit)
if [[ "$has_tsc_files" == "true" ]]; then
  tsc_output=$( cd "$component_dir" && npx tsc-files --noEmit "$file_path" 2>&1 ) || {
    errors+="[TYPE ERROR]"$'\n'"$tsc_output"$'\n\n'
    had_failure=true
  }
fi

# Report results
if [[ "$had_failure" == "true" ]]; then
  echo "$errors" >&2
  exit 2
fi

exit 0
