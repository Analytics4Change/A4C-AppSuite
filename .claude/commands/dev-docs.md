# Create Development Documentation

Create a structured development documentation set for the current feature using the dev-docs pattern from claude-code-infrastructure-showcase.

## Instructions

You are creating persistent memory documentation that will survive `/clear` commands and context resets. Follow these steps carefully:

### Step 1: Analyze Current Work

1. **Check the current git branch** to determine the feature name
   - Run `git branch --show-current`
   - If branch name is descriptive (e.g., `feature/auth-integration`), use it as the feature name
   - If branch is `main` or not descriptive, ask the user for a feature name

2. **Review recent changes** to understand context
   - Run `git status` to see modified files
   - Run `git diff --stat` to see scope of changes
   - Run `git log --oneline -5` to see recent commits

3. **Identify the feature scope**
   - Ask the user to describe the feature goal in 1-2 sentences
   - Ask about key architectural decisions already made
   - Ask about tech stack or components involved

### Step 2: Create Directory Structure

Create the dev-docs directory if it doesn't exist:
```bash
mkdir -p dev/active/
```

### Step 3: Generate [feature]-plan.md

Create `dev/active/[feature-name]-plan.md` with the following structure:

```markdown
# Implementation Plan: [Feature Name]

## Executive Summary
[1-2 paragraph overview of what this feature accomplishes and why]

## Phase 1: [First Major Phase]
[Break implementation into logical phases]

### 1.1 [Subphase Name]
- Key tasks
- Expected outcomes
- Time estimate

### 1.2 [Subphase Name]
- Key tasks
- Expected outcomes
- Time estimate

## Phase 2: [Second Major Phase]
[Continue with remaining phases...]

## Success Metrics

### Immediate
- [ ] Success criteria for initial validation

### Medium-Term
- [ ] Success criteria for feature completion

### Long-Term
- [ ] Success criteria for production stability

## Implementation Schedule
[Timeline with phases mapped to days/weeks]

## Risk Mitigation
[Identify risks and mitigation strategies]

## Next Steps After Completion
[What comes after this feature is done]
```

**Guidelines for plan.md**:
- Keep concise (aim for 1000-2000 words)
- Focus on high-level strategy, not implementation details
- Break complex features into 3-5 phases
- Include time estimates for each phase
- Add success criteria for validation

### Step 4: Generate [feature]-context.md

Create `dev/active/[feature-name]-context.md` with the following structure:

```markdown
# Context: [Feature Name]

## Decision Record

**Date**: [YYYY-MM-DD]
**Feature**: [Feature name]
**Goal**: [1-2 sentence goal]

### Key Decisions
1. **[Decision category]**: [What was decided and why]
2. **[Decision category]**: [What was decided and why]
[Add 3-5 key architectural or approach decisions]

## Technical Context

### Architecture
[How this feature fits into overall system architecture]

### Tech Stack
[Specific technologies, frameworks, libraries being used]

### Dependencies
[What this feature depends on or integrates with]

## File Structure

### Existing Files Modified
- `path/to/file.ts` - [What changed and why]
- `path/to/other.ts` - [What changed and why]

### New Files Created
- `path/to/new.ts` - [Purpose of this file]
- `path/to/another.ts` - [Purpose of this file]

## Related Components

[List other parts of the codebase that interact with this feature]

## Key Patterns and Conventions

[Document specific patterns being followed or established]

## Reference Materials

[Links to docs, RFCs, design specs, or other reference materials]

## Important Constraints

[Technical constraints, business requirements, or gotchas to remember]

## Why This Approach?

[Explain rationale for chosen approach vs alternatives considered]
```

**Guidelines for context.md**:
- Capture ALL architectural decisions (future Claude needs to know the "why")
- Document specific file paths that matter
- Include tech stack details
- Note any constraints or gotchas
- Keep it comprehensive (1200-1800 words is fine)

### Step 5: Generate [feature]-tasks.md

Create `dev/active/[feature-name]-tasks.md` with the following structure:

```markdown
# Tasks: [Feature Name]

## Phase 1: [Phase Name] ✅ IN PROGRESS

- [x] Completed task
- [x] Another completed task
- [ ] Pending task
- [ ] Another pending task

## Phase 2: [Phase Name] ⏸️ PENDING

- [ ] Task for phase 2
- [ ] Another task for phase 2

## Phase 3: [Phase Name] ⏸️ PENDING

- [ ] Task for phase 3
- [ ] Another task for phase 3

## Success Validation Checkpoints

### Immediate Validation
- [ ] [Validation criteria]
- [ ] [Validation criteria]

### Feature Complete Validation
- [ ] [Validation criteria]
- [ ] [Validation criteria]

## Current Status

**Phase**: [Current phase number and name]
**Status**: ✅ IN PROGRESS / ⏸️ PENDING / ✅ COMPLETE
**Last Updated**: [YYYY-MM-DD]
**Next Step**: [What to do next]
```

**Guidelines for tasks.md**:
- Use checkbox format for all tasks (`- [ ]` or `- [x]`)
- Mark current phase with ✅ IN PROGRESS
- Mark future phases with ⏸️ PENDING
- Mark completed phases with ✅ COMPLETE
- Be specific with task descriptions
- Update "Current Status" section with each change
- Include validation checkpoints

### Step 6: Inform User

After creating all three files, tell the user:

1. **Files created**:
   - `dev/active/[feature-name]-plan.md`
   - `dev/active/[feature-name]-context.md`
   - `dev/active/[feature-name]-tasks.md`

2. **How to use them**:
   - These files preserve context across `/clear` commands
   - Update them with `/dev-docs-update` before running `/clear`
   - After `/clear`, tell Claude to read these files to restore context

3. **Next steps**:
   - Review the generated files for accuracy
   - Make any necessary edits
   - Start working on the first pending task

## Important Notes

- **Be thorough**: These docs are the ONLY memory that survives `/clear`
- **Ask questions**: If you don't have enough context, ask the user before generating
- **Use git info**: Leverage git history and status to understand the feature
- **Keep organized**: Follow the structure exactly so future Claude can parse it
- **Update regularly**: Remind user to use `/dev-docs-update` before context resets

## Example Invocation

User might say:
- "Create dev-docs for the authentication refactor"
- "/dev-docs" (and you ask them for the feature name)
- "Set up dev-docs for feature/user-dashboard"
