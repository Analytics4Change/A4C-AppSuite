# Context: Progressive Disclosure Documentation System

## Decision Record

**Date**: 2025-12-30
**Feature**: Progressive Disclosure Documentation System
**Goal**: Enable AI agents to efficiently navigate documentation while minimizing context memory overhead by learning "just enough" about topics before drilling deeper.

### Key Decisions

1. **TL;DR Placement**: TL;DR sections go immediately after YAML frontmatter, before any other content. This ensures agents can read the summary first and decide if deeper reading is needed.

2. **TL;DR Format**: Standardized format with 5 fields:
   - `Summary`: 1-2 sentences
   - `When to read`: Bullet list of scenarios
   - `Prerequisites`: Optional dependencies
   - `Key topics`: Comma-separated keywords
   - `Estimated read time`: In minutes

3. **Separate Navigation Index**: Created dedicated `AGENT-INDEX.md` rather than enhancing README.md. Keeps agent-specific content separate and optimized for machine parsing.

4. **Agent Guidelines as Separate File**: Created `AGENT-GUIDELINES.md` rather than embedding in CLAUDE.md. Provides comprehensive instructions without bloating the main guidance file.

5. **Phased Retrofit**: Retrofitting 115+ docs in phases (high-priority first) rather than all at once. Allows validation of format before mass application.

## Technical Context

### Architecture

This feature enhances the documentation layer of A4C-AppSuite without affecting runtime code. It adds:

```
documentation/
├── AGENT-INDEX.md      # NEW: Keyword navigation, task trees
├── AGENT-GUIDELINES.md # NEW: Agent content creation rules
├── README.md           # MODIFIED: Add "For AI Agents" section
└── [all other docs]    # MODIFIED: Add TL;DR sections
```

The system integrates with existing CLAUDE.md files at:
- `/CLAUDE.md` (root)
- `/frontend/CLAUDE.md`
- `/workflows/CLAUDE.md`
- `/infrastructure/CLAUDE.md`

### Tech Stack

- **Markdown**: All documentation in GitHub-flavored markdown
- **YAML Frontmatter**: Already in use for `status` and `last_updated`
- **HTML Comments**: Used for TL;DR markers (`<!-- TL;DR-START -->`)

### Dependencies

- Existing documentation structure (115+ files)
- YAML frontmatter convention already established
- Cross-reference patterns already in use ("See Also" sections)

## File Structure

### New Files Created

| File | Purpose |
|------|---------|
| `documentation/AGENT-INDEX.md` | Keyword-based navigation index for AI agents |
| `documentation/AGENT-GUIDELINES.md` | Instructions for creating/updating docs with progressive disclosure |

### Existing Files Modified

| File | Changes |
|------|---------|
| `CLAUDE.md` | Add "AI Agent Quick Start" section near top |
| `documentation/README.md` | Add "For AI Agents" section at top |
| `frontend/CLAUDE.md` | Add "Documentation Resources" link section |
| `workflows/CLAUDE.md` | Add "Documentation Resources" link section |
| `infrastructure/CLAUDE.md` | Add "Documentation Resources" link section |

### Documents with TL;DR Added (Phase 2 - 15 docs)

| Document | TL;DR Summary |
|----------|---------------|
| `frontend/CLAUDE.md` | Frontend dev guide with auth, MobX, accessibility |
| `workflows/CLAUDE.md` | Temporal workflow guide with determinism, saga patterns |
| `infrastructure/CLAUDE.md` | Infrastructure guide with deployment runbook |
| `documentation/README.md` | Master index for 115+ documentation files |
| `architecture/authentication/frontend-auth-architecture.md` | Three-mode auth system with IAuthProvider |
| `architecture/authentication/supabase-auth-overview.md` | Social login, Enterprise SSO, JWT flow |
| `architecture/authorization/rbac-architecture.md` | Permission-based RBAC with JWT claims |
| `architecture/data/event-sourcing-overview.md` | CQRS with domain_events and projections |
| `architecture/data/multi-tenancy-architecture.md` | RLS isolation via org_id JWT claim |
| `architecture/workflows/temporal-overview.md` | Durable workflow orchestration |
| `infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md` | Migration and edge function deployment |
| `infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md` | Database hook for custom JWT claims |
| `infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md` | Idempotent SQL patterns |
| `frontend/guides/DEVELOPMENT.md` | Local dev setup, npm commands |
| `frontend/guides/EVENT-DRIVEN-GUIDE.md` | CQRS patterns in React |

