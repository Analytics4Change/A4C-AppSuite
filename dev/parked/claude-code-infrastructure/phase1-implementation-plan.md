# Phase 1 Implementation Plan: Core Infrastructure Setup

**Status**: Ready to execute
**Estimated Time**: 2 hours
**Date**: 2025-11-10

---

## Current State Analysis

### Existing Infrastructure ✅
- `.claude/` directory exists
- `.claude/commands/` directory exists (with dev-docs commands)
- `.claude/settings.local.json` exists (permissions configuration)
- Root `CLAUDE.md` is lean (1,226 words - excellent!)
- Component CLAUDE.md files exist:
  - `frontend/CLAUDE.md` (4,249 words - reasonable)
  - `temporal/CLAUDE.md` (2,076 words - good)
  - `infrastructure/CLAUDE.md` (2,044 words - good)

### What We Need to Add
- `.claude/hooks/` directory
- `.claude/skills/` directory
- Essential hooks (skill-activation-prompt, post-tool-use-tracker)
- `skill-rules.json` configuration
- Update `settings.local.json` with hook registrations

---

## Sub-Phase 1.1: Install Essential Hooks (45 minutes)

### Step 1: Create Hooks Directory
```bash
mkdir -p /home/lars/dev/A4C-AppSuite/.claude/hooks
cd /home/lars/dev/A4C-AppSuite/.claude/hooks
```

### Step 2: Install skill-activation-prompt Hook

**Files to create**:
1. `skill-activation-prompt.sh` (shell wrapper)
2. `skill-activation-prompt.ts` (TypeScript implementation)
3. `package.json` (for TypeScript dependencies)
4. `tsconfig.json` (TypeScript configuration)

**How it works**:
- Runs on **UserPromptSubmit** event (every prompt)
- Reads from `.claude/skills/skill-rules.json`
- Matches user prompts against keywords and intent patterns
- Suggests relevant skills automatically
- Groups suggestions by priority (critical/high/medium/low)

**Implementation**:
- Copy from `/tmp/showcase-temp/.claude/hooks/skill-activation-prompt.sh`
- Copy from `/tmp/showcase-temp/.claude/hooks/skill-activation-prompt.ts`
- Create minimal package.json with `tsx` dependency
- Make shell script executable: `chmod +x skill-activation-prompt.sh`

### Step 3: Install post-tool-use-tracker Hook

**Files to create**:
1. `post-tool-use-tracker.sh` (shell script)

**How it works**:
- Runs on **PostToolUse** event (after Edit/MultiEdit/Write tools)
- Tracks which files were modified in each session
- Detects repository context (frontend/temporal/infrastructure)
- Builds list of affected repos
- Stores build commands and TypeScript check commands
- Creates session cache in `.claude/tsc-cache/{session_id}/`

**Implementation**:
- Copy from `/tmp/showcase-temp/.claude/hooks/post-tool-use-tracker.sh`
- Customize `detect_repo()` function for A4C-AppSuite structure
- Make executable: `chmod +x post-tool-use-tracker.sh`

### Step 4: Install Dependencies

**Create package.json**:
```json
{
  "name": "a4c-claude-hooks",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "tsx": "^4.7.0"
  }
}
```

