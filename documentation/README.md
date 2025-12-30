---
status: current
last_updated: 2025-12-30
---

<!-- TL;DR-START -->
## TL;DR

**Summary**: Master index for 115+ documentation files organized by component (frontend, workflows, infrastructure) and purpose (architecture, guides, reference).

**When to read**:
- Finding documentation for a specific feature
- Understanding the documentation structure
- Locating API reference or architecture docs
- Starting as a new developer

**Key topics**: `documentation`, `index`, `frontend`, `workflows`, `infrastructure`, `architecture`, `guides`, `reference`

**Estimated read time**: 3 minutes (navigation), varies per linked document
<!-- TL;DR-END -->

# A4C-AppSuite Documentation

Welcome to the A4C (Analytics4Change) AppSuite documentation. This directory contains all consolidated documentation for the monorepo, organized by component and purpose.

## For AI Agents

- **[AGENT-INDEX.md](./AGENT-INDEX.md)** - Keyword navigation, task decision tree, token estimates
- **[AGENT-GUIDELINES.md](./AGENT-GUIDELINES.md)** - Documentation creation and update rules

Use the TL;DR section at the top of each document to quickly assess relevance before deep-reading.

---

## Quick Start - Common Tasks

### For New Developers
- **[Frontend Development Setup](./frontend/guides/DEVELOPMENT.md)** - Local environment, dev server, hot reload
- **[Frontend Installation Guide](./frontend/getting-started/installation.md)** - Dependencies, prerequisites, first run
- **[Git-Crypt Setup](./frontend/guides/GIT_CRYPT_SETUP.md)** - Decrypt sensitive files after clone
- **[Supabase Auth Setup](./infrastructure/guides/supabase/SUPABASE-AUTH-SETUP.md)** - OAuth configuration, JWT claims

### Frequently Accessed Documentation
- **[Frontend Authentication Architecture](./architecture/authentication/frontend-auth-architecture.md)** - Three-mode auth system (mock/integration/production)
- **[RBAC Architecture](./architecture/authorization/rbac-architecture.md)** - Role-based access control, permissions
- **[Database Table Reference](./infrastructure/reference/database/tables/)** - Complete schema documentation (29 tables)
- **[JWT Custom Claims Setup](./infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md)** - Configure custom claims in Supabase
- **[Event-Driven Guide](./frontend/guides/EVENT-DRIVEN-GUIDE.md)** - CQRS patterns in React
- **[Deployment Instructions](./infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md)** - Deploy database migrations

### Quick Reference
- **[Component API](./frontend/reference/api/API.md)** - Frontend component API reference
- **[UI Patterns](./frontend/patterns/ui-patterns.md)** - Modal architecture, component patterns
- **[ViewModels Architecture](./frontend/architecture/viewmodels.md)** - MobX state management patterns
- **[Temporal Overview](./architecture/workflows/temporal-overview.md)** - Workflow orchestration concepts

### Common Tasks
- **[How to Deploy](./infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md)** - Deployment procedures by environment
- **[How to Test OAuth](./infrastructure/guides/supabase/OAUTH-TESTING.md)** - Google OAuth testing guide
- **[How to Write Migrations](./infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md)** - Idempotent SQL patterns
- **[How to Add Components](./frontend/guides/DESIGN_PATTERNS_MIGRATION_GUIDE.md)** - Design patterns and best practices

---

## Table of Contents

### [Frontend Documentation](./frontend/)
React/TypeScript medication management application

- **[Getting Started](./frontend/getting-started/)**
  - [Installation Guide](./frontend/getting-started/installation.md) - Dependencies, prerequisites, first run
  - [Validation Guide](./frontend/getting-started/validation.md) - Testing your setup
- **[Architecture](./frontend/architecture/)**
  - [Overview](./frontend/architecture/overview.md) - High-level application architecture
  - [ViewModels](./frontend/architecture/viewmodels.md) - MobX state management patterns
  - [Auth Provider Architecture](./frontend/architecture/auth-provider-architecture.md) - Authentication abstraction layer
  - [Event Resilience Plan](./frontend/architecture/event-resilience-plan.md) - Event-driven reliability patterns
