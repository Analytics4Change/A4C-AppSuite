# A4C-AppSuite Documentation

Welcome to the A4C (Analytics4Change) AppSuite documentation. This directory contains all consolidated documentation for the monorepo, organized by component and purpose.

## Quick Start - Common Tasks

### For New Developers
- **[Frontend Getting Started](./frontend/getting-started/)** - Set up and run the React application
- **[Workflows Getting Started](./workflows/getting-started/)** - Run Temporal workflows locally
- **[Infrastructure Getting Started](./infrastructure/getting-started/)** - Set up local development environment

### Frequently Needed
- **[Component Reference](./frontend/reference/components/)** - UI component documentation
- **[API Reference](./frontend/reference/api/)** - Frontend API documentation
- **[Database Guides](./infrastructure/guides/database/)** - SQL, migrations, RLS policies
- **[Deployment Procedures](./infrastructure/operations/deployment/)** - How to deploy to environments
- **[Troubleshooting Guide](./infrastructure/operations/troubleshooting/)** - Common issues and solutions

### Architecture & Design
- **[Authentication](./architecture/authentication/)** - OAuth2, Supabase Auth, JWT custom claims
- **[Authorization](./architecture/authorization/)** - RBAC, RLS, multi-tenancy
- **[Data Architecture](./architecture/data/)** - Event-driven, CQRS, event sourcing
- **[Workflow Patterns](./architecture/workflows/)** - Temporal.io orchestration patterns

---

## Table of Contents

### [Frontend Documentation](./frontend/)
React/TypeScript medication management application

- **[Getting Started](./frontend/getting-started/)** - Development environment setup, first steps
- **[Architecture](./frontend/architecture/)** - Component design, state management, routing
- **[Guides](./frontend/guides/)** - How-to guides for common development tasks
- **[Reference](./frontend/reference/)** - Quick lookup documentation
  - [API Reference](./frontend/reference/api/) - Frontend API documentation
  - [Components](./frontend/reference/components/) - Component documentation and props
- **[Patterns](./frontend/patterns/)** - Design patterns and best practices
- **[Testing](./frontend/testing/)** - Unit tests, E2E tests, accessibility testing
- **[Performance](./frontend/performance/)** - Optimization strategies and profiling

### [Workflows Documentation](./workflows/)
Temporal.io workflow orchestration for long-running business processes

- **[Getting Started](./workflows/getting-started/)** - Local Temporal setup, running workers
- **[Architecture](./workflows/architecture/)** - Workflow design, activity patterns
- **[Guides](./workflows/guides/)** - How-to guides for workflow development
- **[Reference](./workflows/reference/)** - Workflow and activity API reference
- **[Testing](./workflows/testing/)** - Workflow replay tests, activity unit tests
- **[Operations](./workflows/operations/)** - Deployment, monitoring, troubleshooting

### [Infrastructure Documentation](./infrastructure/)
Terraform IaC, Kubernetes deployments, Supabase resources

- **[Getting Started](./infrastructure/getting-started/)** - Infrastructure setup and prerequisites
- **[Architecture](./infrastructure/architecture/)** - Infrastructure design and topology
- **[Guides](./infrastructure/guides/)** - Technology-specific how-to guides
  - [Database](./infrastructure/guides/database/) - PostgreSQL, migrations, RLS, triggers
  - [Kubernetes](./infrastructure/guides/kubernetes/) - K8s deployments and configuration
  - [Supabase](./infrastructure/guides/supabase/) - Supabase-specific guides
- **[Reference](./infrastructure/reference/)** - Quick lookup for schemas and configs
  - [Database Reference](./infrastructure/reference/database/) - Schema documentation
  - [Kubernetes Reference](./infrastructure/reference/kubernetes/) - K8s resource reference
- **[Testing](./infrastructure/testing/)** - Infrastructure testing strategies
- **[Operations](./infrastructure/operations/)** - Deployment and operational procedures
  - [Deployment](./infrastructure/operations/deployment/) - Deployment procedures by environment
  - [Configuration](./infrastructure/operations/configuration/) - Configuration management
  - [Troubleshooting](./infrastructure/operations/troubleshooting/) - Common issues and fixes

### [Architecture Documentation](./architecture/)
Cross-cutting architectural decisions that span multiple components

- **[Authentication](./architecture/authentication/)** - OAuth2/OIDC, Supabase Auth, session management, JWT custom claims
- **[Authorization](./architecture/authorization/)** - RBAC, RLS policies, permission models, multi-tenancy
- **[Data](./architecture/data/)** - Event-driven architecture, CQRS, event sourcing, database patterns
- **[Workflows](./architecture/workflows/)** - Temporal.io integration, orchestration patterns, Saga pattern

