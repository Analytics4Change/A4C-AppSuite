# Implementation Plan: Progressive Disclosure Documentation System

## Executive Summary

This feature implements a progressive disclosure system for the A4C-AppSuite documentation, enabling AI agents to efficiently navigate 115+ documentation files while minimizing context memory overhead. The system adds TL;DR sections to all documents, creates an agent-optimized navigation index, and establishes guidelines for maintaining progressive disclosure as documentation evolves.

The goal is to allow agents to "learn just enough" about a topic by reading quick summaries first, then drilling into details only when needed. This reduces token consumption while maintaining comprehensive documentation coverage.

## Phase 1: Core Infrastructure

Create the foundational files that enable agent-efficient navigation.

### 1.1 Create AGENT-INDEX.md
- Create keyword-based navigation index at `documentation/AGENT-INDEX.md`
- Include task decision tree (task → start doc → then read)
- Include keyword → document mapping table
- Include document catalog with summaries and token estimates
- Add sync instructions for maintaining the index

### 1.2 Create AGENT-GUIDELINES.md
- Create agent instructions at `documentation/AGENT-GUIDELINES.md`
- Document entry points and search strategy
- Define TL;DR section format and required fields
- Establish placement rules for new documents
- Include quality checklist for documentation

### 1.3 Update Entry Points
- Add "AI Agent Quick Start" section to root `CLAUDE.md`
- Add "For AI Agents" section to `documentation/README.md`
- Add "Documentation Resources" links to component CLAUDE.md files

## Phase 2: TL;DR Retrofit (High Priority Documents)

Add TL;DR sections to the most frequently accessed documents.

### 2.1 Component CLAUDE.md Files (3 files)
- `frontend/CLAUDE.md`
- `workflows/CLAUDE.md`
- `infrastructure/CLAUDE.md`

### 2.2 Root Documentation (2 files)
- `documentation/README.md`
- Root `CLAUDE.md` (if applicable)

### 2.3 Frequently Accessed Documents (~15 files)
- Documents linked from root CLAUDE.md "Key Documentation Resources"
- Documents in README.md "Frequently Accessed" section
- Authentication, RBAC, deployment, and event-driven guides

## Phase 3: TL;DR Retrofit (Architecture Documents)

Add TL;DR sections to all architecture documentation (~25 files).

### 3.1 Authentication Architecture
- `frontend-auth-architecture.md`
- `supabase-auth-overview.md`
- `custom-claims-setup.md`
- Related auth documents

### 3.2 Authorization Architecture
- `rbac-architecture.md`
- `rbac-implementation-guide.md`
- `scoping-architecture.md`

### 3.3 Data Architecture
- `event-sourcing-overview.md`
- `multi-tenancy-architecture.md`
- `organization-management-architecture.md`

### 3.4 Workflow Architecture
- `temporal-overview.md`
- `organization-onboarding-workflow.md`
- `organization-bootstrap-workflow-design.md`

## Phase 4: TL;DR Retrofit (Guides & Reference)

Add TL;DR sections to remaining documentation (~50+ files).

### 4.1 Frontend Guides
- All files in `documentation/frontend/guides/`
- All files in `documentation/frontend/reference/`

### 4.2 Infrastructure Guides
- All files in `documentation/infrastructure/guides/`
- Database table reference docs

### 4.3 Workflow Guides
- All files in `documentation/workflows/guides/`
- All files in `documentation/workflows/reference/`

### 4.4 Final AGENT-INDEX.md Sync
- Update document catalog with all new keywords
- Verify all links working
- Update token estimates

## Success Metrics

### Immediate
- [ ] AGENT-INDEX.md created with keyword navigation
- [ ] AGENT-GUIDELINES.md created with content rules
- [ ] Root CLAUDE.md has "AI Agent Quick Start" section
- [ ] Agent can find relevant docs via keyword search in <5 seconds

### Medium-Term
- [ ] All 115+ docs have TL;DR sections
- [ ] Agent can assess document relevance in <10 seconds via TL;DR
- [ ] AGENT-INDEX.md fully populated with all documents

### Long-Term
- [ ] New documentation follows progressive disclosure guidelines automatically
- [ ] AGENT-INDEX.md stays in sync with documentation changes
- [ ] Agent context usage measurably reduced for common tasks

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| TL;DR content becomes stale | Agent reads outdated summaries | Include `last_updated` in frontmatter, CI validation |
| AGENT-INDEX.md drift | Links break, keywords outdated | PR checklist reminder, consider CI link validation |
| Inconsistent TL;DR quality | Some docs more useful than others | Provide template, review first few for consistency |
| Over-engineering TL;DRs | Too verbose, defeats purpose | Keep to 2-3 sentences max, enforce in guidelines |

## Next Steps After Completion

1. **Monitor Usage**: Track which docs agents access most frequently
2. **Iterate on Format**: Adjust TL;DR format based on effectiveness
3. **Automate Sync**: Consider CI job to validate AGENT-INDEX.md links
4. **Expand Keywords**: Add more keywords to index as patterns emerge