### Remaining (~100 docs pending TL;DR)

## Related Components

### Existing Documentation Infrastructure
- `documentation/README.md` - Master index (454 lines)
- Component READMEs in each subdirectory
- YAML frontmatter with `status: current|aspirational|archived`
- Cross-reference "See Also" sections

### Claude Code Skills
- `.claude/skills/infrastructure-guidelines/SKILL.md` - Pattern reference
- `.claude/commands/dev-docs.md` - This command
- `.claude/commands/dev-docs-update.md` - Update command

## Key Patterns and Conventions

### TL;DR Section Format

```markdown
---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: [1-2 sentences describing document purpose]

**When to read**:
- [Scenario 1 when this doc is useful]
- [Scenario 2 when this doc is useful]

**Prerequisites**: [Optional - required knowledge or docs to read first]

**Key topics**: `keyword1`, `keyword2`, `keyword3`

**Estimated read time**: X minutes
<!-- TL;DR-END -->

# Document Title
[Rest of content...]
```

### AGENT-INDEX.md Structure

1. **Quick Decision Tree**: Task → Start Here → Then Read
2. **By Keyword**: Keyword → Primary Document → Related
3. **Document Catalog**: Tables with Summary, Keywords, ~Tokens

### Placement Rules

| Content Type | Directory |
|-------------|-----------|
| Cross-cutting architecture | `documentation/architecture/[domain]/` |
| Frontend-specific | `documentation/frontend/[category]/` |
| Workflow-specific | `documentation/workflows/[category]/` |
| Infrastructure-specific | `documentation/infrastructure/[category]/` |
| Database tables | `documentation/infrastructure/reference/database/tables/` |

## Reference Materials

- Plan file: `/home/lars/.claude/plans/deep-roaming-barto.md`
- Existing skill pattern: `.claude/skills/infrastructure-guidelines/SKILL.md`
- Documentation structure exploration: Agent analysis from planning phase
- Commit: `d2792a01` - Phase 1 complete + partial Phase 2 (2025-12-30)
- Phase 2 complete: 2025-12-30 (7 more TL;DR sections, 18 new keywords in AGENT-INDEX.md)

## Important Constraints

1. **TL;DR Must Be Brief**: 2-3 sentences max for Summary field
2. **Keywords Must Match**: Keywords in TL;DR must appear in AGENT-INDEX.md
3. **Links Must Be Relative**: All cross-references use relative paths
4. **Frontmatter Required**: All docs must have YAML frontmatter with status/last_updated
5. **HTML Comments for Markers**: Use `<!-- TL;DR-START -->` and `<!-- TL;DR-END -->` for parsing

## Why This Approach?

### Alternatives Considered

1. **Enhance README.md only**: Rejected because README.md is already 454 lines; adding agent-specific navigation would bloat it further.

2. **Embed guidelines in CLAUDE.md**: Rejected because CLAUDE.md should focus on quick-start; detailed documentation rules belong in a dedicated file.

3. **Auto-generate TL;DRs**: Rejected because AI-generated summaries need human review for accuracy; manual creation ensures quality.

4. **Single massive retrofit PR**: Rejected because 115+ file changes are hard to review; phased approach allows validation.

### Why This Approach Works

- **Separation of concerns**: Agent navigation separate from human documentation
- **Progressive enhancement**: Existing docs continue working; TL;DRs add value incrementally
- **Maintainable**: Clear guidelines ensure future docs follow pattern
- **Discoverable**: Multiple entry points (CLAUDE.md, README.md, component CLAUDEs) all point to agent resources