- **[Guides](./frontend/guides/)** - How-to guides for common development tasks
  - [Development Setup](./frontend/guides/DEVELOPMENT.md) - Local environment configuration
  - [Deployment Guide](./frontend/guides/DEPLOYMENT.md) - CI/CD and production deployment
  - [Event-Driven Guide](./frontend/guides/EVENT-DRIVEN-GUIDE.md) - CQRS patterns in React
  - [Design Patterns Migration](./frontend/guides/DESIGN_PATTERNS_MIGRATION_GUIDE.md) - Component architecture patterns
  - [Auth Setup](./frontend/guides/AUTH_SETUP.md) - Authentication configuration
  - [Git-Crypt Setup](./frontend/guides/GIT_CRYPT_SETUP.md) - Repository encryption
  - [RxNorm Medication Autocomplete](./frontend/guides/rxnorm-medication-autocomplete.md) - Drug search implementation
  - [Medication Search Implementation](./frontend/guides/medication-search-implementation.md) - Search architecture
- **[Reference](./frontend/reference/)** - Quick lookup documentation
  - [API Reference](./frontend/reference/api/API.md) - Component and service APIs
  - [Components](./frontend/reference/components/) - Comprehensive component documentation with props
- **[Patterns](./frontend/patterns/)**
  - [UI Patterns](./frontend/patterns/ui-patterns.md) - Modal architecture, dropdown patterns
  - [Implementation Guide](./frontend/patterns/implementation-guide.md) - Coding standards and practices
  - [FocusTrappedCheckboxGroup Plan](./frontend/patterns/FocusTrappedCheckboxGroup_plan.md) - Accessible checkbox groups
- **[Testing](./frontend/testing/)**
  - [Testing Strategies](./frontend/testing/TESTING.md) - Unit tests, E2E tests, accessibility testing
- **[Performance](./frontend/performance/)**
  - [MobX Optimization](./frontend/performance/mobx-optimization.md) - State management performance tuning

### [Workflows Documentation](./workflows/)
Temporal.io workflow orchestration for long-running business processes

- **[Architecture](./workflows/architecture/)**
  - [Organization Bootstrap Workflow Design](./workflows/architecture/organization-bootstrap-workflow-design.md) - Organization onboarding workflow
- **[Guides](./workflows/guides/)**
  - [Implementation Guide](./workflows/guides/implementation.md) - How to build workflows
  - [Error Handling and Compensation](./workflows/guides/error-handling-and-compensation.md) - Saga pattern for rollback
- **[Reference](./workflows/reference/)**
  - [Activities Reference](./workflows/reference/activities-reference.md) - Complete activity catalog
- **[Getting Started](./workflows/getting-started/)** - Local Temporal setup, running workers
- **[Testing](./workflows/testing/)** - Workflow replay tests, activity unit tests
- **[Operations](./workflows/operations/)** - Deployment, monitoring, troubleshooting

### [Infrastructure Documentation](./infrastructure/)
Terraform IaC, Kubernetes deployments, Supabase resources

- **[Getting Started](./infrastructure/getting-started/)** - Infrastructure setup and prerequisites
- **[Architecture](./infrastructure/architecture/)** - Infrastructure design and topology
- **[Guides](./infrastructure/guides/)** - Technology-specific how-to guides
  - **[Supabase Guides](./infrastructure/guides/supabase/)**
    - [Supabase Auth Setup](./infrastructure/guides/supabase/SUPABASE-AUTH-SETUP.md) - OAuth, social login configuration
    - [JWT Custom Claims Setup](./infrastructure/guides/supabase/JWT-CLAIMS-SETUP.md) - Database hooks for custom claims
    - [OAuth Testing Guide](./infrastructure/guides/supabase/OAUTH-TESTING.md) - Test Google OAuth flow
    - [SQL Idempotency Audit](./infrastructure/guides/supabase/SQL_IDEMPOTENCY_AUDIT.md) - Idempotent migration patterns
    - [Deployment Instructions](./infrastructure/guides/supabase/DEPLOYMENT_INSTRUCTIONS.md) - Deploy migrations to production
    - [Backend Implementation Summary](./infrastructure/guides/supabase/BACKEND-IMPLEMENTATION-SUMMARY.md) - Complete backend overview
    - [Event-Driven Architecture](./infrastructure/guides/supabase/docs/EVENT-DRIVEN-ARCHITECTURE.md) - CQRS and domain events
    - [Local Testing Guide](./infrastructure/guides/supabase/local-tests/LOCAL_TESTING.md) - Test migrations locally
    - [Edge Function Tests](./infrastructure/guides/supabase/EDGE_FUNCTION_TESTS.md) - Supabase functions testing
  - [Database](./infrastructure/guides/database/) - PostgreSQL, migrations, RLS, triggers
  - [Kubernetes](./infrastructure/guides/kubernetes/) - K8s deployments and configuration