### [Archived Documentation](./archived/)
Historical and deprecated content preserved for reference

---

## Documentation by Audience

### 👨‍💻 Developers

#### Getting Started
- [Frontend Development Setup](./frontend/getting-started/)
- [Workflow Development Setup](./workflows/getting-started/)
- [Local Infrastructure Setup](./infrastructure/getting-started/)

#### Daily Development
- [Component Development Guide](./frontend/guides/)
- [Building Workflows](./workflows/guides/)
- [Database Schema Changes](./infrastructure/guides/database/)
- [Writing Tests](./frontend/testing/)

#### Architecture & Patterns
- [Frontend Patterns](./frontend/patterns/)
- [Authentication Architecture](./architecture/authentication/)
- [Data Architecture](./architecture/data/)

#### API & Reference
- [Component Reference](./frontend/reference/components/)
- [API Documentation](./frontend/reference/api/)
- [Database Schema Reference](./infrastructure/reference/database/)

### 🔧 Operators

#### Deployment
- [Deployment Procedures](./infrastructure/operations/deployment/)
- [Environment Configuration](./infrastructure/operations/configuration/)
- [Workflow Deployment](./workflows/operations/)

#### Monitoring & Troubleshooting
- [Troubleshooting Guide](./infrastructure/operations/troubleshooting/)
- [Workflow Monitoring](./workflows/operations/)

#### Configuration Management
- [Configuration Reference](./infrastructure/operations/configuration/)
- [Environment Variables](./infrastructure/reference/)
- [Kubernetes Configuration](./infrastructure/guides/kubernetes/)

### 🏗️ Architects

#### System Architecture
- [Authentication Architecture](./architecture/authentication/) - OAuth2, PKCE, SAML 2.0
- [Authorization Architecture](./architecture/authorization/) - RBAC, RLS, multi-tenancy
- [Data Architecture](./architecture/data/) - Event-driven, CQRS, event sourcing
- [Workflow Architecture](./architecture/workflows/) - Temporal.io, Saga pattern

#### Component Architecture
- [Frontend Architecture](./frontend/architecture/)
- [Workflow Architecture](./workflows/architecture/)
- [Infrastructure Architecture](./infrastructure/architecture/)

#### Patterns & Practices
- [Design Patterns](./frontend/patterns/)
- [Data Patterns](./architecture/data/)
- [Integration Patterns](./architecture/workflows/)

---

## Documentation Organization

This documentation follows a **standardized structure** across all components to make navigation intuitive and consistent.

### Standard Directory Structure

Every component (frontend/, workflows/, infrastructure/) uses the same organizational pattern:

