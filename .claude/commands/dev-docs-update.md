# Update Development Documentation

Update existing dev-docs before running `/clear` to preserve current progress and context.

## Instructions

You are updating persistent memory documentation to capture the latest state before a context reset. This ensures no knowledge is lost when `/clear` is executed.

### Step 1: Identify the Feature

1. **Find existing dev-docs**:
   ```bash
   ls dev/active/
   ```

2. **Determine which feature to update**:
   - If multiple features exist, ask the user which one
   - If only one exists, use that
   - Check the current git branch to confirm: `git branch --show-current`

### Step 2: Review Recent Changes

Analyze what has changed since dev-docs were last updated:

1. **Check git status and diff**:
   ```bash
   git status
   git diff --stat
   git log --oneline -10
   ```

2. **Review modified files**:
   - Note which files were added, modified, or deleted
   - Understand the scope of recent work

3. **Check completed tasks**:
   - Read the current `[feature]-tasks.md` file
   - Identify which tasks were completed since last update
   - Identify any new tasks that emerged

### Step 3: Update [feature]-context.md

Update the context file with new information:

#### Add New Decisions (if any)
If architectural decisions were made since last update, add them to the "Key Decisions" section:

```markdown
### Key Decisions
[...existing decisions...]
5. **[New Decision Category]**: [What was decided and why] - Added [date]
```

#### Update File Structure Section
Add any new files or document significant changes to existing files:

```markdown
### New Files Created
[...existing files...]
- `path/to/newly/created.ts` - [Purpose] - Added [date]

### Existing Files Modified
[...existing modifications...]
- `path/to/modified.ts` - [Recent changes] - Updated [date]
```

#### Add New Constraints or Gotchas (if discovered)
If you encountered unexpected issues or learned important constraints:

```markdown
## Important Constraints
[...existing constraints...]
- **[New Constraint]**: [Description and impact] - Discovered [date]
```

#### Update Reference Materials (if any new docs/links)
Add any new documentation, specs, or reference materials discovered:

```markdown
## Reference Materials
[...existing materials...]
- [New Resource Title](url) - Added [date]
```

**Important**:
- DO NOT remove existing context
- DO NOT overwrite good context with less detail
- ADD to context, don't replace it
- Mark additions with date for traceability

### Step 4: Update [feature]-tasks.md

Update the task checklist with current progress:

1. **Mark completed tasks**:
   - Change `- [ ]` to `- [x]` for completed tasks
   - Be honest about what's actually done vs partially done

2. **Add new tasks** that emerged during implementation:
   ```markdown
   ## Phase N: [Phase Name]
   [... existing tasks ...]
   - [ ] [New task discovered during implementation]
   - [ ] [Another new task]
   ```

3. **Update phase status**:
   - If a phase is complete, change ⏸️ PENDING to ✅ COMPLETE
   - If you're moving to next phase, update ✅ IN PROGRESS marker

4. **Update "Current Status" section**:
   ```markdown
   ## Current Status

   **Phase**: [Updated phase number and name]
   **Status**: ✅ IN PROGRESS / ⏸️ PENDING / ✅ COMPLETE
   **Last Updated**: [Today's date: YYYY-MM-DD]
   **Next Step**: [What to do immediately after /clear]
   ```

**Important**:
- Be specific about what's next - future Claude needs clear direction
- Don't mark tasks complete if they're only partially done
- Add granular subtasks if you broke down a large task

### Step 5: Update [feature]-plan.md (if needed)

Usually the plan doesn't change much, but update IF:

1. **Scope changed significantly**:
   - Add a "Plan Updates" section documenting changes
   - Explain why scope changed

2. **Timeline shifted**:
   - Update implementation schedule
   - Note reasons for delay or acceleration

3. **New phases emerged**:
   - Add new phases to the plan
   - Explain why they weren't in original plan

4. **Success metrics evolved**:
   - Update success criteria if they changed
   - Document why they changed

**Generally**: Only update plan.md for significant changes. Small tactical adjustments belong in tasks.md.

### Step 6: Verify Completeness

Before finishing, verify:

1. **All recent work is captured**:
   - Every significant file change is documented in context.md
   - All completed tasks are checked in tasks.md
   - Any new decisions are in context.md

2. **Next steps are clear**:
   - tasks.md "Next Step" tells future Claude exactly what to do
   - Current phase is marked correctly
   - Pending tasks are well-defined

3. **Context is preserved**:
   - New constraints or gotchas are documented
   - Recent learnings are captured
   - File paths and references are current

### Step 7: Inform User

Tell the user what was updated:

```
✅ Dev-docs updated for [feature-name]:

**context.md**:
- Added [N] new decisions
- Updated file structure with [N] new/modified files
- Added [any new constraints or gotchas]

**tasks.md**:
- Marked [N] tasks complete in Phase [X]
- Added [N] new tasks that emerged
- Updated current status: Phase [X] - [Y% complete]

**plan.md**:
- [Updated / No changes needed]

**Ready for /clear**: All context preserved. After /clear, run:
"Read dev/active/[feature-name]-*.md and continue from where we left off"
```

## Important Notes

- **Preserve everything**: Future Claude has ZERO memory without these files
- **Be specific**: "Fixed bugs" is useless. "Fixed RLS policy to check org_id claim" is helpful
- **Document gotchas**: If you spent 2 hours debugging something, document why
- **Update before EVERY /clear**: Make this a habit, not an exception
- **Don't trust memory**: Read the files to see what needs updating, don't guess

## Example Invocation

User might say:
- "Update dev-docs before I run /clear"
- "/dev-docs-update"
- "Save current progress to dev-docs"
- "I need to /clear, can you update the docs first?"

## Best Practice Workflow

**Recommended pattern**:
1. Work on feature for 30-60 minutes
2. When context window fills up or you're switching tasks: `/dev-docs-update`
3. Review the updates Claude made
4. Run `/clear`
5. Tell Claude: "Read dev/active/[feature]-*.md and continue"
6. Continue working with fresh context window and preserved knowledge

This workflow prevents knowledge loss and keeps Claude productive across long features.