- **[Reference](./infrastructure/reference/)** - Quick lookup for schemas and configs
  - **[Database Reference](./infrastructure/reference/database/)**
    - **[Table Documentation](./infrastructure/reference/database/tables/)** - Schema documentation (29 tables documented)
      - **Infrastructure & Auth**: [organizations_projection](./infrastructure/reference/database/tables/organizations_projection.md) • [organization_units_projection](./infrastructure/reference/database/tables/organization_units_projection.md) • [users](./infrastructure/reference/database/tables/users.md)
      - **Clinical Operations**: [clients](./infrastructure/reference/database/tables/clients.md) • [medications](./infrastructure/reference/database/tables/medications.md) • [medication_history](./infrastructure/reference/database/tables/medication_history.md) • [dosage_info](./infrastructure/reference/database/tables/dosage_info.md)
      - **RBAC**: [permissions_projection](./infrastructure/reference/database/tables/permissions_projection.md) • [roles_projection](./infrastructure/reference/database/tables/roles_projection.md) • [user_roles_projection](./infrastructure/reference/database/tables/user_roles_projection.md) • [role_permissions_projection](./infrastructure/reference/database/tables/role_permissions_projection.md) • [role_permission_templates](./infrastructure/reference/database/tables/role_permission_templates.md)
      - **Events & Workflows**: [domain_events](./infrastructure/reference/database/tables/domain_events.md) • [event_types](./infrastructure/reference/database/tables/event_types.md) • [workflow_queue_projection](./infrastructure/reference/database/tables/workflow_queue_projection.md)
      - **Contacts & Addresses**: [contacts_projection](./infrastructure/reference/database/tables/contacts_projection.md) • [addresses_projection](./infrastructure/reference/database/tables/addresses_projection.md) • [phones_projection](./infrastructure/reference/database/tables/phones_projection.md)
      - **Junction Tables**: [organization_contacts](./infrastructure/reference/database/tables/organization_contacts.md) • [organization_addresses](./infrastructure/reference/database/tables/organization_addresses.md) • [organization_phones](./infrastructure/reference/database/tables/organization_phones.md) • [contact_addresses](./infrastructure/reference/database/tables/contact_addresses.md) • [contact_phones](./infrastructure/reference/database/tables/contact_phones.md) • [phone_addresses](./infrastructure/reference/database/tables/phone_addresses.md)
      - **System & Audit**: [invitations_projection](./infrastructure/reference/database/tables/invitations_projection.md) • [cross_tenant_access_grants_projection](./infrastructure/reference/database/tables/cross_tenant_access_grants_projection.md) • [organization_business_profiles_projection](./infrastructure/reference/database/tables/organization_business_profiles_projection.md) • [impersonation_sessions_projection](./infrastructure/reference/database/tables/impersonation_sessions_projection.md) • [_migrations_applied](./infrastructure/reference/database/tables/_migrations_applied.md)
  - [Kubernetes Reference](./infrastructure/reference/kubernetes/) - K8s resource reference
- **[Testing](./infrastructure/testing/)** - Infrastructure testing strategies
- **[Operations](./infrastructure/operations/)** - Deployment and operational procedures
  - **[Deployment](./infrastructure/operations/deployment/)** - Deployment procedures by environment
  - **[Configuration](./infrastructure/operations/configuration/)** - Configuration management
    - [KUBECONFIG Update Guide](./infrastructure/operations/KUBECONFIG_UPDATE_GUIDE.md) - K8s cluster access configuration
    - [Environment Variables](./infrastructure/operations/configuration/ENVIRONMENT_VARIABLES.md) - Complete env var reference
  - **[Utilities](./infrastructure/operations/utilities/)** - Ad-hoc scripts, cleanup tools, manual testing
    - [cleanup-org.ts](./infrastructure/operations/utilities/cleanup-org.md) - Hard delete organization by slug
  - [Troubleshooting](./infrastructure/operations/troubleshooting/) - Common issues and fixes

### [Architecture Documentation](./architecture/)
Cross-cutting architectural decisions that span multiple components

