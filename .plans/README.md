# Planning Documentation Migration

**Date**: 2025-01-12
**Status**: ✅ Migrated to `documentation/`

---

## What Happened

Active planning documentation has been migrated from `.plans/` to the consolidated `documentation/` directory structure. This improves discoverability, maintains consistency across all documentation, and clearly separates current implementations from aspirational features.

## Migration Summary

- **30 files migrated** to `documentation/architecture/`
- **20 CURRENT** - Implemented features with operational systems
- **10 ASPIRATIONAL** - Planned features not yet implemented
- **6 DEPRECATED** - Historical Zitadel content preserved in `.archived_plans/`
- **2 SPECIAL** - Files requiring manual processing (split + converted)

---

## New Locations

### Authentication & Authorization
- **Supabase Auth integration** → `documentation/architecture/authentication/`
  - `supabase-auth-overview.md` (current)
  - `frontend-auth-architecture.md` (current)
  - `custom-claims-setup.md` (current)
  - `enterprise-sso-guide.md` (aspirational)
  - `impersonation-*.md` (5 files, aspirational)

- **RBAC permissions** → `documentation/architecture/authorization/`
  - `rbac-architecture.md` (current)
  - `rbac-implementation-guide.md` (current)
  - `organizational-deletion-ux.md` (aspirational)

### Workflows & Orchestration
- **Temporal integration** → `documentation/architecture/workflows/`
  - `temporal-overview.md` (current)
  - `organization-onboarding-workflow.md` (current)
  - `organization-bootstrap-workflow-design.md` (current - 80% complete)

- **Workflow reference** → `documentation/workflows/reference/`
  - `activities-reference.md` (current)

- **Workflow guides** → `documentation/workflows/guides/`
  - `error-handling-and-compensation.md` (current)

### Data & Organization Management
- **Organization architecture** → `documentation/architecture/data/`
  - `organization-management-architecture.md` (current - 90% complete)
  - `organization-management-implementation.md` (current)
  - `tenants-as-organizations.md` (current)
  - `event-sourcing-overview.md` (current - extracted from consolidated docs)
  - `multi-tenancy-architecture.md` (current - converted from HTML)
  - `provider-partners-architecture.md` (aspirational)
  - `var-partnerships.md` (aspirational)

### Frontend Architecture
- **Event resilience** → `documentation/frontend/architecture/`
  - `event-resilience-plan.md` (aspirational)

### Infrastructure
- **Infrastructure architecture** → `documentation/infrastructure/architecture/`
  - `deployment-mode-refactoring.md` (current)

- **Cloudflare guides** → `documentation/infrastructure/guides/cloudflare/`
  - `remote-access-plan.md` (current - cloudflared proxy operational)
  - `remote-access-todo.md` (current)

---

## What Stayed (Historical Reference)

### Deprecated Content
- `.archived_plans/zitadel/` (3 files) - Zitadel integration superseded by Supabase Auth
- `.archived_plans/provider-management/` (3 files) - Zitadel-based workflows
- `.plans/consolidated/agent-observations-zitadel-deprecated.md` - Historical Zitadel architecture
- `.plans/zitadel-integration/` - Empty directory (no markdown files)

All Zitadel content is preserved for historical reference. The A4C platform migrated from Zitadel to Supabase Auth in October 2025.

---

## Special Cases

### 1. Split Document: `agent-observations.md`
**Original**: `.plans/consolidated/agent-observations.md` (large consolidated architecture doc)

**Split into**:
- **CQRS content** → `documentation/architecture/data/event-sourcing-overview.md` (current)
  - Extracted CQRS/Event Sourcing patterns
  - Updated Zitadel references → Supabase Auth
  - Added cross-references to current architecture docs

- **Zitadel content** → `.plans/consolidated/agent-observations-zitadel-deprecated.md` (deprecated)
  - Renamed for clarity
  - Added deprecation warning at top
  - Preserved for historical reference

### 2. Converted Document: `multi-tenancy-organization.html`
**Original**: `.plans/multi-tenancy/multi-tenancy-organization.html` (53KB HTML file)

**Converted to**: `documentation/architecture/data/multi-tenancy-architecture.md` (current)
- Converted HTML → GitHub-flavored Markdown using pandoc
- Updated all Zitadel references → Supabase Auth
- Cleaned up HTML artifacts (divs, spans, links)
- Added YAML frontmatter with conversion notes
- 930 lines of comprehensive multi-tenancy documentation

---

## File Organization

### CURRENT vs ASPIRATIONAL

All migrated files include YAML frontmatter indicating their status:

**CURRENT** (20 files):
```yaml
---
status: current
last_updated: 2025-01-12
---
```
Features that are implemented and operational.

**ASPIRATIONAL** (10 files):
```yaml
---
status: aspirational
last_updated: 2025-01-12
---

> [!NOTE]
> **This feature is not yet implemented**
>
> This document describes a planned feature that has not been built yet.
```
Features that are planned but not yet built.

---

## Implementation Status Notes

### Cloudflare Remote Access
- **Status**: Current (cloudflared proxy operational)
- **User verification**: Currently connected via SSH through Cloudflare tunnel
- **Note**: Uses cloudflared proxy, NOT Cloudflare Zero Trust

### Provider Partners Architecture
- **Status**: Aspirational
- **User feedback**: More work needed for organizations (frontend + data collection)
- **Database**: Schema designed but not fully implemented

### Temporal Workflow Design
- **Status**: Current (80% complete)
- **Implementation**: `workflows/src/workflows/organization-bootstrap/workflow.ts` (303 lines)
- **Deployed**: Yes, but needs testing and full integration
- **Part of**: Organization creation flow

### Event Resilience
- **Status**: Aspirational
- **Partial implementation**: HTTP-level resilience (CircuitBreaker, ResilientHttpClient, IndexedDB cache)
- **Missing**: Domain event offline queue and reconciliation (plan.md features)

---

## Finding Documentation

For the complete documentation index, see:
- **Root index**: `documentation/README.md`
- **Frontend docs**: `documentation/frontend/`
- **Workflow docs**: `documentation/workflows/`
- **Infrastructure docs**: `documentation/infrastructure/`
- **Architecture docs**: `documentation/architecture/`

---

## Migration Audit Trail

**Completed**: 2025-01-12
**Migration type**: Phase 3.5 of Documentation Grooming
**Tool**: git mv (preserves file history)
**Files tracked**: All migrations tracked in `dev/active/planning-docs-audit-summary.md`

**Next phase**: Phase 6.1 - Fix broken links in migrated documentation
