---
status: current
last_updated: 2025-12-30
purpose: agent-instructions
---

# Documentation Guidelines for AI Agents

> **Purpose**: Instructions for AI agents (Claude, GPT, etc.) on how to navigate, update, and create documentation in this repository.

## Finding Documentation

### Entry Points (Check These First)

1. **Root CLAUDE.md**: `/CLAUDE.md`
   - Repository overview, quick start commands, key documentation links

2. **Component CLAUDE.md files**:
   - `/frontend/CLAUDE.md` - Frontend development (React, MobX, accessibility)
   - `/workflows/CLAUDE.md` - Temporal workflows and activities
   - `/infrastructure/CLAUDE.md` - Infrastructure, deployment, Supabase

3. **Agent Navigation Index**: `/documentation/AGENT-INDEX.md`
   - Keyword-based navigation
   - Task decision tree
   - Document summaries with token estimates

4. **Documentation README**: `/documentation/README.md`
   - Complete table of contents
   - Quick Start section with common tasks

### Search Strategy

```
Priority Order:
1. Check if AGENT-INDEX.md has keyword match
2. Read TL;DR sections to filter relevant docs
3. Use Grep on documentation/ for specific terms
4. Deep-read only documents that match the task
```

### Progressive Disclosure Pattern

1. **Scan TL;DR** - Read Summary field (2-3 sentences)
2. **Check "When to read"** - Verify doc matches your task
3. **Review Prerequisites** - Read dependent docs first if needed
4. **Deep-read if needed** - Only read full doc when TL;DR confirms relevance

## Creating New Documentation

### Required Structure

Every new documentation file MUST include:

```markdown
---
status: current|aspirational|archived
last_updated: YYYY-MM-DD
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: [1-2 sentences describing what this document covers]

**When to read**:
- [Scenario 1 when this doc is useful]
- [Scenario 2 when this doc is useful]

**Prerequisites**: [Optional - required knowledge or docs to read first]
- [Doc or concept required]

**Key topics**: `keyword1`, `keyword2`, `keyword3`

**Estimated read time**: X minutes
<!-- TL;DR-END -->

# Document Title

[Main content...]

## Related Documentation

- [Link to related doc 1](path/to/doc1.md) - Brief description
- [Link to related doc 2](path/to/doc2.md) - Brief description
```

### TL;DR Field Guidelines

| Field | Required | Guidelines |
|-------|----------|------------|
| **Summary** | Yes | 1-2 sentences max. Answer "What does this doc cover?" |
| **When to read** | Yes | 2-4 bullet points. Specific scenarios, not generic. |
| **Prerequisites** | No | Only if doc assumes prior knowledge. Link to prereq docs. |
| **Key topics** | Yes | 3-6 keywords in backticks. Must appear in AGENT-INDEX.md |
| **Estimated read time** | Yes | Round to nearest 5 minutes. Based on ~200 words/min. |

### Template Selection

| Document Type | Template Location |
|--------------|-------------------|
| Component documentation | `/documentation/templates/component-template.md` |
| API documentation | `/documentation/templates/api-template.md` |
| Database table reference | `/documentation/infrastructure/reference/database/table-template.md` |
| Architecture decision | Follow patterns in `/documentation/architecture/` |
| How-to guide | Follow patterns in `*/guides/` directories |

### Placement Rules

| Content Type | Directory |
|-------------|-----------|
| Cross-cutting architecture | `documentation/architecture/[domain]/` |
| Frontend-specific | `documentation/frontend/[category]/` |
| Workflow-specific | `documentation/workflows/[category]/` |
| Infrastructure-specific | `documentation/infrastructure/[category]/` |
| Database tables | `documentation/infrastructure/reference/database/tables/` |

### Category Subdirectories

| Category | Purpose |
|----------|---------|
| `getting-started/` | Onboarding, installation, first steps |
| `architecture/` | Design decisions, high-level patterns |
| `guides/` | Step-by-step how-to guides |
| `reference/` | Quick lookup (APIs, schemas, configs) |
| `patterns/` | Design patterns and best practices |
| `testing/` | Testing strategies and guides |
| `operations/` | Deployment, configuration, troubleshooting |

## Updating Existing Documentation

### Before Making Changes

