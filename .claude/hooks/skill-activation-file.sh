#!/usr/bin/env bash
set -e

# Post-tool-use hook for file-based skill activation
# Suggests skills when editing files that match skill trigger patterns
# Runs after Edit, MultiEdit, or Write tools

cd "$CLAUDE_PROJECT_DIR/.claude/hooks"
cat | npx tsx skill-activation-file.ts