**Create tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true
  }
}
```

**Install**:
```bash
cd /home/lars/dev/A4C-AppSuite/.claude/hooks
npm install
```

---

## Sub-Phase 1.2: Create skill-rules.json (45 minutes)

### Step 1: Create Skills Directory
```bash
mkdir -p /home/lars/dev/A4C-AppSuite/.claude/skills
```

### Step 2: Design A4C-AppSuite Skill Rules

**skill-rules.json structure**:
```json
{
  "version": "1.0",
  "description": "Skill activation triggers for A4C-AppSuite monorepo",
  "skills": {
    "frontend-dev-guidelines": { ... },
    "temporal-workflow-guidelines": { ... },
    "infrastructure-guidelines": { ... }
  }
}
```

### Step 3: Frontend Skill Rule

**Triggers**:
- **Keywords**: component, react, ui, radix, tailwind, mobx, accessibility, wcag, form, button, input
- **Intent Patterns**:
  - `(create|add|make|build|update).*?(component|UI|page|form)`
  - `(style|design|layout).*?(component|UI)`
  - `(test|accessibility).*?(component|UI)`
- **File Patterns**: `frontend/src/**/*.{ts,tsx}`
- **Content Patterns**: `from 'react'`, `@radix-ui`, `observable`, `makeAutoObservable`

**Priority**: high
**Enforcement**: suggest

### Step 4: Temporal Skill Rule

**Triggers**:
- **Keywords**: workflow, activity, temporal, orchestration, event, saga, compensation, determinism
- **Intent Patterns**:
  - `(create|add|implement).*?(workflow|activity)`
  - `(fix|debug|handle).*?(workflow|temporal)`
  - `(emit|create|handle).*?(event|domain event)`
- **File Patterns**: `temporal/src/**/*.ts`
- **Content Patterns**: `proxyActivities`, `defineWorkflow`, `startChild`, `Temporal.`

**Priority**: high
**Enforcement**: suggest

### Step 5: Infrastructure Skill Rule

**Triggers**:
- **Keywords**: terraform, kubernetes, supabase, migration, rls, cqrs, projection, trigger, idempotent
- **Intent Patterns**:
  - `(create|add|write).*?(migration|table|policy)`
  - `(deploy|apply).*?(terraform|kubernetes)`
  - `(implement|update).*?(projection|trigger|cqrs)`
- **File Patterns**:
  - `infrastructure/terraform/**/*.tf`
  - `infrastructure/supabase/sql/**/*.sql`
  - `infrastructure/k8s/**/*.yaml`
- **Content Patterns**: `CREATE TABLE`, `CREATE POLICY`, `resource "`, `rls_`, `domain_events`

**Priority**: high
**Enforcement**: suggest

### Step 6: Create Complete skill-rules.json

Full implementation with all three skills, customized for A4C-AppSuite structure.

---

## Sub-Phase 1.3: Update settings.local.json (30 minutes)

### Step 1: Read Current Settings
```bash
cat /home/lars/dev/A4C-AppSuite/.claude/settings.local.json
```

### Step 2: Add Hook Registrations

**Current structure**: Contains only `permissions` section

**New structure**: Add `hooks` section

```json
{
  "permissions": {
    "allow": [ ... existing ... ],
    "deny": [],
    "ask": []
  },
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/skill-activation-prompt.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/post-tool-use-tracker.sh"
          }
        ]
      }
    ]
  }
}
```

### Step 3: Merge Configurations

Use Edit tool to add hooks section to existing settings.local.json without disrupting permissions.

---

## Sub-Phase 1.4: Customize post-tool-use-tracker for A4C-AppSuite (15 minutes)

### Customization Needed

The `detect_repo()` function needs to recognize A4C-AppSuite structure:

**Update function**:
```bash
detect_repo() {
    local file="$1"
    local project_root="$CLAUDE_PROJECT_DIR"
    local relative_path="${file#$project_root/}"
    local repo=$(echo "$relative_path" | cut -d'/' -f1)

    case "$repo" in
        # A4C-AppSuite structure
        frontend)
            echo "frontend"
            ;;
        temporal)
            echo "temporal"
            ;;
        infrastructure)
            echo "infrastructure"
            ;;
        *)
            if [[ ! "$relative_path" =~ / ]]; then
                echo "root"
            else
                echo "unknown"
            fi
            ;;
    esac
}
```

**Build commands**:
- Frontend: `cd frontend && npm run build`
- Temporal: `cd temporal && npm run build`
- Infrastructure: No build command (Terraform/SQL)

**TypeScript check commands**:
- Frontend: `cd frontend && npx tsc --noEmit`
- Temporal: `cd temporal && npx tsc --noEmit`