- **[Authentication](./architecture/authentication/)**
  - [Frontend Auth Architecture](./architecture/authentication/frontend-auth-architecture.md) - Three-mode auth system (mock/integration/production) ✅
  - [Supabase Auth Overview](./architecture/authentication/supabase-auth-overview.md) - OAuth2 PKCE, social login, session management
  - [Custom Claims Setup](./architecture/authentication/custom-claims-setup.md) - JWT custom claims configuration
  - [Enterprise SSO Guide](./architecture/authentication/enterprise-sso-guide.md) - SAML 2.0 integration (aspirational)
  - [Impersonation Architecture](./architecture/authentication/impersonation-architecture.md) - Super admin impersonation (aspirational)
  - [Impersonation Implementation Guide](./architecture/authentication/impersonation-implementation-guide.md) - Technical implementation (aspirational)
  - [Impersonation Security Controls](./architecture/authentication/impersonation-security-controls.md) - Security measures (aspirational)
  - [Impersonation UI Specification](./architecture/authentication/impersonation-ui-specification.md) - UX design (aspirational)
  - [Impersonation Event Schema](./architecture/authentication/impersonation-event-schema.md) - Event definitions (aspirational)
- **[Authorization](./architecture/authorization/)**
  - [RBAC Architecture](./architecture/authorization/rbac-architecture.md) - Role-based access control, permission models ✅
  - [RBAC Implementation Guide](./architecture/authorization/rbac-implementation-guide.md) - Step-by-step RBAC setup
  - [Organizational Deletion UX](./architecture/authorization/organizational-deletion-ux.md) - Organization deletion workflow
- **[Data](./architecture/data/)**
  - [Multi-Tenancy Architecture](./architecture/data/multi-tenancy-architecture.md) - Organization-based isolation with RLS
  - [Event Sourcing Overview](./architecture/data/event-sourcing-overview.md) - CQRS and domain events
  - [Organization Management Architecture](./architecture/data/organization-management-architecture.md) - Hierarchical organization structure
  - [Organization Management Implementation](./architecture/data/organization-management-implementation.md) - Technical implementation
  - [Tenants as Organizations](./architecture/data/tenants-as-organizations.md) - Multi-tenancy design
  - [Provider Partners Architecture](./architecture/data/provider-partners-architecture.md) - Partner ecosystem
  - [VAR Partnerships](./architecture/data/var-partnerships.md) - Value-added reseller partnerships (aspirational)
- **[Workflows](./architecture/workflows/)**
  - [Temporal Overview](./architecture/workflows/temporal-overview.md) - Workflow orchestration architecture ✅
  - [Organization Onboarding Workflow](./architecture/workflows/organization-onboarding-workflow.md) - Organization bootstrap workflow

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

#### Utilities & Scripts
- [Operational Utilities](./infrastructure/operations/utilities/) - Cleanup, testing, diagnostics
- [cleanup-org.ts](./infrastructure/operations/utilities/cleanup-org.md) - Hard delete organization by slug

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

- **Phase 0**: ✅ Discovery & Planning (Complete - 2025-01-12)
- **Phase 1**: ✅ Structure Creation (Complete - 2025-01-12)
- **Phase 2**: ✅ Implementation Tracking Document Migration (Complete - 2025-01-12)
- **Phase 3**: ✅ Documentation Migration (Complete - 2025-01-12)
  - 115 files migrated from frontend/, workflows/, infrastructure/
  - 30 planning docs categorized and migrated from .plans/
- **Phase 4**: ✅ Technical Reference Validation (Complete - 2025-01-13)
  - API contracts validated (100% accuracy)
  - Database schemas validated and documented (29 tables)
  - Configuration validated (55 environment variables, 100% coverage)
  - Architecture validated (95% accuracy after remediation)
- **Phase 5**: ✅ Annotation & Status Marking (Complete - 2025-01-13)
  - 103 files received YAML frontmatter
  - 10 aspirational docs received inline warning markers
  - Status legend documented
- **Phase 6**: ✅ Cross-Referencing & Master Index (Complete - 2025-01-13)
  - **6.1**: ✅ Updated Internal Links (Strategic completion)
    - Fixed 10 high-priority user-facing links
    - Categorized 82 broken links (report created)
    - Deferred low-priority links (~20) in favor of Phase 6.2-6.4
  - **6.2**: ✅ Added Cross-References (Partial - 2 architecture docs)
    - Enhanced with 27 comprehensive cross-references
    - Organized by category (Auth, Data, Infrastructure, Workflows)
  - **6.3**: ✅ Populated Master Index (Complete)
    - Enhanced Quick Start with 20+ specific document links
    - Populated all component sections (Frontend: 20+ docs, Infrastructure: 30+ docs, Architecture: 20+ docs)
    - Organized by audience (Developers, Operators, Architects)
    - Added "Common Tasks" quick access section
  - **6.4**: ⏸️ Update Component CLAUDE.md Files (Pending)
- **Phase 7**: ⏸️ Validation, Cleanup, and CI/CD Updates (Pending)

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
