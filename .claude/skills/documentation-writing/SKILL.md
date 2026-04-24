---
name: Documentation Writing Guidelines
description: Guard rails for documentation quality - frontmatter, TL;DR format, AGENT-INDEX updates, and component prop documentation standards in A4C-AppSuite.
version: 1.1.0
last_updated: 2026-04-23
category: documentation
tags: [documentation, agent-index, frontmatter, tldr, component-docs, staleness, drift]
---

# Documentation Guard Rails

Critical rules for creating and updating documentation in the A4C-AppSuite `documentation/` directory. The dominant doc-quality failure mode in this repo is **stale content drifting away from the codebase** — most rules below exist to prevent that.

For full structural rules (placement, templates, quality checklist), see `documentation/AGENT-GUIDELINES.md`. This skill layers anti-staleness discipline on top.

---

## A. Core Structure

### 1. Required YAML Frontmatter

Every documentation file MUST start with:

```yaml
---
status: current        # or aspirational, archived
last_updated: 2026-04-23
---
```

**Rule**: `last_updated` must equal **today's date, exactly** on every edit — no "close enough", no skipping for "minor" fixes. If you touched the file, bump the date. This is the single cheapest signal a future reader has that the doc is fresh.

### 2. Required TL;DR Section

Every file MUST include a TL;DR block immediately after frontmatter:

```markdown
<!-- TL;DR-START -->
## TL;DR

**Summary**: [1-2 sentences MAX — not a paragraph]

**When to read**:
- [Specific scenario, not generic like "when working with auth"]
- [Another specific scenario]

**Key topics**: `keyword1`, `keyword2`, `keyword3`

**Estimated read time**: X minutes
<!-- TL;DR-END -->
```

**Staleness rule**: When the body changes scope, gains/loses a section, or shifts focus, the TL;DR **must be resynced in the same edit**. Symptom check: if you added or removed a section, the Summary and Key topics probably need updating. TL;DR-vs-body drift is recurrent — don't let your edit be the next example.

### 3. Keep AGENT-INDEX.md in Sync

`documentation/AGENT-INDEX.md` is the agent's primary entry point. It drifts silently when you skip updates. You MUST update it for:

- **New file**: add to keyword table + Document Catalog (summary + token estimate). Verify keywords match TL;DR `Key topics`.
- **Rename or move**: grep repo-wide for the old path (`grep -r "old-path.md" documentation/ .claude/ *CLAUDE.md`) and update all hits.
- **Archive**: remove or repoint all entries pointing to the archived doc.
- **Significant body change**: if scope or keywords shifted, refresh the catalog summary and re-check the token estimate.

### 4. Component Props: Inline JSDoc Only

Document props directly in the TypeScript interface — no external prop documentation files.

```typescript
interface ButtonProps {
  // Visual style variant of the button
  variant?: 'default' | 'destructive' | 'outline';
  // Size preset affecting padding and font size
  size?: 'default' | 'sm' | 'lg';
  // Render as child element using Radix Slot
  asChild?: boolean;
}
```

Use `documentation/templates/component-template.md` for component doc structure.

### 5. Definition of Done: `npm run docs:check`

Before any frontend PR, documentation validation MUST pass:

```bash
cd frontend && npm run docs:check
```

Requirements: zero high-priority alignment issues, 100% component coverage, all props documented.

### 6. Links Must Be Relative

All internal documentation links use relative paths from the current file location. Never use absolute paths.

### 7. No Orphaned Docs — In Either Direction

- **New docs**: every doc MUST have a "Related Documentation" section linking to at least one related doc, AND be linked FROM at least one existing doc.
- **Archiving**: before archiving, grep for inbound links (`grep -r "doc-to-archive.md" documentation/ .claude/ *CLAUDE.md`). Either delete the links or repoint them to the successor. Every archived doc should include a **"Replaced by"** pointer at the top of its body.

---

## B. Anti-Staleness Guard Rails

These rules target drift patterns that have actually hit this repo. Each is grounded in real past failures.

### 8. Don't Hardcode Inventory Counts

Avoid writing specific counts ("52 handlers", "13 routers", "11 RPCs", "108 reference files", "20+ tables") into prose unless you own their maintenance. These numbers drift within days of the next sprint.

**Prefer**: link to the source directory, reference a counting command (`ls infrastructure/supabase/handlers/*.sql | wc -l`), or omit the count entirely. If you must state a count, pair it with a dated parenthetical: `(N as of YYYY-MM-DD)`.

### 9. Path References Must Resolve at Commit Time

Every file path mentioned in a doc must exist at commit time. Before committing:

```bash
# Extract referenced paths and verify each exists
grep -oE '`[a-zA-Z_/.-]+\.(ts|tsx|sql|yaml|md)`' <file> | tr -d '`' | while read p; do test -e "$p" || echo "MISSING: $p"; done
```

For rename-prone artifacts (CI workflow filenames, migration filenames, component paths): prefer referencing a directory + pattern over a pinned filename. Example: `.github/workflows/temporal-*.yml` is more resilient than `temporal-deploy.yml`.

*Past example: a renamed CI workflow filename broke the deployment runbook for weeks.*

### 10. Don't Duplicate Source Code or Signatures

API signatures, handler names, RPC return shapes, and event schemas live in code and contracts. **Reference them by symbol + file path**, do not copy-paste them into docs.

- Bad: docs show `{ success: true, id: "..." }` when the RPC now returns `{ success, data: { ... } }`.
- Good: "Returns the standard Pattern A envelope (see `documentation/architecture/decisions/adr-rpc-readback-pattern.md`)."

Copy-drift is a primary cause of JSDoc and example staleness. If a code change in a PR renames/retypes a symbol, treat that as a search-and-update trigger for docs (see rule 12).

### 11. Aspirational Content Has a Lifecycle

`status: aspirational` is a promise, not a parking lot:

- **When creating** an aspirational doc, include an explicit implementation-status block in the body (the `var-partnerships.md` pattern: ✅ shipped, ❌ not yet). Don't leave a future reader guessing which parts are real.
- **When a feature ships**, grep `status: aspirational` docs for references to it. Flip status to `current`, refresh the TL;DR, remove the inline `> Note: This feature is not yet implemented` warning.

If an aspirational doc still reads the same way 6 months later, it's probably a zombie — evaluate whether to ship it, archive it, or delete it.

### 12. Code-Doc Changes Are One Change, Not Two

"I'll do the doc update in a follow-up PR" is how docs rot. If a PR:

- Renames a function, RPC, event type, or file/directory
- Changes an API signature, response shape, or parameter set
- Adds/removes a handler, router, migration, or Edge Function
- Changes event routing, permission names, or schema versions

...the same PR must include the corresponding doc updates. Before marking a PR ready:

```bash
# For every symbol you changed, grep docs + CLAUDE.md files
grep -r "<old_symbol>" documentation/ .claude/skills/ *CLAUDE.md **/CLAUDE.md
```

Fix each hit or explicitly accept the drift with a comment in the PR description.

### 13. Skills Are Part of the Docs Staleness Surface

The `.claude/skills/` directory is documentation that agents load into context. It rots the same way `documentation/` rots.

- If a skill names a specific permission, function, event type, table column, or file path, that name can be renamed or removed by a future commit.
- Treat skill files with the same audit discipline as regular docs: on any edit, verify named symbols still exist (`grep`), and apply the Drift Checklist below.
- If you notice codebase drift while using a skill, update the skill in the same session — don't defer.

*Past example: three guideline skills were repaired in one day after drifting from the actual codebase over several weeks.*

---

## C. Before Editing a Doc

Run this before any non-trivial edit:

1. **Read the frontmatter.** `status: current` is the only safe target. For `archived`, do not update — archive is frozen. For `aspirational`, find and read the implementation-status block first so your edit doesn't overstate reality.
2. **Check recency.** `git log -5 --oneline <doc>` and compare commit dates to `last_updated`. What has changed in the code this doc describes since `last_updated`? If the doc is older than the code it describes, assume drift and verify before trusting any claim in the body.
3. **Scan for drift-prone content** — inventory counts (rule 8), hardcoded file paths (rule 9), function signatures or response examples (rule 10). For each, verify against source **before** layering your own edits on top of potentially-stale context.
4. **Plan the TL;DR update.** If your edit shifts scope or keywords, the TL;DR resync is part of this diff — not a follow-up (rule 2).

### Drift Checklist (post-edit, pre-commit)

- [ ] `last_updated` = today
- [ ] TL;DR Summary and Key topics match the current body
- [ ] Every file path mentioned exists (rule 9)
- [ ] Every function/RPC/event/handler name mentioned still exists in source (grep)
- [ ] AGENT-INDEX.md entries (keywords, catalog summary, token estimate) reflect the edit if scope changed
- [ ] No hardcoded inventory counts introduced (rule 8)
- [ ] If archiving: inbound links updated and "Replaced by" pointer added (rule 7)

---

## Templates

| Type | Template |
|------|----------|
| Component docs | `documentation/templates/component-template.md` |
| API docs | `documentation/templates/api-template.md` |
| Database table | `documentation/infrastructure/reference/database/table-template.md` |

## Deep Reference

- `documentation/AGENT-GUIDELINES.md` — Full creation/update rules, quality checklist, placement rules, category subdirectories
- `documentation/AGENT-INDEX.md` — Keyword navigation index, document catalog
- `documentation/README.md` — Complete table of contents