---

## Sub-Phase 1.5: Validation & Testing (15 minutes)

### Test 1: Verify Hook Installation
```bash
# Check files exist
ls -l /home/lars/dev/A4C-AppSuite/.claude/hooks/
ls -l /home/lars/dev/A4C-AppSuite/.claude/skills/

# Check executable permissions
ls -l /home/lars/dev/A4C-AppSuite/.claude/hooks/*.sh
```

### Test 2: Manual Hook Testing

**Test skill-activation-prompt**:
```bash
cd /home/lars/dev/A4C-AppSuite/.claude/hooks
echo '{"session_id":"test","prompt":"create a new react component","cwd":"/home/lars/dev/A4C-AppSuite/frontend"}' | ./skill-activation-prompt.sh
```

Expected output: Should suggest "frontend-dev-guidelines" skill

**Test post-tool-use-tracker**:
```bash
cd /home/lars/dev/A4C-AppSuite/.claude/hooks
echo '{"tool_name":"Edit","tool_input":{"file_path":"/home/lars/dev/A4C-AppSuite/frontend/src/App.tsx"},"session_id":"test"}' | ./post-tool-use-tracker.sh
```

Expected: Creates cache directory, logs edited file

### Test 3: Live Testing in Claude Code

1. Start new Claude Code session
2. Say: "I want to create a new React component"
   - Expected: skill-activation-prompt hook triggers and suggests frontend-dev-guidelines
3. Edit a file in `frontend/src/components/`
   - Expected: post-tool-use-tracker logs the edit
4. Check cache: `ls -la .claude/tsc-cache/*/`

### Test 4: Validate Configuration

```bash
# Validate JSON syntax
jq . /home/lars/dev/A4C-AppSuite/.claude/settings.local.json
jq . /home/lars/dev/A4C-AppSuite/.claude/skills/skill-rules.json
```

---

## Success Criteria

✅ All hook files installed and executable
✅ skill-rules.json created with A4C-specific triggers
✅ settings.local.json updated with hook registrations
✅ npm dependencies installed (tsx)
✅ Manual hook tests pass
✅ Live testing shows skill auto-activation
✅ post-tool-use-tracker creates cache files
✅ No JSON syntax errors

---

## Rollback Plan

If hooks cause issues:
1. Edit settings.local.json and remove `hooks` section
2. Restart Claude Code session
3. Hooks will not execute
4. Debug issues and re-enable

---

## Notes on CLAUDE.md Splitting (Phase 1.3 in original plan)

**Status**: ✅ Already complete!

The hierarchical CLAUDE.md structure is already in place:
- Root CLAUDE.md: 1,226 words (lean, monorepo overview)
- frontend/CLAUDE.md: 4,249 words (component-specific)
- temporal/CLAUDE.md: 2,076 words (component-specific)
- infrastructure/CLAUDE.md: 2,044 words (component-specific)

All files are under the 10k word target. No splitting work needed!

---

## Next Steps After Phase 1

After Phase 1 completes:
1. Validate auto-activation works consistently
2. Move to Phase 2: Create custom skills (frontend, temporal, infrastructure)
3. Each skill will be <500 lines with modular resources
4. Skills will activate automatically via the hooks we just installed

---

## File Checklist

**To Create**:
- [ ] `.claude/hooks/skill-activation-prompt.sh`
- [ ] `.claude/hooks/skill-activation-prompt.ts`
- [ ] `.claude/hooks/post-tool-use-tracker.sh`
- [ ] `.claude/hooks/package.json`
- [ ] `.claude/hooks/tsconfig.json`
- [ ] `.claude/skills/skill-rules.json`

**To Modify**:
- [ ] `.claude/settings.local.json` (add hooks section)

**To Execute**:
- [ ] `npm install` in `.claude/hooks/`
- [ ] `chmod +x` on all `.sh` files
- [ ] Manual testing of both hooks
- [ ] Live testing in Claude Code session
