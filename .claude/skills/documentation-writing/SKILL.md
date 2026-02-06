---
name: Documentation Writing Guidelines
description: Guard rails for documentation quality - frontmatter, TL;DR format, AGENT-INDEX updates, and component prop documentation standards in A4C-AppSuite.
version: 1.0.0
category: documentation
tags: [documentation, agent-index, frontmatter, tldr, component-docs, definition-of-done]
---

# Documentation Guard Rails

Critical rules for creating and updating documentation in the A4C-AppSuite `documentation/` directory. For full rules and templates, see `documentation/AGENT-GUIDELINES.md`.

---

## 1. Required YAML Frontmatter

Every documentation file MUST start with:

```yaml
---
status: current        # or aspirational, archived
last_updated: 2026-02-05  # today's date
---
```

Update `last_updated` on every edit. Mark aspirational content with inline `> **Note**: This feature is not yet implemented.`

## 2. Required TL;DR Section

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

**Common mistake**: Summary longer than 2 sentences. Keep it concise.

## 3. New Files Must Update AGENT-INDEX.md

When creating a new documentation file, you MUST:
1. Add keywords to the keyword table in `documentation/AGENT-INDEX.md`
2. Add the file to the Document Catalog section with summary, keywords, and token estimate
3. Verify keywords match the TL;DR `Key topics` field

## 4. Component Props: Inline JSDoc Only

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

## 5. Definition of Done: `npm run docs:check`

Before any frontend PR, documentation validation MUST pass:

```bash
cd frontend && npm run docs:check
```

Requirements: zero high-priority alignment issues, 100% component coverage, all props documented.

## 6. Links Must Be Relative

All internal documentation links use relative paths from the current file location. Never use absolute paths.

## 7. No Orphaned Docs

Every document MUST have a "Related Documentation" section linking to at least one related doc. Every new doc should be linked FROM at least one existing doc.

---

## Templates

| Type | Template |
|------|----------|
| Component docs | `documentation/templates/component-template.md` |
| API docs | `documentation/templates/api-template.md` |
| Database table | `documentation/infrastructure/reference/database/table-template.md` |

## Deep Reference

- `documentation/AGENT-GUIDELINES.md` — Full creation/update rules, quality checklist, anti-patterns
- `documentation/AGENT-INDEX.md` — Keyword navigation index, document catalog
- `documentation/README.md` — Complete table of contents