1. **Read the TL;DR** to confirm you're editing the right document
2. **Check the status** in frontmatter:
   - `current` - Active, should be accurate
   - `aspirational` - Planned features, mark clearly with inline warnings
   - `archived` - Historical, generally don't update

### Required Updates

When editing documentation:

1. **Update `last_updated`** in frontmatter to today's date
2. **Update TL;DR** if summary, keywords, or scope changes
3. **Preserve existing cross-references** or update if paths changed
4. **Add "Related Documentation" links** if new connections are relevant

### After Making Changes

1. **Update AGENT-INDEX.md** if:
   - Keywords changed significantly
   - Summary changed
   - File was renamed or moved
   - New file was created

2. **Verify links** in the document still work

## Quality Checklist

Before considering documentation complete:

- [ ] YAML frontmatter with `status` and `last_updated`
- [ ] TL;DR section with all required fields
- [ ] TL;DR Summary is 1-2 sentences (not a paragraph)
- [ ] TL;DR Keywords appear in AGENT-INDEX.md
- [ ] Frontmatter status matches content (current vs aspirational)
- [ ] Related Documentation section with cross-references
- [ ] File placed in correct directory per placement rules
- [ ] Entry added to AGENT-INDEX.md (for new files)
- [ ] All internal links are relative paths
- [ ] All internal links verified working

## Common Patterns

### Status Markers

```yaml
# In frontmatter
status: current        # Describes implemented features
status: aspirational   # Describes planned features (add inline warning)
status: archived       # Historical content
```

```markdown
<!-- Inline warning for aspirational content -->
> **Note**: This feature is not yet implemented. This document describes
> planned functionality.
```

### Code Examples

Always include language identifier for syntax highlighting:

````markdown
```typescript
// TypeScript code
```

```sql
-- SQL code
```

```bash
# Shell commands
```
````

### Cross-References

Use relative paths from the document's location:

```markdown
<!-- From /documentation/frontend/guides/my-guide.md -->
See [Authentication Architecture](../../architecture/authentication/frontend-auth-architecture.md)
```

### Inline Alerts

```markdown
> **Warning**: Critical information that could cause issues if ignored.

> **Note**: Helpful context that aids understanding.

> **Tip**: Best practice or shortcut.
```

## Token Estimation Guide

For AGENT-INDEX.md token counts:

| Lines of Markdown | Approximate Tokens |
|-------------------|-------------------|
| 50 lines | ~500 tokens |
| 100 lines | ~1000 tokens |
| 200 lines | ~2000 tokens |
| 500 lines | ~5000 tokens |

Estimate: ~10 tokens per line of typical markdown content.

For read time estimation:
- ~200 words per minute average reading speed
- 50 lines ≈ 2-3 minutes
- 200 lines ≈ 8-10 minutes
- 500 lines ≈ 20-25 minutes

## Anti-Patterns to Avoid

### TL;DR Anti-Patterns

```markdown
<!-- ❌ BAD: Summary too long -->
**Summary**: This document provides a comprehensive overview of the authentication
system including OAuth2 PKCE flows, JWT token management, session handling,
custom claims configuration, and integration with Supabase Auth...

<!-- ✅ GOOD: Summary concise -->
**Summary**: Three-mode auth system (mock/integration/production) using
IAuthProvider interface with JWT custom claims.
```

```markdown
<!-- ❌ BAD: Generic "When to read" -->
**When to read**:
- When you need to know about authentication
- When working with auth code

<!-- ✅ GOOD: Specific scenarios -->
**When to read**:
- Adding a new OAuth provider (Google, GitHub, etc.)
- Debugging JWT custom claims not appearing
- Setting up local development with mock auth
```

### Documentation Anti-Patterns

- **No frontmatter**: Every doc needs `status` and `last_updated`
- **Missing TL;DR**: Every doc needs progressive disclosure summary
- **Absolute paths**: Use relative paths for internal links
- **Orphaned docs**: Every doc should link to/from related docs
- **Stale links**: Verify all links work after moving files

## See Also

- [AGENT-INDEX.md](./AGENT-INDEX.md) - Keyword navigation index
- [README.md](./README.md) - Full documentation table of contents
- [templates/](./templates/) - Documentation templates
- [Root CLAUDE.md](../CLAUDE.md) - Repository overview