| Directory | Purpose | Examples |
|-----------|---------|----------|
| **getting-started/** | Onboarding, installation, first steps | Setup guides, prerequisites, "hello world" |
| **architecture/** | Design decisions, high-level patterns | Component design, state management, data flow |
| **guides/** | Step-by-step how-to guides | "How to add a component", "How to write a migration" |
| **reference/** | Quick lookup documentation | API docs, schema reference, configuration options |
| **patterns/** | Design patterns and best practices | Authentication patterns, error handling, testing patterns |
| **testing/** | Testing strategies and guides | Unit tests, E2E tests, test setup |
| **operations/** | Deployment, configuration, troubleshooting | Deploy procedures, monitoring, common issues |

### Component-Specific Subdirectories

Some directories have component-specific subdirectories for better organization:

- **Frontend reference/** - Split into `api/` and `components/`
- **Infrastructure guides/** - Split by technology: `database/`, `kubernetes/`, `supabase/`
- **Infrastructure operations/** - Split by activity: `deployment/`, `configuration/`, `troubleshooting/`

### Cross-Cutting Architecture

The **architecture/** directory contains documentation that spans multiple components:
- System-wide patterns (authentication, authorization, data)
- Integration points between components
- High-level architectural decisions

---

## Documentation Status

All documentation includes status indicators to help you understand whether content describes current, planned, or historical features.

### Status Types

| Status | Meaning | Look For |
|--------|---------|----------|
| **current** | Describes implemented features that are accurate today | Most production documentation |
| **aspirational** | Describes planned features not yet implemented | Future roadmap items |
| **archived** | Historical content or deprecated approaches | Old implementations, replaced systems |

### How Status is Marked

#### 1. YAML Frontmatter (Machine-Readable)

Every document includes frontmatter at the top:

```yaml
---
status: current
last_updated: 2025-01-12
applies_to_version: v1.2.0
---
```

#### 2. Inline Markers (Human-Readable)

Aspirational content uses visible markers:

> [!NOTE] This feature is not yet implemented

Or with emoji:

⚠️ **ASPIRATIONAL**: This describes planned functionality that is not yet built.

### Examples

**Current Documentation:**
```yaml
---
status: current
last_updated: 2025-01-12
applies_to_version: v1.2.0
---
# JWT Custom Claims

Our authentication system uses Supabase Auth with custom JWT claims...
```

**Aspirational Documentation:**
```yaml
---
status: aspirational
last_updated: 2025-01-12
---
# User Impersonation

> [!NOTE] This feature is not yet implemented

This document describes planned user impersonation functionality...
```

---

## Navigation Tips

### Finding What You Need

1. **Know your audience role** - Use the "Documentation by Audience" sections above
2. **Know your task type**:
   - Learning? → Start with `getting-started/`
   - Building? → Check `guides/` for how-tos
   - Looking up? → Use `reference/` for quick answers
   - Designing? → Read `architecture/` and `patterns/`
   - Troubleshooting? → Check `operations/troubleshooting/`
3. **Follow the hierarchy** - Each section has its own README with more specific links

### Search Strategies

- **Component-specific**: Start in the component directory (frontend/, workflows/, infrastructure/)
- **Cross-cutting concerns**: Check the architecture/ directory for system-wide patterns
- **Operational tasks**: Look in infrastructure/operations/
- **Can't find it?**: Check if it's aspirational (planned but not built) or archived (deprecated)

### README Files

Every directory has a README.md that:
- Explains what's in that directory
- Provides quick navigation links
- Links to related documentation
- May include examples or overview content

---

## Templates

Shared documentation templates are available in [templates/](./templates/) to help maintain consistency when creating new documentation.

---

## Contributing to Documentation

When adding or updating documentation:

### Placement
1. **Choose the right component**: frontend/, workflows/, infrastructure/, or architecture/
2. **Choose the right category**: getting-started/, guides/, reference/, etc.
3. **Create component-specific subdirectories** if organizing technology-specific content

### Structure
1. **Add YAML frontmatter** with status and last_updated date
2. **Ensure frontmatter matches heading status**:
   - Frontmatter `status: current` → Heading `**Status**: ✅ Fully Implemented` or `**Status**: Operational`
   - Frontmatter `status: aspirational` → Heading `**Status**: 📅 Planned` or `**Status**: Design Specification`
   - Frontmatter `status: archived` → Heading `**Status**: ⚠️ Deprecated` or `**Status**: Historical`
3. **Follow naming conventions**: lowercase-kebab-case.md
4. **Use descriptive filenames**: `jwt-custom-claims.md` not `claims.md`
5. **Include inline markers** for aspirational content (e.g., `> [!NOTE] This feature is not yet implemented`)

### Cross-References
1. **Add "See Also" sections** linking to related documentation
2. **Update this master index** if adding major new sections
3. **Use relative paths** for all internal links

### Quality
1. **Test your links** - ensure they work from the document's location
2. **Check status accuracy** - verify against current code
3. **Update last_updated date** when making changes
4. **Follow component CLAUDE.md** guidelines for technical accuracy

---

## Migration Information

This documentation structure was created on **2025-01-12** as part of a comprehensive documentation consolidation effort to:
- Consolidate 166+ scattered markdown files
- Establish uniform organization across all components
- Validate technical accuracy against current implementation
- Clearly mark aspirational content
- Create a single discoverable location for all documentation

### Documentation Migration Status

- **Phase 0**: ✅ Discovery & Planning (Complete)
- **Phase 1**: 🚧 Structure Creation (In Progress - 1.1 Complete)
- **Phase 2-7**: ⏸️ Pending (File migration, validation, annotation, cross-referencing)

For complete migration details, see [MIGRATION_REPORT.md](./MIGRATION_REPORT.md) (to be created upon completion).

### Old Documentation Locations

Documentation is being migrated from:
- `frontend/docs/` → `documentation/frontend/`
- `workflows/IMPLEMENTATION.md` → `documentation/workflows/`
- `infrastructure/` (scattered) → `documentation/infrastructure/`
- `.plans/` (audited) → `documentation/architecture/`

During migration, some documentation may exist in both old and new locations. When in doubt, prefer the `documentation/` directory as it will contain the most current, validated content.

---

## Questions or Issues?

- **Frontend-specific**: See [frontend/CLAUDE.md](../frontend/CLAUDE.md)
- **Workflows-specific**: See [workflows/CLAUDE.md](../workflows/CLAUDE.md)
- **Infrastructure-specific**: See [infrastructure/CLAUDE.md](../infrastructure/CLAUDE.md)
- **General**: See root [CLAUDE.md](../CLAUDE.md)
